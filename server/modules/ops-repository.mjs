export function createOpsRepository(sqlite) {
  const writeAuditEvent = ({ action, actorRole, clientHash, detail, createdAt }) => {
    sqlite.execute(`INSERT INTO audit_events(action,actor_role,client_hash,detail_json,created_at)
VALUES(?,?,?,?,?);`, [
      String(action || ''),
      String(actorRole || ''),
      String(clientHash || ''),
      JSON.stringify(detail || {}),
      String(createdAt),
    ]);
  };

  const writeApiRequest = ({ method, path, statusCode, durationMs, role, error, createdAt }) => {
    sqlite.execute(`INSERT INTO api_request_log(method,path,status_code,duration_ms,role,error,created_at)
VALUES(?,?,?,?,?,?,?);`, [
      String(method || 'GET'),
      String(path || '/'),
      Number(statusCode || 0),
      Number(durationMs || 0),
      String(role || ''),
      String(error || ''),
      String(createdAt),
    ]);
  };

  const writeClientError = ({
    source, path, message, stack, componentStack, role, clientHash, userAgent, createdAt,
  }) => {
    const result = sqlite.execute(`INSERT INTO client_error_log(
source,path,message,stack,component_stack,role,client_hash,user_agent,created_at)
VALUES(?,?,?,?,?,?,?,?,?);`, [
      String(source || ''),
      String(path || ''),
      String(message || ''),
      String(stack || ''),
      String(componentStack || ''),
      String(role || ''),
      String(clientHash || ''),
      String(userAgent || ''),
      String(createdAt),
    ]);
    return Number(result.lastInsertRowid || 0);
  };

  const recordVisit = ({ path, method, role, clientHash, userAgent, createdAt }) => {
    sqlite.execute(`INSERT INTO visit_events(path,method,role,client_hash,user_agent,created_at)
VALUES(?,?,?,?,?,?);`, [path, method, role, clientHash, userAgent, createdAt]);
  };

  const getVisitStats = ({ today, start7, start14 }) => {
    const dailyRows = sqlite.json(`SELECT substr(created_at,1,10) AS date,
COUNT(*) AS visits,COUNT(DISTINCT client_hash) AS uniqueVisitors
FROM visit_events WHERE substr(created_at,1,10) BETWEEN ? AND ?
GROUP BY substr(created_at,1,10) ORDER BY date;`, [start14, today]);
    const total = Number(sqlite.scalar('SELECT COUNT(*) FROM visit_events;') || 0);
    const todayCount = Number(sqlite.scalar(
      'SELECT COUNT(*) FROM visit_events WHERE substr(created_at,1,10)=?;',
      [today],
    ) || 0);
    const last7 = Number(sqlite.scalar(
      'SELECT COUNT(*) FROM visit_events WHERE substr(created_at,1,10) BETWEEN ? AND ?;',
      [start7, today],
    ) || 0);
    const uniqueVisitors7 = Number(sqlite.scalar(
      'SELECT COUNT(DISTINCT client_hash) FROM visit_events WHERE substr(created_at,1,10) BETWEEN ? AND ?;',
      [start7, today],
    ) || 0);
    const topPaths = sqlite.json(`SELECT path,COUNT(*) AS visits
FROM visit_events WHERE substr(created_at,1,10) BETWEEN ? AND ?
GROUP BY path ORDER BY visits DESC,path LIMIT 8;`, [start14, today]);
    const latest = sqlite.json(`SELECT path,role,user_agent AS userAgent,created_at AS createdAt
FROM visit_events ORDER BY created_at DESC LIMIT 12;`);
    return { dailyRows, total, todayCount, last7, uniqueVisitors7, topPaths, latest };
  };

  const pruneOperationalData = ({ visitBefore, apiBefore, clientErrorBefore, taskRunBefore }) => {
    sqlite.transaction((connection) => {
      connection.prepare('DELETE FROM visit_events WHERE substr(created_at,1,10)<?;').run(visitBefore);
      connection.prepare('DELETE FROM api_request_log WHERE substr(created_at,1,10)<?;').run(apiBefore);
      connection.prepare('DELETE FROM client_error_log WHERE substr(created_at,1,10)<?;').run(clientErrorBefore);
      connection.prepare('DELETE FROM task_runs WHERE substr(started_at,1,10)<?;').run(taskRunBefore);
    });
  };

  const sqliteProbe = () => Number(sqlite.scalar('SELECT 1;') || 0) === 1;

  const requiredTableCount = () => Number(sqlite.scalar(
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('goals','short_term_tasks','daily_reviews');",
  ) || 0);

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
SUM(CASE WHEN status_code >= 500 AND created_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS serverErrorsLast24h,
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
      serverErrorsLast24h: Number(totals.serverErrorsLast24h || 0),
      clientErrors: Number(totals.clientErrors || 0),
      averageDurationMs: totals.averageDurationMs == null ? null : Number(totals.averageDurationMs),
      maxDurationMs: totals.maxDurationMs == null ? null : Number(totals.maxDurationMs),
      slowest,
    };
  };

  const listClientErrors = (limit = 12) => {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
    return sqlite.json(`SELECT source, path, message, role, created_at AS createdAt
FROM client_error_log
ORDER BY created_at DESC, id DESC
LIMIT ${safeLimit};`);
  };

  const getClientErrorMetrics = () => {
    const totals = sqlite.json(`SELECT
COUNT(*) AS total,
SUM(CASE WHEN created_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS last24h,
SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS last7d,
MAX(created_at) AS latestAt
FROM client_error_log;`)[0] || {};
    const bySource = sqlite.json(`SELECT source, COUNT(*) AS count
FROM client_error_log
WHERE created_at >= datetime('now', '-7 days')
GROUP BY source
ORDER BY count DESC, source ASC;`).map((row) => ({ source: row.source, count: Number(row.count || 0) }));
    return {
      total: Number(totals.total || 0),
      last24h: Number(totals.last24h || 0),
      last7d: Number(totals.last7d || 0),
      latestAt: totals.latestAt || null,
      bySource,
    };
  };

  return {
    writeAuditEvent,
    writeApiRequest,
    writeClientError,
    recordVisit,
    getVisitStats,
    pruneOperationalData,
    sqliteProbe,
    requiredTableCount,
    listAuditEvents,
    listSlowApi,
    getApiMetrics,
    listClientErrors,
    getClientErrorMetrics,
  };
}
