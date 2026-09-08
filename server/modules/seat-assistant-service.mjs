import { createHash, randomBytes } from 'node:crypto';
import {
  DEFAULT_SEAT_ASSISTANT_PROFILE,
  DEFAULT_PREFERRED_SEAT_LABELS,
  isHaltedStatus,
  normalizeProfile,
  normalizeProviderObservation,
  redactSensitiveText,
  resolveTargetDate,
  SEAT_ASSISTANT_STATUSES,
} from './seat-assistant-policy.mjs';

const PAIRING_TTL_MS = 10 * 60 * 1000;
const PREFERRED_SEAT_MIN = 17;
const PREFERRED_SEAT_MAX = 28;
const NOTIFICATION_MIN_INTERVAL_MS = 60 * 1000;

function safeError(error) {
  return redactSensitiveText(error instanceof Error ? error.message : String(error || 'unknown error'), 240);
}

function nextCheckAt(nowValue, seconds) {
  return new Date(nowValue.getTime() + Math.max(60, Number(seconds) || 60) * 1000).toISOString();
}

function failureNextCheckAt(nowValue, profile, failures, random) {
  const baseSeconds = Math.max(240, Number(profile?.pollIntervalSeconds) || 240);
  const backoffSeconds = Math.min(60 * 60, baseSeconds * (2 ** Math.max(0, Number(failures) - 1)));
  const jitterSeconds = Math.min(30, Math.max(0, Number(profile?.jitterSeconds) || 0));
  return nextCheckAt(nowValue, Math.min(60 * 60, backoffSeconds + Math.floor(random() * (jitterSeconds + 1))));
}

function preferredSeatNumber(value) {
  const match = /(?:^|[-_\s])0*(\d{1,3})$/.exec(String(value || '').trim());
  return match ? Number(match[1]) : NaN;
}

function preferredSeats(availableSeats, profile = DEFAULT_SEAT_ASSISTANT_PROFILE) {
  const configured = Array.isArray(profile?.seatPreference) && profile.seatPreference.length
    ? profile.seatPreference
    : DEFAULT_PREFERRED_SEAT_LABELS;
  const preferred = new Set(configured.map((value) => String(value || '').trim()).filter(Boolean));
  return Array.from(new Set((Array.isArray(availableSeats) ? availableSeats : [])
    .map((seat) => String(seat || '').trim())
    .filter((seat) => {
      const number = preferredSeatNumber(seat);
      return Number.isInteger(number) && number >= PREFERRED_SEAT_MIN && number <= PREFERRED_SEAT_MAX && preferred.has(String(number));
    })
    .map((seat) => String(preferredSeatNumber(seat)))));
}

