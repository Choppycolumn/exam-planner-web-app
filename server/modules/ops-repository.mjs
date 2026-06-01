export function createOpsRepository(sqlite) {
  const listAuditEvents = (limit = 12) => {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
    return sqlite.json(`SELECT action, actor_role AS actorRole, detail_json AS detailJson, created_at AS createdAt
FROM audit_events
ORDER BY created_at DESC, id DESC
LIMIT ${safeLimit};`).map((row) => ({
      action: row.action,
      actorRole: row.actorRole,
      detail: row.detailJson ? JSON.parse(row.detailJson) : {},
      createdAt: row.createdAt,
    }));
  };

  const listSlowApi = (limit = 12) => {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
    return sqlite.json(`SELECT method, path, status_code AS statusCode, duration_ms AS durationMs, error, created_at AS createdAt
FROM api_request_log
ORDER BY created_at DESC, id DESC
LIMIT ${safeLimit};`);
  };

  const getApiMetrics = () => {
    const totals = sqlite.json(`SELECT
COUNT(*) AS logged,
SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS serverErrors,
SUM(CASE WHEN status_code >= 400 AND status_code < 500 THEN 1 ELSE 0 END) AS clientErrors,
ROUND(AVG(duration_ms), 0) AS averageDurationMs,
MAX(duration_ms) AS maxDurationMs
FROM api_request_log;`)[0] || {};
    const slowest = sqlite.json(`SELECT method, path, status_code AS statusCode, duration_ms AS durationMs, created_at AS createdAt
FROM api_request_log
ORDER BY duration_ms DESC, created_at DESC
LIMIT 8;`);
    return {
      logged: Number(totals.logged || 0),
      serverErrors: Number(totals.serverErrors || 0),
      clientErrors: Number(totals.clientErrors || 0),
      averageDurationMs: totals.averageDurationMs == null ? null : Number(totals.averageDurationMs),
      maxDurationMs: totals.maxDurationMs == null ? null : Number(totals.maxDurationMs),
      slowest,
    };
  };

  return { listAuditEvents, listSlowApi, getApiMetrics };
}
