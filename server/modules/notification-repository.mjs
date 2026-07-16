import { sqlString, sqlValue } from './sqlite-repository.mjs';

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeEvent(row) {
  return {
    id: Number(row.id),
    eventKey: row.eventKey,
    source: row.source,
    severity: row.severity,
    title: row.title,
    content: row.content,
    status: row.status,
    scheduledAt: row.scheduledAt || null,
    acknowledgedAt: row.acknowledgedAt || null,
    payload: parseJson(row.payloadJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeChannel(row) {
  return {
    id: Number(row.id),
    channelKey: row.channelKey,
    type: row.type,
    name: row.name,
    enabled: Boolean(row.enabled),
    config: parseJson(row.configJson, {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeDelivery(row) {
  const stored = parseJson(row.responseJson, {});
  return {
    ...row,
    id: Number(row.id),
    eventId: Number(row.eventId),
    attemptCount: Number(row.attemptCount || 0),
    maxAttempts: Number(row.maxAttempts || 0),
    payload: stored.request || stored,
    response: stored.result || stored,
    responseJson: undefined,
  };
}

export function createNotificationRepository(sqlite) {
  const normalizeHealth = (row) => row ? {
    channelKey: row.channelKey,
    status: row.status,
    consecutiveFailures: Number(row.consecutiveFailures || 0),
    successCount: Number(row.successCount || 0),
    failureCount: Number(row.failureCount || 0),
    lastSuccessAt: row.lastSuccessAt || null,
    lastFailureAt: row.lastFailureAt || null,
    circuitOpenUntil: row.circuitOpenUntil || null,
    lastError: row.lastError || '',
    action: row.action || '',
    updatedAt: row.updatedAt,
  } : null;

  const listChannels = () => sqlite.json(`SELECT id, channel_key AS channelKey, type, name, enabled,
config_json AS configJson, created_at AS createdAt, updated_at AS updatedAt
FROM notification_channels
ORDER BY enabled DESC, id;`).map(normalizeChannel);

  const listEvents = ({ status = 'all', limit = 50 } = {}) => {
    const where = status && status !== 'all'
      ? status === 'warning' || status === 'critical'
        ? `WHERE severity = ${sqlString(status)}`
        : `WHERE status = ${sqlString(status)}`
      : '';
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return sqlite.json(`SELECT id, event_key AS eventKey, source, severity, title, content, status,
scheduled_at AS scheduledAt, acknowledged_at AS acknowledgedAt, payload_json AS payloadJson,
created_at AS createdAt, updated_at AS updatedAt
FROM notification_events
${where}
ORDER BY created_at DESC, id DESC
LIMIT ${safeLimit};`).map(normalizeEvent);
  };

  const deliverySelect = `SELECT id, event_id AS eventId, channel_key AS channelKey,
channel_type AS channelType, status, mode, attempt_count AS attemptCount, max_attempts AS maxAttempts,
next_attempt_at AS nextAttemptAt, last_attempt_at AS lastAttemptAt, attempted_at AS attemptedAt,
accepted_at AS acceptedAt, delivered_at AS deliveredAt, error, response_json AS responseJson,
created_at AS createdAt, updated_at AS updatedAt
FROM notification_deliveries`;

  const listDeliveries = (limit = 80) => sqlite.json(`${deliverySelect}
ORDER BY created_at DESC, id DESC
LIMIT ${Math.max(1, Math.min(200, Number(limit) || 80))};`).map(normalizeDelivery);

  const upsertEvent = ({ eventKey, source, severity = 'info', title, content, status = 'notified', scheduledAt = null, acknowledgedAt = null, payload = {} }) => {
    const timestamp = new Date().toISOString();
    sqlite.run(`INSERT INTO notification_events (event_key, source, severity, title, content, status, scheduled_at, acknowledged_at, payload_json, created_at, updated_at)
VALUES (${sqlString(eventKey)}, ${sqlString(source)}, ${sqlString(severity)}, ${sqlString(title)}, ${sqlString(content)}, ${sqlString(status)}, ${sqlValue(scheduledAt)}, ${sqlValue(acknowledgedAt)}, ${sqlString(JSON.stringify(payload || {}))}, ${sqlString(timestamp)}, ${sqlString(timestamp)})
ON CONFLICT(event_key) DO UPDATE SET
  source = excluded.source,
  severity = excluded.severity,
  title = excluded.title,
  content = excluded.content,
  status = excluded.status,
  scheduled_at = excluded.scheduled_at,
  payload_json = excluded.payload_json,
  updated_at = excluded.updated_at;`);
    return sqlite.json(`SELECT id, event_key AS eventKey, source, severity, title, content, status,
scheduled_at AS scheduledAt, acknowledged_at AS acknowledgedAt, payload_json AS payloadJson,
created_at AS createdAt, updated_at AS updatedAt
FROM notification_events WHERE event_key = ${sqlString(eventKey)} LIMIT 1;`).map(normalizeEvent)[0];
  };

  const enqueueDelivery = ({ eventId, channelKey, channelType, mode = 'proactive', payload = {}, maxAttempts = 4, nextAttemptAt }) => {
    const timestamp = new Date().toISOString();
    sqlite.run(`INSERT INTO notification_deliveries
(event_id, channel_key, channel_type, status, mode, attempt_count, max_attempts, next_attempt_at, response_json, created_at, updated_at)
VALUES (${sqlValue(eventId)}, ${sqlString(channelKey)}, ${sqlString(channelType)}, 'queued', ${sqlString(mode)}, 0,
${sqlValue(maxAttempts)}, ${sqlValue(nextAttemptAt || timestamp)}, ${sqlString(JSON.stringify(payload))}, ${sqlString(timestamp)}, ${sqlString(timestamp)});`);
    return sqlite.json(`${deliverySelect}
WHERE event_id = ${sqlValue(eventId)} AND channel_key = ${sqlString(channelKey)}
ORDER BY id DESC LIMIT 1;`).map(normalizeDelivery)[0];
  };

  const claimDueDeliveries = ({ now, staleBefore, limit = 10 }) => sqlite.json(`${deliverySelect}
WHERE (
  status IN ('queued', 'retrying') AND (next_attempt_at IS NULL OR next_attempt_at <= ${sqlString(now)})
) OR (
  status = 'sending' AND last_attempt_at <= ${sqlString(staleBefore)}
)
ORDER BY COALESCE(next_attempt_at, created_at), id
LIMIT ${Math.max(1, Math.min(50, Number(limit) || 10))};`).map(normalizeDelivery);

  const markDeliverySending = (id, timestamp) => sqlite.run(`UPDATE notification_deliveries
SET status = 'sending', last_attempt_at = ${sqlString(timestamp)}, attempted_at = ${sqlString(timestamp)},
    updated_at = ${sqlString(timestamp)}
WHERE id = ${sqlValue(Number(id))};`);

  const markDeliveryAccepted = (id, { attemptedAt, response = {} }) => sqlite.run(`UPDATE notification_deliveries
SET status = 'accepted', attempt_count = attempt_count + 1, last_attempt_at = ${sqlString(attemptedAt)},
    attempted_at = ${sqlString(attemptedAt)}, accepted_at = ${sqlString(attemptedAt)}, next_attempt_at = NULL,
    error = NULL, response_json = ${sqlString(JSON.stringify(response))}, updated_at = ${sqlString(attemptedAt)}
WHERE id = ${sqlValue(Number(id))};`);

  const markDeliveryFailed = (id, { attemptedAt, nextAttemptAt = null, error = '', response = {}, retrying = false }) => sqlite.run(`UPDATE notification_deliveries
SET status = ${sqlString(retrying ? 'retrying' : 'failed')}, attempt_count = attempt_count + 1,
    last_attempt_at = ${sqlString(attemptedAt)}, attempted_at = ${sqlString(attemptedAt)},
    next_attempt_at = ${sqlValue(nextAttemptAt)}, error = ${sqlString(error)},
    response_json = ${sqlString(JSON.stringify(response))}, updated_at = ${sqlString(attemptedAt)}
WHERE id = ${sqlValue(Number(id))};`);

  const deferDelivery = (id, { nextAttemptAt, reason = '' }) => {
    const timestamp = new Date().toISOString();
    sqlite.run(`UPDATE notification_deliveries
SET status = 'retrying', next_attempt_at = ${sqlString(nextAttemptAt)}, error = ${sqlString(reason)}, updated_at = ${sqlString(timestamp)}
WHERE id = ${sqlValue(Number(id))};`);
  };

  const acknowledge = (id) => {
    const timestamp = new Date().toISOString();
    sqlite.run(`UPDATE notification_events
SET status = 'notified', acknowledged_at = ${sqlString(timestamp)}, updated_at = ${sqlString(timestamp)}
WHERE id = ${sqlValue(Number(id))};`);
  };

  const requeueDelivery = (id) => {
    const timestamp = new Date().toISOString();
    sqlite.run(`UPDATE notification_deliveries
SET status = 'queued', next_attempt_at = ${sqlString(timestamp)}, error = NULL, updated_at = ${sqlString(timestamp)}
WHERE id = ${sqlValue(Number(id))} AND status = 'failed';`);
  };

  const cancelPendingDeliveriesByEventPrefix = (eventKeyPrefix, reason = 'suppressed') => {
    const timestamp = new Date().toISOString();
    const pattern = `${String(eventKeyPrefix || '')}%`;
    sqlite.run(`UPDATE notification_deliveries
SET status = 'cancelled', next_attempt_at = NULL, error = ${sqlString(reason)}, updated_at = ${sqlString(timestamp)}
WHERE status IN ('queued', 'retrying') AND event_id IN (
  SELECT id FROM notification_events WHERE event_key LIKE ${sqlString(pattern)}
);`);
    sqlite.run(`UPDATE notification_events
SET status = 'suppressed', updated_at = ${sqlString(timestamp)}
WHERE event_key LIKE ${sqlString(pattern)} AND status != 'suppressed';`);
  };

  const metrics = () => {
    const row = sqlite.json(`SELECT
COUNT(*) AS total,
SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS recent,
SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) AS warnings,
SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical
FROM notification_events;`)[0] || {};
    return {
      total: Number(row.total || 0),
      open: Number(row.recent || row.open || 0),
      warnings: Number(row.warnings || 0),
      critical: Number(row.critical || 0),
    };
  };

  const healthSelect = `SELECT channel_key AS channelKey, status,
consecutive_failures AS consecutiveFailures, success_count AS successCount,
failure_count AS failureCount, last_success_at AS lastSuccessAt,
last_failure_at AS lastFailureAt, circuit_open_until AS circuitOpenUntil,
last_error AS lastError, action, updated_at AS updatedAt
FROM notification_channel_health`;

  const getChannelHealth = (channelKey) => normalizeHealth(sqlite.json(`${healthSelect}
WHERE channel_key = ? LIMIT 1;`, [channelKey])[0]);

  const listChannelHealth = () => sqlite.json(`${healthSelect}
ORDER BY channel_key;`).map(normalizeHealth);

  const saveChannelHealth = (health) => sqlite.execute(`INSERT INTO notification_channel_health (
channel_key, status, consecutive_failures, success_count, failure_count,
last_success_at, last_failure_at, circuit_open_until, last_error, action, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(channel_key) DO UPDATE SET
status=excluded.status,
consecutive_failures=excluded.consecutive_failures,
success_count=excluded.success_count,
failure_count=excluded.failure_count,
last_success_at=excluded.last_success_at,
last_failure_at=excluded.last_failure_at,
circuit_open_until=excluded.circuit_open_until,
last_error=excluded.last_error,
action=excluded.action,
updated_at=excluded.updated_at;`, [
    health.channelKey,
    health.status,
    health.consecutiveFailures,
    health.successCount,
    health.failureCount,
    health.lastSuccessAt,
    health.lastFailureAt,
    health.circuitOpenUntil,
    health.lastError,
    health.action,
    health.updatedAt,
  ]);

  const channelDeliveryMetrics = () => sqlite.json(`SELECT channel_key AS channelKey,
SUM(CASE WHEN status = 'accepted' AND updated_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS acceptedLast24h,
SUM(CASE WHEN status IN ('failed', 'retrying') AND updated_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS failedLast24h
FROM notification_deliveries
GROUP BY channel_key;`).map((row) => ({
    channelKey: row.channelKey,
    acceptedLast24h: Number(row.acceptedLast24h || 0),
    failedLast24h: Number(row.failedLast24h || 0),
  }));

  return {
    listChannels,
    listEvents,
    listDeliveries,
    upsertEvent,
    enqueueDelivery,
    claimDueDeliveries,
    markDeliverySending,
    markDeliveryAccepted,
    markDeliveryFailed,
    deferDelivery,
    acknowledge,
    requeueDelivery,
    cancelPendingDeliveriesByEventPrefix,
    metrics,
    getChannelHealth,
    listChannelHealth,
    saveChannelHealth,
    channelDeliveryMetrics,
  };
}
