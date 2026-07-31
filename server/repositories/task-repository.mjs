const taskSelect = `SELECT id,title,due_date AS dueDate,due_time AS dueTime,urgency,
is_completed AS isCompleted,completed_at AS completedAt,reminder_enabled AS reminderEnabled,
reminder_sent_offsets AS reminderSentOffsets,reminder_last_sent_at AS reminderLastSentAt,note
FROM short_term_tasks`;

export function createTaskRepository(database, { ownerUserId } = {}) {
  if (typeof ownerUserId !== 'function') throw new Error('ownerUserId resolver is required');
  const ownerId = () => Number(ownerUserId());
  const safeLimit = (value, fallback, maximum) => Math.max(1, Math.min(maximum, Number(value) || fallback));

  return {
    listOwnerDueThrough(endDate, limit = 30) {
      return database.json(`${taskSelect}
WHERE user_id=? AND is_completed=0 AND due_date<=?
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,due_date,due_time,id
LIMIT ?;`, [ownerId(), endDate, safeLimit(limit, 30, 50)]);
    },
    listOwnerOpen(limit = 26) {
      return database.json(`${taskSelect}
WHERE user_id=? AND is_completed=0
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,due_date,due_time,id
LIMIT ?;`, [ownerId(), safeLimit(limit, 26, 26)]);
    },
    findOwnerById(id, { includeCompleted = false } = {}) {
      return database.json(`${taskSelect}
WHERE user_id=? AND id=? ${includeCompleted ? '' : 'AND is_completed=0'} LIMIT 1;`, [ownerId(), Number(id)])[0] || null;
    },
    findOwnerByTitle(pattern, { includeCompleted = false, limit = 6 } = {}) {
      return database.json(`${taskSelect}
WHERE user_id=? AND title LIKE ? ${includeCompleted ? '' : 'AND is_completed=0'}
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,due_date,due_time,id
LIMIT ?;`, [ownerId(), pattern, safeLimit(limit, 6, 20)]);
    },
    completeOwnerTask(id, updatedAt) {
      return database.execute(`UPDATE short_term_tasks
SET is_completed=1,completed_at=?,updated_at=? WHERE id=? AND user_id=?;`, [updatedAt, updatedAt, Number(id), ownerId()]);
    },
    deleteOwnerTask(id) {
      return database.execute('DELETE FROM short_term_tasks WHERE id=? AND user_id=?;', [Number(id), ownerId()]);
    },
    listOwnerTimedReminders(scanDate, forwardDate) {
      return database.json(`${taskSelect}
WHERE user_id=? AND is_completed=0 AND reminder_enabled=1 AND due_time<>''
AND due_date>=? AND due_date<=?
ORDER BY due_date,due_time,id;`, [ownerId(), scanDate, forwardDate]);
    },
    markReminderSent(id, offsets, updatedAt) {
      return database.execute(`UPDATE short_term_tasks
SET reminder_sent_offsets=?,reminder_last_sent_at=?,updated_at=?
WHERE id=? AND user_id=?;`, [JSON.stringify(offsets), updatedAt, updatedAt, Number(id), ownerId()]);
    },
    delayOwnerTask(id, dueDate, updatedAt) {
      return database.execute('UPDATE short_term_tasks SET due_date=?,updated_at=? WHERE id=? AND user_id=?;', [dueDate, updatedAt, Number(id), ownerId()]);
    },
  };
}
