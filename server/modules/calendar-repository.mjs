export function createCalendarRepository(sqlite) {
  const getEvents = ({ from, to, userId, includeNotifications = false }) => {
    const scopedUserId = Number(userId);
    if (!Number.isInteger(scopedUserId) || scopedUserId < 1) throw new Error('valid user context is required');
    const start = from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = to || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const study = sqlite.json(`SELECT date, COALESCE(SUM(minutes), 0) AS minutes
FROM study_time_records
WHERE user_id=? AND date BETWEEN ? AND ?
GROUP BY date;`, [scopedUserId, start, end]).map((row) => ({
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
WHERE user_id=? AND date BETWEEN ? AND ?;`, [scopedUserId, start, end]).map((row) => ({
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
WHERE user_id=? AND due_date BETWEEN ? AND ?;`, [scopedUserId, start, end]).map((row) => ({
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
WHERE user_id=? AND period_end BETWEEN ? AND ?;`, [scopedUserId, start, end]).map((row) => ({
      id: `report-${row.id}`,
      date: row.date,
      type: 'report',
      title: row.title,
      detail: `${row.periodStart} 至 ${row.date}`,
      tone: 'blue',
      value: row.kind,
    }));
    const notifications = includeNotifications ? sqlite.json(`SELECT id, title, severity, substr(created_at, 1, 10) AS date, content
FROM notification_events
WHERE substr(created_at, 1, 10) BETWEEN ? AND ?
ORDER BY created_at DESC
LIMIT 80;`, [start, end]).map((row) => ({
      id: `notification-${row.id}`,
      date: row.date,
      type: 'notification',
      title: row.title,
      detail: row.content,
      tone: row.severity === 'critical' ? 'rose' : row.severity === 'warning' ? 'amber' : 'slate',
      value: row.severity,
    })) : [];
    return [...study, ...reviews, ...tasks, ...reports, ...notifications].sort((a, b) => a.date.localeCompare(b.date));
  };

  return { getEvents };
}