export function createSeatAssistantService({
  repository,
  provider,
  featureEnabled = false,
  minimumRequestIntervalSeconds = 60,
  queueProactiveNotification = () => {},
  logger = () => {},
  now = () => new Date(),
  random = Math.random,
} = {}) {
  if (!repository) throw new Error('seat assistant repository is required');
  if (!provider) throw new Error('seat assistant provider is required');
  const minIntervalMs = Math.max(60, Number(minimumRequestIntervalSeconds) || 60) * 1000;
  let taskRunning = false;
  let lastRequestAt = 0;

  function audit(action, detail = {}, actorRole = 'system') {
    try { repository.appendAudit({ action, actorRole, detail }); }
    catch (error) { logger('warn', 'seat_assistant_audit_failed', { error: safeError(error) }); }
  }

  function episodeKey(stateKey, timestamp) {
    return createHash('sha256').update(`${stateKey}|${timestamp.toISOString()}`).digest('hex').slice(0, 24);
  }

  function notifyAvailableSeats(observation, profile, targetDate, timestamp) {
    if (!observation || observation.status !== 'ok') return;
    const seats = preferredSeats(observation.availableSeats, profile).sort();
    const count = seats.length;
    const stateKey = count === 1 ? `one:${seats[0]}` : count === 2 ? `two:${seats.join('|')}` : count === 0 ? 'none' : `other:${count}`;
    const previous = repository.getNotificationState?.() || { stateKey: '', episodeKey: '', startedAt: null, notifyCount: 0, lastNotifiedAt: null };
    const stateChanged = previous.stateKey !== stateKey;
    const current = stateChanged
      ? { stateKey, episodeKey: episodeKey(stateKey, timestamp), startedAt: timestamp.toISOString(), notifyCount: 0, lastNotifiedAt: null }
      : { ...previous, episodeKey: previous.episodeKey || episodeKey(stateKey, timestamp), startedAt: previous.startedAt || timestamp.toISOString() };
    if (stateChanged || !previous.episodeKey) repository.saveNotificationState?.(current, timestamp.toISOString());
    const maxNotifications = count === 1 ? 3 : count === 2 ? 1 : 0;
    const remaining = Math.max(0, maxNotifications - Number(current.notifyCount || 0));
    if (count !== 1 && count !== 2) return { count, stateKey, episodeKey: current.episodeKey, notified: false, remaining: 0 };
    const lastNotifiedMs = Date.parse(current.lastNotifiedAt || '');
    if (Number.isFinite(lastNotifiedMs) && timestamp.getTime() - lastNotifiedMs < NOTIFICATION_MIN_INTERVAL_MS) {
      return { count, stateKey, episodeKey: current.episodeKey, notified: false, remaining };
    }
    if (remaining <= 0) return { count, stateKey, episodeKey: current.episodeKey, notified: false, remaining: 0 };
    const nextCount = Number(current.notifyCount || 0) + 1;
    const seatText = seats.slice(0, 10).join('、');
    try {
      queueProactiveNotification({
        eventKey: `seat-assistant:available:${current.episodeKey}:${nextCount}`,
        source: 'seat_assistant',
        severity: 'info',
        title: '图书馆有可用座位',
        content: `${targetDate} ${profile.startTime}-${profile.endTime} 在偏好座位中检测到 ${count} 个可用座位：${seatText}`,
        text: `图书馆座位提醒：${targetDate} 检测到偏好座位 ${seatText}。请自行打开官方页面确认。`,
         payload: { targetDate, venue: profile.venue, freeSeats: count, availableSeats: seats.slice(0, 12), episodeKey: current.episodeKey, notificationCount: nextCount },
      });
      repository.saveNotificationState?.({ ...current, stateKey, notifyCount: nextCount, lastNotifiedAt: timestamp.toISOString() }, timestamp.toISOString());
      return { count, stateKey, episodeKey: current.episodeKey, notified: true, remaining: Math.max(0, maxNotifications - nextCount) };
    } catch (error) {
      logger('warn', 'seat_assistant_notification_failed', { error: safeError(error) });
      return { count, stateKey, episodeKey: current.episodeKey, notified: false, remaining };
    }
  }

  function notifyStatus(status, message, timestamp) {
    const stateKey = `alert:${String(status || 'error').slice(0, 40)}`;
    const previous = repository.getNotificationState?.() || { stateKey: '', episodeKey: '', startedAt: null, notifyCount: 0, lastNotifiedAt: null };
    if (previous.stateKey === stateKey && Number(previous.notifyCount || 0) >= 1) return false;
    const currentEpisodeKey = previous.stateKey === stateKey && previous.episodeKey
      ? previous.episodeKey
      : episodeKey(stateKey, timestamp);
    try {
      queueProactiveNotification({
        eventKey: `seat-assistant:status:${currentEpisodeKey}:1`,
        source: 'seat_assistant',
        severity: 'warning',
        title: '只读座位查询已暂停',
        content: redactSensitiveText(message || `座位查询状态：${status}`, 240),
        text: `只读座位查询提醒：${redactSensitiveText(message || String(status), 180)}`,
        payload: { status: String(status || 'error'), dedupeKey: stateKey, episodeKey: currentEpisodeKey },
      });
      repository.saveNotificationState?.({ stateKey, episodeKey: currentEpisodeKey, startedAt: previous.stateKey === stateKey ? previous.startedAt : timestamp.toISOString(), notifyCount: 1, lastNotifiedAt: timestamp.toISOString() }, timestamp.toISOString());
      return true;
    } catch (error) {
      logger('warn', 'seat_assistant_status_notification_failed', { error: safeError(error), status });
      return false;
    }
  }

  function getProfile() {
    return repository.getProfile() || { ...DEFAULT_SEAT_ASSISTANT_PROFILE };
  }

  function providerStatus() {
    return {
      name: String(provider.name || 'disabled'),
      enabled: Boolean(provider.enabled),
      canExecute: false,
      auditedPaths: provider.auditedPaths || undefined,
    };
  }

  function getStatus() {
    const session = repository.getSessionStatus();
    return {
      featureEnabled: Boolean(featureEnabled),
      provider: providerStatus(),
      profile: getProfile(),
      session,
      latestObservation: repository.listObservations(1)[0] || null,
      scheduler: { running: taskRunning, minimumRequestIntervalSeconds: Math.round(minIntervalMs / 1000) },
    };
  }

  function saveProfile(input, actorRole = 'system') {
    const profile = repository.saveProfile(normalizeProfile(input, getProfile()));
    if (!profile.enabled) {
      const current = repository.getSessionStatus();
      repository.saveSessionStatus({ ...current, status: SEAT_ASSISTANT_STATUSES.disabled, providerName: provider.name, message: '只读座位提醒已关闭；未发起官方查询', nextCheckAt: null, consecutiveFailures: 0 });
    }
    audit('profile_saved', { enabled: profile.enabled, venue: profile.venue, dateMode: profile.dateMode }, actorRole);
    return { profile, provider: providerStatus() };
  }

  function failedObservation({ targetDate, profile, status, message }) {
    return normalizeProviderObservation({
      status,
      message: redactSensitiveText(message, 240),
      observedAt: now().toISOString(),
      targetDate,
      venue: profile.venue,
    });
  }

  async function refreshNow({ trigger = 'manual' } = {}) {
    const profile = getProfile();
    const timestamp = now();
    const current = repository.getSessionStatus();
    if (!featureEnabled || !profile.enabled) {
      const session = repository.saveSessionStatus({ ...current, status: SEAT_ASSISTANT_STATUSES.disabled, providerName: provider.name, message: '只读座位提醒默认关闭；未发起官方查询', nextCheckAt: null, consecutiveFailures: 0 });
      return { ok: false, status: SEAT_ASSISTANT_STATUSES.disabled, message: session.message, session };
    }
    if (taskRunning) return { ok: false, status: 'busy', message: '上一次只读查询仍在进行' };
    if (isHaltedStatus(current.status)) {
      return { ok: false, status: current.status, message: current.message || '只读座位查询已熔断，请重新配对或人工处理', session: current };
    }
    if (!provider.enabled) {
      if (current.status === SEAT_ASSISTANT_STATUSES.connected) {
        const message = '临时浏览器会话已过期或失效；请重新配对后恢复只读查询';
        const session = repository.saveSessionStatus({ ...current, status: SEAT_ASSISTANT_STATUSES.loginRequired, providerName: provider.name, message, nextCheckAt: null, consecutiveFailures: Number(current.consecutiveFailures || 0) + 1 });
        notifyStatus(SEAT_ASSISTANT_STATUSES.loginRequired, message, timestamp);
        audit('browser_session_expired', { trigger });
        return { ok: false, status: session.status, message: session.message, session };
      }
      const session = repository.saveSessionStatus({ ...current, status: SEAT_ASSISTANT_STATUSES.disconnected, providerName: provider.name, message: '临时浏览器会话缺失；请先完成配对', nextCheckAt: null });
      return { ok: false, status: session.status, message: session.message, session };
    }
    const persistedLastCheckedAt = Date.parse(current.lastAttemptAt || current.lastCheckedAt || '');
    const lastAttemptAt = Math.max(lastRequestAt, Number.isFinite(persistedLastCheckedAt) ? persistedLastCheckedAt : 0);
    if (lastAttemptAt && timestamp.getTime() - lastAttemptAt < minIntervalMs) {
      const nextAt = new Date(lastAttemptAt + minIntervalMs).toISOString();
      return { ok: false, status: 'rate_limited_local', message: '本地低频保护：查询间隔不足', nextCheckAt: nextAt, session: current };
    }

    taskRunning = true;
    lastRequestAt = timestamp.getTime();
    const targetDate = resolveTargetDate(profile.dateMode, timestamp);
    let attemptSession = current;
    try {
      const attemptAt = timestamp.toISOString();
      const cutoffAt = new Date(timestamp.getTime() - minIntervalMs).toISOString();
      if (typeof repository.claimQuerySlot === 'function' && !repository.claimQuerySlot(attemptAt, cutoffAt)) {
        const latest = repository.getSessionStatus();
        const latestAttempt = Date.parse(latest.lastAttemptAt || latest.lastCheckedAt || '') || timestamp.getTime();
        return { ok: false, status: 'rate_limited_local', message: '本地低频保护：另一个查询刚已占用低频时间窗', nextCheckAt: new Date(latestAttempt + minIntervalMs).toISOString(), session: latest };
      }
      const claimed = typeof repository.claimQuerySlot === 'function'
        ? repository.getSessionStatus()
        : current;
      attemptSession = repository.saveSessionStatus({
        ...claimed,
        providerName: provider.name,
        lastCheckedAt: attemptAt,
        lastAttemptAt: attemptAt,
        message: '只读查询已发起；等待官方 GET 响应',
      }) || { ...claimed, lastCheckedAt: attemptAt, lastAttemptAt: attemptAt };
      const raw = await provider.query({ profile, targetDate });
      const haltStatus = raw?.status && isHaltedStatus(raw.status) ? raw.status : '';
      const observation = raw?.status === 'ok'
        ? normalizeProviderObservation({ ...raw, observedAt: raw.observedAt || timestamp.toISOString() })
        : failedObservation({ targetDate, profile, status: String(raw?.status || 'error'), message: raw?.message || '只读查询失败' });
      const preferred = raw?.status === 'ok' ? preferredSeats(observation.availableSeats, profile).sort() : [];
      const savedObservation = repository.insertObservation({
        ...observation,
        targetDate,
        venue: profile.venue,
        totalSeats: raw?.status === 'ok' ? PREFERRED_SEAT_MAX - PREFERRED_SEAT_MIN + 1 : 0,
        freeSeats: preferred.length,
        availableSeats: preferred,
        providerName: provider.name,
        errorCode: observation.status === 'ok' ? '' : observation.status,
      }, timestamp.toISOString());
      if (haltStatus) {
        const haltMessage = redactSensitiveText(raw?.message || `官方资源返回 ${haltStatus}，已停止查询`, 240);
        const session = repository.saveSessionStatus({ ...attemptSession, status: haltStatus, providerName: provider.name, message: haltMessage, lastCheckedAt: timestamp.toISOString(), lastAttemptAt: timestamp.toISOString(), nextCheckAt: null, consecutiveFailures: Number(attemptSession.consecutiveFailures || 0) + 1 });
        notifyStatus(haltStatus, haltMessage, timestamp);
        audit('readonly_query_halted', { status: haltStatus, targetDate, trigger });
        return { ok: false, status: haltStatus, message: session.message, observation: savedObservation, session };
      }
      if (observation.status !== 'ok') {
        const failures = Number(attemptSession.consecutiveFailures || 0) + 1;
        const paused = failures >= 3 ? SEAT_ASSISTANT_STATUSES.paused : SEAT_ASSISTANT_STATUSES.error;
        const failureMessage = redactSensitiveText(observation.message || '只读查询失败；未自动重试', 240);
        const session = repository.saveSessionStatus({ ...attemptSession, status: paused, providerName: provider.name, message: failureMessage, lastCheckedAt: timestamp.toISOString(), lastAttemptAt: timestamp.toISOString(), nextCheckAt: paused === SEAT_ASSISTANT_STATUSES.paused ? null : failureNextCheckAt(timestamp, profile, failures, random), consecutiveFailures: failures });
        if (paused === SEAT_ASSISTANT_STATUSES.paused) notifyStatus(paused, failureMessage, timestamp);
        audit('readonly_query_failed', { status: observation.status, targetDate, trigger });
        return { ok: false, status: paused, message: session.message, observation: savedObservation, session };
      }
      const notification = notifyAvailableSeats(savedObservation, profile, targetDate, timestamp);
      const nextIntervalSeconds = notification?.count === 1 && Number(notification?.remaining || 0) > 0
        ? Math.max(60, Number(profile.nearIntervalSeconds) || 60)
        : Math.max(240, Number(profile.pollIntervalSeconds) || 240) + Math.floor(random() * (Math.max(0, Number(profile.jitterSeconds) || 0) + 1));
      const nextAt = nextCheckAt(timestamp, nextIntervalSeconds);
      const session = repository.saveSessionStatus({ ...attemptSession, status: SEAT_ASSISTANT_STATUSES.connected, providerName: provider.name, message: '只读查询正常；发现座位时仅发送提醒', lastCheckedAt: timestamp.toISOString(), lastAttemptAt: timestamp.toISOString(), lastSuccessAt: timestamp.toISOString(), nextCheckAt: nextAt, consecutiveFailures: 0, lastNotifiedStatus: '' });
      audit('readonly_query_completed', { targetDate, freeSeats: savedObservation.freeSeats, trigger, notification: notification?.notified === true });
      return { ok: true, status: 'connected', observation: savedObservation, session };
    } catch (error) {
      const message = safeError(error);
      const failures = Number(attemptSession.consecutiveFailures || 0) + 1;
      const status = failures >= 3 ? SEAT_ASSISTANT_STATUSES.paused : SEAT_ASSISTANT_STATUSES.error;
      const session = repository.saveSessionStatus({ ...attemptSession, status, providerName: provider.name, message, lastCheckedAt: timestamp.toISOString(), lastAttemptAt: timestamp.toISOString(), nextCheckAt: status === SEAT_ASSISTANT_STATUSES.paused ? null : failureNextCheckAt(timestamp, profile, failures, random), consecutiveFailures: failures });
      if (status === SEAT_ASSISTANT_STATUSES.paused) notifyStatus(status, message, timestamp);
      audit('readonly_query_exception', { targetDate, trigger });
      return { ok: false, status: session.status, message: session.message, session };
    } finally {
      taskRunning = false;
    }
  }

  function createPairing() {
    const code = randomBytes(18).toString('base64url');
    const expiresAt = new Date(now().getTime() + PAIRING_TTL_MS).toISOString();
    const codeHash = createHash('sha256').update(code).digest('hex');
    const record = repository.createPairing({ codeHash, expiresAt }, now().toISOString());
    audit('pairing_created', { pairingId: Number(record?.id || 0), expiresAt }, 'owner');
    return { pairingId: Number(record?.id || 0), code, expiresAt };
  }

  function sessionPaired(actorRole = 'pairing_extension') {
    const previous = repository.getSessionStatus();
    const next = repository.saveSessionStatus({ ...previous, status: SEAT_ASSISTANT_STATUSES.disconnected, providerName: provider.name, message: '临时浏览器会话已更新，等待下一次只读查询', nextCheckAt: null, consecutiveFailures: 0 }, now().toISOString());
    audit('browser_session_paired', { previousStatus: previous.status }, actorRole);
    return next;
  }

  function sessionRevoked(actorRole = 'owner') {
    const current = repository.getSessionStatus();
    const next = repository.saveSessionStatus({ ...current, status: SEAT_ASSISTANT_STATUSES.disconnected, providerName: provider.name, message: '临时浏览器会话已断开；未发起官方查询', nextCheckAt: null, consecutiveFailures: 0 }, now().toISOString());
    audit('browser_session_revoked', {}, actorRole);
    return next;
  }

  return {
    getProfile,
    getStatus,
    saveProfile,
    refreshNow,
    createPairing,
    sessionPaired,
    sessionRevoked,
    listObservations: (limit) => repository.listObservations(limit),
    listHistory: (limit = 50) => ({ observations: repository.listObservations(limit), audit: repository.listAudit(limit), pairings: repository.listPairings(limit) }),
    deleteHistory: () => {
      const result = repository.deleteHistory();
      const current = repository.getSessionStatus();
      const session = repository.saveSessionStatus({
        ...current,
        status: SEAT_ASSISTANT_STATUSES.disconnected,
        providerName: provider.name,
        message: '本地座位数据已清除；请重新配对后恢复只读查询',
        nextCheckAt: null,
        consecutiveFailures: 0,
      });
      return { ...result, session };
    },
    isTaskRunning: () => taskRunning,
    providerStatus,
    preferredSeatRange: () => ({ min: PREFERRED_SEAT_MIN, max: PREFERRED_SEAT_MAX }),
  };
}
