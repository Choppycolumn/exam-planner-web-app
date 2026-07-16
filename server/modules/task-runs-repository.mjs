export function createTaskRunsRepository(sqlite) {
  const start = ({ taskName, trigger, startedAt, metadata = {} }) => Number(sqlite.scalar(`INSERT INTO task_runs
(task_name, trigger, status, started_at, metadata_json)
VALUES (?, ?, 'running', ?, ?)
RETURNING id;`, [taskName, trigger, startedAt, JSON.stringify(metadata || {})]) || 0);

  const complete = (id, { finishedAt, durationMs, metadata = {} }) => sqlite.execute(`UPDATE task_runs
SET status = 'completed', finished_at = ?, duration_ms = ?, metadata_json = ?
WHERE id = ?;`, [finishedAt, durationMs, JSON.stringify(metadata || {}), Number(id)]);

  const fail = (id, { finishedAt, durationMs, error = '' }) => sqlite.execute(`UPDATE task_runs
SET status = 'failed', finished_at = ?, duration_ms = ?, error = ?
WHERE id = ?;`, [finishedAt, durationMs, error, Number(id)]);

  const listLatest = (limit = 12) => {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 12));
    return sqlite.json(`SELECT id, task_name AS taskName, trigger, status, started_at AS startedAt, finished_at AS finishedAt,
duration_ms AS durationMs, error, metadata_json AS metadataJson
FROM task_runs
ORDER BY started_at DESC, id DESC
LIMIT ${safeLimit};`).map((row) => ({
      ...row,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : {},
      metadataJson: undefined,
    }));
  };

  const getMetrics = () => {
    const totals = sqlite.json(`SELECT
COUNT(*) AS total,
SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running,
SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
SUM(CASE WHEN status = 'failed' AND started_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS failedLast24h,
SUM(CASE WHEN started_at >= datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS last24h,
ROUND(AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END), 0) AS averageDurationMs,
MAX(duration_ms) AS maxDurationMs
FROM task_runs;`)[0] || {};
    const byName = sqlite.json(`SELECT task_name AS taskName,
COUNT(*) AS total,
SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
MAX(started_at) AS lastStartedAt,
ROUND(AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END), 0) AS averageDurationMs
FROM task_runs
GROUP BY task_name
ORDER BY lastStartedAt DESC
LIMIT 12;`);
    return {
      total: Number(totals.total || 0),
      running: Number(totals.running || 0),
      completed: Number(totals.completed || 0),
      failed: Number(totals.failed || 0),
      failedLast24h: Number(totals.failedLast24h || 0),
      last24h: Number(totals.last24h || 0),
      averageDurationMs: totals.averageDurationMs == null ? null : Number(totals.averageDurationMs),
      maxDurationMs: totals.maxDurationMs == null ? null : Number(totals.maxDurationMs),
      byName: byName.map((row) => ({
        taskName: row.taskName,
        total: Number(row.total || 0),
        failed: Number(row.failed || 0),
        lastStartedAt: row.lastStartedAt || null,
        averageDurationMs: row.averageDurationMs == null ? null : Number(row.averageDurationMs),
      })),
    };
  };

  return { start, complete, fail, listLatest, getMetrics };
}
