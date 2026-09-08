import { normalizeProviderObservation, redactSensitiveText } from './seat-assistant-policy.mjs';
import { SEAT_ASSISTANT_RESOURCE_HOST, SEAT_ASSISTANT_RESOURCE_ORIGIN } from './seat-assistant-session-store.mjs';

// This is an intentionally narrow, read-only integration. Keep these paths in
// sync with the reviewed request samples; do not add a generic proxy here.
const HUST_YITLINK_BASE = `${SEAT_ASSISTANT_RESOURCE_ORIGIN}/http/80/133/9/114/202/yitlink`;
const HUST_YITLINK_API_BASE = `${HUST_YITLINK_BASE}/api.php`;
const AUDITED_AREA_ID = '101';

function normalizeDate(value) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value || '').trim());
  if (!match) return '';
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

function unpaddedDate(value) {
  const normalized = normalizeDate(value);
  if (!normalized) throw new Error('targetDate 无效');
  const [year, month, day] = normalized.split('-');
  return `${year}-${Number(month)}-${Number(day)}`;
}

function extractTime(value) {
  const source = typeof value === 'object' && value ? value.date : value;
  const match = /(?:^|\s)(\d{2}:\d{2})(?::\d{2})?$/.exec(String(source || '').trim());
  return match?.[1] || '';
}

function mapRemoteStatus(httpStatus, payload) {
  if (httpStatus === 401) return 'login_required';
  if (httpStatus === 403) return 'blocked';
  if (httpStatus === 429) return 'rate_limited';
  const message = String(payload?.msg || payload?.message || payload?.error || '').toLowerCase();
  if (/(登录|login|未授权|unauthorized|session)/i.test(message)) return 'login_required';
  if (/(验证码|captcha|verify.?code|challenge)/i.test(message)) return 'captcha_required';
  if (/(限流|频繁|rate.?limit|too many)/i.test(message)) return 'rate_limited';
  if (/(风控|阻断|封禁|risk|blocked|forbidden|安全策略)/i.test(message)) return 'blocked';
  return 'error';
}

function schemaError(message) {
  return { ok: false, status: 'error', message: `官方只读接口返回格式异常：${message}` };
}

function validateSegments(payload, areaId) {
  const list = payload?.data?.list;
  if (!Array.isArray(list)) return schemaError('v3areadays.data.list 不是数组');
  for (const item of list) {
    if (!item || typeof item !== 'object'
      || !/^\d{1,12}$/.test(String(item.id || ''))
      || String(item.area ?? '').trim() !== String(areaId)
      || !normalizeDate(item.day)
      || !extractTime(item.startTime)
      || !extractTime(item.endTime)) {
      return schemaError('v3areadays 时段字段缺失或类型错误');
    }
  }
  return list;
}

function validateSeats(payload) {
  const list = payload?.data?.list;
  if (!Array.isArray(list)) return schemaError('spaces_old.data.list 不是数组');
  for (const item of list) {
    const seatName = item && typeof item === 'object' ? String(item.no || item.name || '').trim() : '';
    if (!seatName || typeof item.status !== 'number' || !Number.isInteger(item.status)) {
      return schemaError('spaces_old 座位字段缺失或 status 不是整数');
    }
  }
  return list;
}

function isAuditedReadonlyUrl(rawUrl, areaId) {
  const parsedUrl = new URL(String(rawUrl));
  const spaceQueryKeys = [...parsedUrl.searchParams.keys()];
  const allowedSpaceQuery = spaceQueryKeys.length === 5
    && new Set(spaceQueryKeys).size === 5
    && ['area', 'segment', 'day', 'startTime', 'endTime'].every((key) => parsedUrl.searchParams.has(key));
  const pathPrefix = HUST_YITLINK_API_BASE.slice(SEAT_ASSISTANT_RESOURCE_ORIGIN.length);
  return parsedUrl.origin === SEAT_ASSISTANT_RESOURCE_ORIGIN && (
    (parsedUrl.pathname === `${pathPrefix}/v3areadays/${areaId}` && !parsedUrl.search)
    || (parsedUrl.pathname === `${pathPrefix}/spaces_old` && allowedSpaceQuery)
  );
}

