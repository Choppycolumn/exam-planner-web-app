export function createCalendarRepository(sqlite) {
  const getEvents = ({ from, to }) => {
    const start = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = to || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const sqlStart = `'${String(start).replace(/'/g, "''")}'`;
    const sqlEnd = `'${String(end).replace(/'/g, "''")}'`;
    const study = sqlite.json(`SELECT date, COALESCE(SUM(minutes), 0) AS minutes
FROM study_time_records
WHERE date BETWEEN ${sqlStart} AND ${sqlEnd}
GROUP BY date;`).map((row) => ({
      id: `study-${row.date}`,
      date: row.date,
      type: 'study',
      title: `学习 ${row.minutes} 分钟`,
      detail: '',
      tone: Number(row.minutes || 0) >= 180 ? 'emerald' : 'blue',
      value: Number(row.minutes || 0),
    }));
    const reviews = sqlite.json(`SELECT date, score, summary
FROM daily_reviews
WHERE date BETWEEN ${sqlStart} AND ${sqlEnd};`).map((row) => ({
      id: `review-${row.date}`,
      date: row.date,
      type: 'review',
      title: `复盘${row.score == null ? '' : ` ${row.score} 分`}`,
      detail: row.summary || '',
      tone: 'slate',
      value: row.score == null ? null : Number(row.score),
    }));
    const tasks = sqlite.json(`SELECT id, title, due_date AS date, urgency, is_completed AS isCompleted
FROM short_term_tasks
WHERE due_date BETWEEN ${sqlStart} AND ${sqlEnd};`).map((row) => ({
      id: `task-${row.id}`,
      date: row.date,
      type: 'task',
      title: row.title,
      detail: row.isCompleted ? '已完成' : row.urgency,
      tone: row.isCompleted ? 'emerald' : row.urgency === 'high' ? 'rose' : 'amber',
      value: Number(row.id),
    }));
    const reports = sqlite.json(`SELECT id, kind, title, period_start AS periodStart, period_end AS date
FROM learning_reports
WHERE period_end BETWEEN ${sqlStart} AND ${sqlEnd};`).map((row) => ({
      id: `report-${row.id}`,
      date: row.date,
      type: 'report',
      title: row.title,
      detail: `${row.periodStart} 至 ${row.date}`,
      tone: 'blue',
      value: row.kind,
    }));
    const notifications = sqlite.json(`SELECT id, title, severity, substr(created_at, 1, 10) AS date, content
FROM notification_events
WHERE substr(created_at, 1, 10) BETWEEN ${sqlStart} AND ${sqlEnd}
ORDER BY created_at DESC
LIMIT 80;`).map((row) => ({
      id: `notification-${row.id}`,
      date: row.date,
      type: 'notification',
      title: row.title,
      detail: row.content,
      tone: row.severity === 'critical' ? 'rose' : row.severity === 'warning' ? 'amber' : 'slate',
      value: row.severity,
    }));
    return [...study, ...reviews, ...tasks, ...reports, ...notifications].sort((a, b) => a.date.localeCompare(b.date));
  };

  return { getEvents };
}
