const SENSITIVE_KEY = /(password|cookie|authorization|token|session|openid|unionid|student.?id|phone|mobile|姓名|学号|手机号|凭据)/i;
const SENSITIVE_TEXT = /((?:password|passwd|cookie|authorization|token|session|openid|unionid|student.?id|phone|mobile|姓名|学号|手机号|凭据)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi;

export const SEAT_ASSISTANT_STATUSES = Object.freeze({
  disabled: 'disabled',
  disconnected: 'disconnected',
  connected: 'connected',
  loginRequired: 'login_required',
  captchaRequired: 'captcha_required',
  rateLimited: 'rate_limited',
  blocked: 'blocked',
  paused: 'paused',
  error: 'error',
});

export const DEFAULT_PREFERRED_SEAT_LABELS = Object.freeze(
  Array.from({ length: 12 }, (_unused, index) => String(index + 17)),
);

export const DEFAULT_SEAT_ASSISTANT_PROFILE = Object.freeze({
  id: 1,
  enabled: false,
  venue: 'main',
  dateMode: 'tomorrow',
  startTime: '08:30',
  endTime: '22:00',
  areaPreference: [],
  seatPreference: [...DEFAULT_PREFERRED_SEAT_LABELS],
  pollIntervalSeconds: 240,
  jitterSeconds: 30,
  nearIntervalSeconds: 60,
});

const VALID_DATE_MODES = new Set(['today', 'tomorrow', 'day_after_tomorrow']);
const VALID_VENUES = new Set(['main', 'east', 'medical']);

function text(value, maxLength = 120) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}

function list(value, maxItems = 20, maxItemLength = 80) {
  if (value == null || value === '') return [];
  if (!Array.isArray(value)) throw new Error('列表字段必须是数组');
  return Array.from(new Set(value.map((item) => text(item, maxItemLength)).filter(Boolean))).slice(0, maxItems);
}

function preferredSeatLabel(value) {
  const match = /(?:^|[-_\s])0*(\d{1,3})$/.exec(String(value || '').trim());
  if (!match) return '';
  const number = Number(match[1]);
  return Number.isInteger(number) && number >= 17 && number <= 28 ? String(number) : '';
}

function validTime(value) {
  const normalized = text(value, 5);
  if (!/^\d{2}:\d{2}$/.test(normalized)) throw new Error('时间必须使用 HH:mm 格式');
  const [hour, minute] = normalized.split(':').map(Number);
  if (hour > 23 || minute > 59) throw new Error('时间超出范围');
  return normalized;
}

export function assertNoSensitiveFields(value, path = 'payload') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveFields(item, `${path}[${index}]`));
    return value;
  }
  if (typeof value === 'string') {
    SENSITIVE_TEXT.lastIndex = 0;
    const containsKeyedSecret = SENSITIVE_TEXT.test(value);
    SENSITIVE_TEXT.lastIndex = 0;
    if (containsKeyedSecret || /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i.test(value)) throw new Error(`敏感内容禁止进入座位助手数据：${path}`);
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) throw new Error(`敏感字段禁止进入座位助手数据：${path}.${key}`);
    assertNoSensitiveFields(child, `${path}.${key}`);
  }
  return value;
}

export function redactSensitiveText(value, maxLength = 240) {
  return String(value ?? '')
    .replace(SENSITIVE_TEXT, '$1[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function normalizeProfile(input = {}, existing = DEFAULT_SEAT_ASSISTANT_PROFILE) {
  assertNoSensitiveFields(input, 'profileInput');
  const source = { ...DEFAULT_SEAT_ASSISTANT_PROFILE, ...(existing || {}), ...(input || {}) };
  const venue = text(source.venue, 32);
  if (!VALID_VENUES.has(venue)) throw new Error('馆区不在允许范围内');
  const dateMode = text(source.dateMode, 24);
  if (!VALID_DATE_MODES.has(dateMode)) throw new Error('目标日期必须是当天、明天或后天');
  const startTime = validTime(source.startTime);
  const endTime = validTime(source.endTime);
  if (startTime >= endTime) throw new Error('结束时间必须晚于开始时间');
  const pollIntervalSeconds = Math.max(240, Math.min(24 * 60 * 60, Math.round(Number(source.pollIntervalSeconds) || 240)));
  const jitterSeconds = Math.max(0, Math.min(300, Math.round(Number(source.jitterSeconds) || 0)));
  const nearIntervalSeconds = Math.max(60, Math.min(15 * 60, Math.round(Number(source.nearIntervalSeconds) || 60)));
  const normalizedSeatPreference = Array.from(new Set(list(source.seatPreference, 50, 40)
    .map(preferredSeatLabel)
    .filter(Boolean)));
  const profile = {
    id: 1,
    enabled: source.enabled === true,
    venue,
    dateMode,
    startTime,
    endTime,
    areaPreference: list(source.areaPreference),
    seatPreference: normalizedSeatPreference.length ? normalizedSeatPreference : [...DEFAULT_PREFERRED_SEAT_LABELS],
    pollIntervalSeconds,
    jitterSeconds,
    nearIntervalSeconds,
  };
  assertNoSensitiveFields(profile, 'profile');
  return profile;
}

function chinaDateISO(date) {
  const value = date instanceof Date ? date : new Date(date);
  return new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addDays(dateISO, days) {
  const value = new Date(`${dateISO}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function resolveTargetDate(dateMode, now = new Date()) {
  const offset = dateMode === 'today' ? 0 : dateMode === 'day_after_tomorrow' ? 2 : 1;
  return addDays(chinaDateISO(now), offset);
}

export function normalizeProviderObservation(input = {}) {
  assertNoSensitiveFields(input, 'providerObservation');
  const status = text(input.status || 'ok', 32);
  if (status !== 'ok') {
    return {
      status,
      message: redactSensitiveText(input.message, 240),
      observedAt: input.observedAt ? new Date(input.observedAt).toISOString() : new Date().toISOString(),
    };
  }
  const totalSeats = Number(input.totalSeats);
  const freeSeats = Number(input.freeSeats);
  if (!Number.isInteger(totalSeats) || totalSeats < 0 || totalSeats > 100_000) throw new Error('provider totalSeats 无效');
  if (!Number.isInteger(freeSeats) || freeSeats < 0 || freeSeats > totalSeats) throw new Error('provider freeSeats 无效');
  const availableSeats = list(input.availableSeats, 1000, 80);
  if (availableSeats.length !== freeSeats) throw new Error('provider availableSeats 与 freeSeats 不一致');
  return {
    status: 'ok',
    totalSeats,
    freeSeats,
    availableSeats,
    observedAt: input.observedAt ? new Date(input.observedAt).toISOString() : new Date().toISOString(),
    source: text(input.source || 'provider', 40),
  };
}

export function isHaltedStatus(status) {
  return [SEAT_ASSISTANT_STATUSES.loginRequired, SEAT_ASSISTANT_STATUSES.captchaRequired, SEAT_ASSISTANT_STATUSES.rateLimited, SEAT_ASSISTANT_STATUSES.blocked, SEAT_ASSISTANT_STATUSES.paused].includes(status);
}

export function normalizeLimit(value, fallback = 20, maximum = 100) {
  return Math.max(1, Math.min(maximum, Math.round(Number(value) || fallback)));
}