export function createHustYitlinkReadonlyProvider({
  areaId = AUDITED_AREA_ID,
  fetchFn = globalThis.fetch,
  sessionStore = null,
  now = () => new Date(),
  timeoutMs = 8_000,
  segmentCacheTtlMs = 30 * 60_000,
} = {}) {
  const normalizedAreaId = String(areaId || '').trim();
  if (normalizedAreaId !== AUDITED_AREA_ID) throw new Error('座位 provider 只允许已审查区域 101');
  if (typeof fetchFn !== 'function') throw new Error('fetch is required');
  let segmentCache = { expiresAt: 0, items: [] };

  async function getJson(url) {
    if (!isAuditedReadonlyUrl(url, normalizedAreaId)) throw new Error('只读 provider 拒绝非白名单 URL');
    const cookieHeader = sessionStore?.getCookieHeader?.(url) || '';
    if (sessionStore && !cookieHeader) return { ok: false, status: 'login_required', message: '官方资源代理会话缺失；请重新配对' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1_000, Math.min(15_000, Number(timeoutMs) || 8_000)));
    timer.unref?.();
    try {
      // The real provider has one method and two audited paths. No write method
      // or generic URL is reachable from this function.
      const response = await fetchFn(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: `${HUST_YITLINK_BASE}/home/web/f_second`,
          'User-Agent': 'exam-planner-seat-monitor/1.0',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      });
      if (response.status >= 300 && response.status < 400) {
        sessionStore?.revokeActiveSession?.();
        return { ok: false, status: 'login_required', message: '官方资源代理会话缺失；未跟随重定向' };
      }
      if ([401, 403, 429].includes(response.status)) {
        const status = mapRemoteStatus(response.status);
        sessionStore?.revokeActiveSession?.();
        return { ok: false, status, message: `HTTP ${response.status}` };
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentLength = Number(response.headers?.get?.('content-length') || 0);
      if (contentLength > 1024 * 1024) throw new Error('provider response too large');
      const contentType = String(response.headers?.get?.('content-type') || '');
      if (contentType && !/json/i.test(contentType)) throw new Error('provider response is not JSON');
      const text = await response.text();
      if (text.length > 1024 * 1024) throw new Error('provider response too large');
      let payload;
      try { payload = JSON.parse(text); } catch { throw new Error('provider JSON 格式无效'); }
      if (Number(payload?.status) !== 1) {
        const status = mapRemoteStatus(response.status, payload);
        if (['login_required', 'blocked', 'rate_limited', 'captcha_required'].includes(status)) sessionStore?.revokeActiveSession?.();
        return { ok: false, status, message: redactSensitiveText(payload?.msg || payload?.message || 'provider 返回失败状态', 160) };
      }
      return { ok: true, payload };
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadSegments(force = false) {
    const timestamp = now().getTime();
    if (!force && segmentCache.expiresAt > timestamp && segmentCache.items.length) return segmentCache.items;
    const result = await getJson(`${HUST_YITLINK_API_BASE}/v3areadays/${normalizedAreaId}`);
    if (!result.ok) return result;
    const items = validateSegments(result.payload, normalizedAreaId);
    if (!Array.isArray(items)) return items;
    segmentCache = { expiresAt: timestamp + Math.max(60_000, Number(segmentCacheTtlMs) || 30 * 60_000), items };
    return items;
  }

  async function query({ profile, targetDate }) {
    const normalizedTargetDate = normalizeDate(targetDate);
    let segments = await loadSegments();
    if (!Array.isArray(segments)) return { status: segments.status, message: segments.message };
    let segment = segments.find((item) => normalizeDate(item?.day) === normalizedTargetDate && String(item?.area || normalizedAreaId) === normalizedAreaId);
    if (!segment) {
      segments = await loadSegments(true);
      if (!Array.isArray(segments)) return { status: segments.status, message: segments.message };
      segment = segments.find((item) => normalizeDate(item?.day) === normalizedTargetDate && String(item?.area || normalizedAreaId) === normalizedAreaId);
    }
    if (!segment || !/^\d{1,12}$/.test(String(segment.id || ''))
      || String(segment.area ?? '').trim() !== normalizedAreaId
      || !normalizeDate(segment.day)
      || !extractTime(segment.startTime)
      || !extractTime(segment.endTime)) {
      return { status: 'error', message: '目标日期没有可用时段或时段格式异常' };
    }
    const openTime = extractTime(segment.startTime);
    const closeTime = extractTime(segment.endTime);
    if ((openTime && profile.startTime < openTime) || (closeTime && profile.endTime > closeTime)) {
      return { status: 'error', message: `请求时段超出开放范围 ${openTime || '--'}-${closeTime || '--'}` };
    }
    const queryString = new URLSearchParams({
      area: normalizedAreaId,
      segment: String(segment.id),
      day: unpaddedDate(normalizedTargetDate),
      startTime: profile.startTime,
      endTime: profile.endTime,
    });
    const result = await getJson(`${HUST_YITLINK_API_BASE}/spaces_old?${queryString}`);
    if (!result.ok) return { status: result.status, message: result.message };
    const list = validateSeats(result.payload);
    if (!Array.isArray(list)) return { status: list.status, message: list.message };
    const seats = list.map((item) => ({
      name: String(item?.no || item?.name || '').trim(),
      status: Number(item?.status),
      statusName: String(item?.status_name || '').trim(),
    })).filter((item) => item.name);
    const availableSeats = Array.from(new Set(seats
      .filter((item) => item.status === 1 && (!item.statusName || item.statusName === '空闲'))
      .map((item) => item.name)));
    return normalizeProviderObservation({
      status: 'ok',
      totalSeats: seats.length,
      freeSeats: availableSeats.length,
      availableSeats,
      observedAt: now().toISOString(),
      source: 'hust_yitlink_readonly',
    });
  }

  return {
    name: 'hust_yitlink_readonly',
    get enabled() { return sessionStore ? Boolean(sessionStore.hasActiveSession?.()) : true; },
    canExecute: false,
    areaId: normalizedAreaId,
    query,
  };
}

export function createDisabledSeatProvider(reason = 'provider_disabled') {
  return {
    name: 'disabled',
    enabled: false,
    canExecute: false,
    async query() {
      return { status: 'disabled', message: reason };
    },
  };
}

export function createSeatAssistantProvider({ mode = 'disabled', sessionStore, areaId = AUDITED_AREA_ID, fetchFn, now, timeoutMs, segmentCacheTtlMs } = {}) {
  if (mode === 'hust_session_readonly' && sessionStore) {
    return createHustYitlinkReadonlyProvider({ sessionStore, areaId, fetchFn, now, timeoutMs, segmentCacheTtlMs });
  }
  return createDisabledSeatProvider(mode === 'disabled' ? 'feature_disabled' : 'unreviewed_provider');
}

export const SEAT_ASSISTANT_AUDITED_AREA_ID = AUDITED_AREA_ID;
export const SEAT_ASSISTANT_AUDITED_PATHS = Object.freeze([
  '/http/80/133/9/114/202/yitlink/api.php/v3areadays/101',
  '/http/80/133/9/114/202/yitlink/api.php/spaces_old',
]);
export { HUST_YITLINK_BASE, HUST_YITLINK_API_BASE, SEAT_ASSISTANT_RESOURCE_HOST };
