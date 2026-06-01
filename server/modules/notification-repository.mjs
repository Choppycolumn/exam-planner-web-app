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

export function createNotificationRepository(sqlite) {
  const listChannels = () => sqlite.json(`SELECT id, channel_key AS channelKey, type, name, enabled,
config_json AS configJson, created_at AS createdAt, updated_at AS updatedAt
FROM notification_channels
ORDER BY enabled DESC, id;`).map(normalizeChannel);

  const listEvents = ({ status = 'all', limit = 50 } = {}) => {
    const where = status && status !== 'all' ? `WHERE status = ${sqlString(status)}` : '';
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    return sqlite.json(`SELECT id, event_key AS eventKey, source, severity, title, content, status,
scheduled_at AS scheduledAt, acknowledged_at AS acknowledgedAt, payload_json AS payloadJson,
created_at AS createdAt, updated_at AS updatedAt
FROM notification_events
${where}
ORDER BY created_at DESC, id DESC
LIMIT ${safeLimit};`).map(normalizeEvent);
  };

  const listDeliveries = (limit = 80) => sqlite.json(`SELECT id, event_id AS eventId, channel_key AS channelKey,
channel_type AS channelType, status, attempted_at AS attemptedAt, delivered_at AS deliveredAt, error,
response_json AS responseJson, created_at AS createdAt, updated_at AS updatedAt
FROM notification_deliveries
ORDER BY created_at DESC, id DESC
LIMIT ${Math.max(1, Math.min(200, Number(limit) || 80))};`).map((row) => ({
    ...row,
    response: parseJson(row.responseJson, {}),
    responseJson: undefined,
  }));

  const upsertEvent = ({ eventKey, source, severity = 'info', title, content, status = 'open', scheduledAt = null, acknowledgedAt = null, payload = {} }) => {
    const timestamp = new Date().toISOString();
    sqlite.run(`INSERT INTO notification_events (event_key, source, severity, title, content, status, scheduled_at, acknowledged_at, payload_json, created_at, updated_at)
VALUES (${sqlString(eventKey)}, ${sqlString(source)}, ${sqlString(severity)}, ${sqlString(title)}, ${sqlString(content)}, ${sqlString(status)}, ${sqlValue(scheduledAt)}, ${sqlValue(acknowledgedAt)}, ${sqlString(JSON.stringify(payload || {}))}, ${sqlString(timestamp)}, ${sqlString(timestamp)})
ON CONFLICT(event_key) DO UPDATE SET
  source = excluded.source,
  severity = excluded.severity,
  title = excluded.title,
  content = excluded.content,
  status = CASE WHEN notification_events.status = 'acknowledged' THEN notification_events.status ELSE excluded.status END,
  scheduled_at = excluded.scheduled_at,
  payload_json = excluded.payload_json,
  updated_at = excluded.updated_at;`);
  };

  const acknowledge = (id) => {
    const timestamp = new Date().toISOString();
    sqlite.run(`UPDATE notification_events
SET status = 'acknowledged', acknowledged_at = ${sqlString(timestamp)}, updated_at = ${sqlString(timestamp)}
WHERE id = ${sqlValue(Number(id))};`);
  };

  const metrics = () => {
    const row = sqlite.json(`SELECT
COUNT(*) AS total,
SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
SUM(CASE WHEN severity = 'warning' AND status <> 'acknowledged' THEN 1 ELSE 0 END) AS warnings,
SUM(CASE WHEN severity = 'critical' AND status <> 'acknowledged' THEN 1 ELSE 0 END) AS critical
FROM notification_events;`)[0] || {};
    return {
      total: Number(row.total || 0),
      open: Number(row.open || 0),
      warnings: Number(row.warnings || 0),
      critical: Number(row.critical || 0),
    };
  };

  return { listChannels, listEvents, listDeliveries, upsertEvent, acknowledge, metrics };
}
