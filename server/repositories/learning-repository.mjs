function requireUserId(contextOrId) {
  const userId = Number(typeof contextOrId === 'object' ? contextOrId?.userId : contextOrId);
  if (!Number.isInteger(userId) || userId < 1) throw new Error('valid user context is required');
  return userId;
}

function normalizeDueTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
    ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    : '';
}

function normalizeOffsets(value) {
  let items = value;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { items = []; }
  }
  if (!Array.isArray(items)) return [];
  return [...new Set(items.map(Number).filter((item) => Number.isInteger(item) && item >= 0 && item <= 30 * 24 * 60))].sort((a, b) => a - b);
}

function reviewFields(payload = {}) {
  return {
    summary: String(payload.summary || ''),
    wins: String(payload.wins || ''),
    problems: String(payload.problems || ''),
    tomorrowPlan: String(payload.tomorrowPlan || payload.tomorrow_plan || ''),
    score: Math.max(1, Math.min(10, Number(payload.score || 6))),
  };
}

function problemRow(row) {
  return row ? {
    id: Number(row.id),
    date: row.date,
    text: row.text,
    status: row.status,
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt || null,
  } : null;
}

export function createLearningRepository(database, {
  nowISO = () => new Date().toISOString(),
  todayISO = () => new Date().toISOString().slice(0, 10),
  entitySchemaVersion = 1,
  onChange = () => {},
  onOwnerStudyChanged = () => {},
  ownerUserId,
} = {}) {
  if (typeof ownerUserId !== 'function') throw new Error('ownerUserId resolver is required');
  const nextId = (connection, table) => Number(connection.prepare(`SELECT COALESCE(MAX(id),0)+1 AS id FROM ${table};`).get()?.id || 1);

  function listReviews({ from, to, limit, offset = 0 }, contextOrId) {
    const userId = requireUserId(contextOrId);
    const total = Number(database.scalar('SELECT COUNT(*) FROM daily_reviews WHERE user_id=? AND date BETWEEN ? AND ?;', [userId, from, to]) || 0);
    const paging = limit ? ' LIMIT ? OFFSET ?' : '';
    const parameters = limit ? [userId, from, to, limit, offset] : [userId, from, to];
    const reviews = database.json(`SELECT id,date,summary,wins,problems,
tomorrow_plan AS tomorrowPlan,score,schema_version AS schemaVersion,
created_at AS createdAt,updated_at AS updatedAt
FROM daily_reviews WHERE user_id=? AND date BETWEEN ? AND ?
ORDER BY date DESC${paging};`, parameters);
    return { total, reviews };
  }

  function listStudyRecords(date, contextOrId) {
    const userId = requireUserId(contextOrId);
    return database.json(`SELECT id,date,project_id AS projectId,
project_name_snapshot AS projectNameSnapshot,minutes,note,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM study_time_records WHERE date=? AND user_id=? ORDER BY project_id;`, [date, userId]);
  }

  function saveGoal(payload, contextOrId) {
    const userId = requireUserId(contextOrId);
    const connection = database.open();
    const timestamp = nowISO();
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const existing = payload.id ? connection.prepare('SELECT id FROM goals WHERE id=? AND user_id=?;').get(Number(payload.id), userId) : null;
      if (payload.isActive) connection.prepare('UPDATE goals SET is_active=0,updated_at=? WHERE user_id=? AND id<>?;').run(timestamp, userId, Number(payload.id || 0));
      if (existing) {
        connection.prepare(`UPDATE goals SET name=?,description=?,deadline=?,is_active=?,type=?,notes=?,updated_at=?
WHERE id=? AND user_id=?;`).run(payload.name || '', payload.description || '', payload.deadline || todayISO(), payload.isActive ? 1 : 0, payload.type || '考研', payload.notes || '', timestamp, Number(payload.id), userId);
        connection.exec('COMMIT;');
        onChange();
        return Number(payload.id);
      }
      const id = nextId(connection, 'goals');
      connection.prepare(`INSERT INTO goals
(id,user_id,name,description,deadline,is_active,type,notes,schema_version,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?);`).run(id, userId, payload.name || '', payload.description || '', payload.deadline || todayISO(), payload.isActive !== false ? 1 : 0, payload.type || '考研', payload.notes || '', entitySchemaVersion, timestamp, timestamp);
      connection.exec('COMMIT;');
      onChange();
      return id;
    } catch (error) {
      try { connection.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function saveProject(payload, contextOrId) {
    const userId = requireUserId(contextOrId);
    const connection = database.open();
    const timestamp = nowISO();
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const existing = payload.id ? connection.prepare('SELECT id FROM study_projects WHERE id=? AND user_id=?;').get(Number(payload.id), userId) : null;
      if (payload.id && !existing) {
        const error = new Error('Project does not belong to this account');
        error.statusCode = 403;
        throw error;
      }
      if (existing) {
        connection.prepare(`UPDATE study_projects SET name=?,color=?,is_active=?,sort_order=?,updated_at=?
WHERE id=? AND user_id=?;`).run(payload.name || '', payload.color || '#2563eb', payload.isActive !== false ? 1 : 0, Number(payload.sortOrder || 0), timestamp, Number(payload.id), userId);
        connection.exec('COMMIT;');
        onChange();
        return Number(payload.id);
      }
      const id = nextId(connection, 'study_projects');
      const sortOrder = Number(payload.sortOrder || connection.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS value FROM study_projects WHERE user_id=?;').get(userId)?.value || id);
      connection.prepare(`INSERT INTO study_projects
(id,user_id,name,color,is_active,sort_order,schema_version,created_at,updated_at)
VALUES(?,?,?,?,1,?,?,?,?);`).run(id, userId, payload.name || '', payload.color || '#2563eb', sortOrder, entitySchemaVersion, timestamp, timestamp);
      connection.exec('COMMIT;');
      onChange();
      return id;
    } catch (error) {
      try { connection.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function saveSubject(payload, contextOrId) {
    const userId = requireUserId(contextOrId);
    const connection = database.open();
    const timestamp = nowISO();
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const existing = payload.id ? connection.prepare('SELECT id FROM subjects WHERE id=? AND user_id=?;').get(Number(payload.id), userId) : null;
      if (payload.id && !existing) {
        const error = new Error('Subject does not belong to this account');
        error.statusCode = 403;
        throw error;
      }
      if (existing) {
        connection.prepare(`UPDATE subjects SET name=?,color=?,is_active=?,sort_order=?,updated_at=? WHERE id=? AND user_id=?;`)
          .run(payload.name || '', payload.color || '#2563eb', payload.isActive !== false ? 1 : 0, Number(payload.sortOrder || 0), timestamp, Number(payload.id), userId);
        connection.exec('COMMIT;');
        onChange();
        return Number(payload.id);
      }
      const id = nextId(connection, 'subjects');
      const sortOrder = Number(payload.sortOrder || connection.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS value FROM subjects WHERE user_id=?;').get(userId)?.value || id);
      connection.prepare(`INSERT INTO subjects
(id,user_id,name,color,is_active,sort_order,schema_version,created_at,updated_at)
VALUES(?,?,?,?,1,?,?,?,?);`).run(id, userId, payload.name || '', payload.color || '#2563eb', sortOrder, entitySchemaVersion, timestamp, timestamp);
      connection.exec('COMMIT;');
      onChange();
      return id;
    } catch (error) {
      try { connection.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function saveExam(payload, contextOrId) {
    const userId = requireUserId(contextOrId);
    const connection = database.open();
    const timestamp = nowISO();
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const existing = payload.id ? connection.prepare('SELECT id FROM mock_exam_records WHERE id=? AND user_id=?;').get(Number(payload.id), userId) : null;
      if (payload.id && !existing) {
        const error = new Error('Exam does not belong to this account');
        error.statusCode = 403;
        throw error;
      }
      const id = existing ? Number(payload.id) : nextId(connection, 'mock_exam_records');
      connection.prepare(`INSERT INTO mock_exam_records
(id,user_id,date,subject_id,subject_name_snapshot,score,full_score,paper_name,duration_minutes,wrong_count,note,schema_version,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET date=excluded.date,subject_id=excluded.subject_id,
subject_name_snapshot=excluded.subject_name_snapshot,score=excluded.score,full_score=excluded.full_score,
paper_name=excluded.paper_name,duration_minutes=excluded.duration_minutes,wrong_count=excluded.wrong_count,
note=excluded.note,updated_at=excluded.updated_at WHERE mock_exam_records.user_id=excluded.user_id;`).run(
        id, userId, payload.date || todayISO(), Number(payload.subjectId || 0), payload.subjectNameSnapshot || '', Number(payload.score || 0), Math.max(1, Number(payload.fullScore || 100)), payload.paperName || '', Math.max(0, Number(payload.durationMinutes || 0)), Math.max(0, Number(payload.wrongCount || 0)), payload.note || '', entitySchemaVersion, timestamp, timestamp,
      );
      connection.exec('COMMIT;');
      onChange();
      return id;
    } catch (error) {
      try { connection.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function saveTask(payload, context) {
    const userId = requireUserId(context);
    const connection = database.open();
    const timestamp = nowISO();
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const existing = payload.id ? connection.prepare(`SELECT id,due_date AS dueDate,due_time AS dueTime,
reminder_sent_offsets AS reminderSentOffsets,reminder_last_sent_at AS reminderLastSentAt
FROM short_term_tasks WHERE id=? AND user_id=? LIMIT 1;`).get(Number(payload.id), userId) : null;
      if (payload.id && !existing) {
        const error = new Error('Task does not belong to this account');
        error.statusCode = 403;
        throw error;
      }
      const id = existing ? Number(payload.id) : nextId(connection, 'short_term_tasks');
      const dueDate = payload.dueDate || todayISO();
      const dueTime = normalizeDueTime(payload.dueTime);
      const timeChanged = existing && (existing.dueDate !== dueDate || existing.dueTime !== dueTime);
      const canNotify = Boolean(context?.capabilities?.includes('notifications.manage'));
      const reminderEnabled = canNotify && Boolean(payload.reminderEnabled ?? dueTime) && Boolean(dueTime);
      const sentOffsets = timeChanged ? [] : normalizeOffsets(payload.reminderSentOffsets ?? existing?.reminderSentOffsets);
      const reminderLastSentAt = timeChanged ? null : payload.reminderLastSentAt || existing?.reminderLastSentAt || null;
      connection.prepare(`INSERT INTO short_term_tasks
(id,user_id,title,due_date,due_time,urgency,is_completed,completed_at,reminder_enabled,reminder_sent_offsets,reminder_last_sent_at,note,schema_version,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET title=excluded.title,due_date=excluded.due_date,due_time=excluded.due_time,
urgency=excluded.urgency,is_completed=excluded.is_completed,completed_at=excluded.completed_at,
reminder_enabled=excluded.reminder_enabled,reminder_sent_offsets=excluded.reminder_sent_offsets,
reminder_last_sent_at=excluded.reminder_last_sent_at,note=excluded.note,updated_at=excluded.updated_at
WHERE short_term_tasks.user_id=excluded.user_id;`).run(
        id, userId, payload.title || '', dueDate, dueTime, payload.urgency || 'medium', payload.isCompleted ? 1 : 0, payload.completedAt || null, reminderEnabled ? 1 : 0, JSON.stringify(sentOffsets), reminderLastSentAt, payload.note || '', entitySchemaVersion, timestamp, timestamp,
      );
      connection.exec('COMMIT;');
      onChange();
      return id;
    } catch (error) {
      try { connection.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function upsertReview(payload, contextOrId) {
    const userId = requireUserId(contextOrId);
    const connection = database.open();
    const timestamp = nowISO();
    const date = payload.date || todayISO();
    const review = reviewFields(payload);
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const ownedId = payload.id ? Number(connection.prepare('SELECT id FROM daily_reviews WHERE id=? AND user_id=? LIMIT 1;').get(Number(payload.id), userId)?.id || 0) : 0;
      const dateId = Number(connection.prepare('SELECT id FROM daily_reviews WHERE user_id=? AND date=? LIMIT 1;').get(userId, date)?.id || 0);
      const id = ownedId || dateId || nextId(connection, 'daily_reviews');
      connection.prepare(`INSERT INTO daily_reviews
(id,user_id,date,summary,wins,problems,tomorrow_plan,score,schema_version,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(user_id,date) DO UPDATE SET summary=excluded.summary,wins=excluded.wins,
problems=excluded.problems,tomorrow_plan=excluded.tomorrow_plan,score=excluded.score,updated_at=excluded.updated_at;`).run(
        id, userId, date, review.summary, review.wins, review.problems, review.tomorrowPlan, review.score, entitySchemaVersion, timestamp, timestamp,
      );
      connection.exec('COMMIT;');
      onChange();
      return id;
    } catch (error) {
      try { connection.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function saveDayRecords(date, records, contextOrId) {
    const userId = requireUserId(contextOrId);
    const connection = database.open();
    const timestamp = nowISO();
    connection.exec('BEGIN IMMEDIATE;');
    try {
      let nextRecordId = nextId(connection, 'study_time_records');
      for (const record of records || []) {
        const projectId = Number(record.projectId || 0);
        const project = connection.prepare('SELECT name FROM study_projects WHERE id=? AND user_id=? AND is_active=1 LIMIT 1;').get(projectId, userId);
        if (!project) {
          const error = new Error('Project does not belong to this account');
          error.statusCode = 403;
          throw error;
        }
        const existingId = Number(connection.prepare('SELECT id FROM study_time_records WHERE date=? AND project_id=? AND user_id=? LIMIT 1;').get(date, projectId, userId)?.id || 0);
        const id = existingId || nextRecordId++;
        connection.prepare(`INSERT INTO study_time_records
(id,user_id,date,project_id,project_name_snapshot,minutes,note,schema_version,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(date,project_id) DO UPDATE SET project_name_snapshot=excluded.project_name_snapshot,
minutes=excluded.minutes,note=excluded.note,updated_at=excluded.updated_at
WHERE study_time_records.user_id=excluded.user_id;`).run(
          id, userId, date, projectId, project.name, Math.max(0, Number(record.minutes || 0)), record.note || '', entitySchemaVersion, timestamp, timestamp,
        );
      }
      connection.exec('COMMIT;');
      if (userId === Number(ownerUserId())) onOwnerStudyChanged(date);
      onChange();
    } catch (error) {
      try { connection.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function saveWater(payload, contextOrId) {
    const userId = requireUserId(contextOrId);
    const timestamp = nowISO();
    const date = payload.date || todayISO();
    const connection = database.open();
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const id = Number(connection.prepare('SELECT id FROM water_intake_records WHERE user_id=? AND date=? LIMIT 1;').get(userId, date)?.id || 0) || nextId(connection, 'water_intake_records');
      connection.prepare(`INSERT INTO water_intake_records
(id,user_id,date,cups,cup_ml,target_cups,schema_version,created_at,updated_at)
VALUES(?,?,?,?,?,?,?,?,?)
ON CONFLICT(user_id,date) DO UPDATE SET cups=excluded.cups,cup_ml=excluded.cup_ml,
target_cups=excluded.target_cups,updated_at=excluded.updated_at;`).run(
        id, userId, date, Math.max(0, Number(payload.cups || 0)), Math.max(1, Number(payload.cupMl || 500)), Math.max(1, Number(payload.targetCups || 6)), entitySchemaVersion, timestamp, timestamp,
      );
      connection.exec('COMMIT;');
      onChange();
    } catch (error) {
      try { connection.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function listProblemInbox(options = {}, contextOrId) {
    const userId = requireUserId(contextOrId);
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 12));
    const status = ['open', 'resolved'].includes(options.status) ? options.status : null;
    const rows = database.json(`SELECT id,date,text,status,source,created_at AS createdAt,
updated_at AS updatedAt,resolved_at AS resolvedAt FROM problem_inbox_items
WHERE user_id=? AND date BETWEEN ? AND ? ${status ? 'AND status=?' : ''}
ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END,date DESC,updated_at DESC,id DESC
LIMIT ?;`, status
      ? [userId, options.from || '1900-01-01', options.to || '2999-12-31', status, limit]
      : [userId, options.from || '1900-01-01', options.to || '2999-12-31', limit]);
    return rows.map(problemRow);
  }

  function saveProblem(payload, contextOrId) {
    const userId = requireUserId(contextOrId);
    const text = String(payload.text || '').trim();
    if (!text) throw new Error('Problem inbox text is required');
    const connection = database.open();
    const timestamp = nowISO();
    connection.exec('BEGIN IMMEDIATE;');
    try {
      const existing = payload.id ? connection.prepare('SELECT id FROM problem_inbox_items WHERE id=? AND user_id=?;').get(Number(payload.id), userId) : null;
      if (payload.id && !existing) {
        const error = new Error('Problem does not belong to this account');
        error.statusCode = 403;
        throw error;
      }
      const id = existing ? Number(payload.id) : nextId(connection, 'problem_inbox_items');
      connection.prepare(`INSERT INTO problem_inbox_items
(id,user_id,date,text,status,source,created_at,updated_at,resolved_at)
VALUES(?,?,?,?,?,?,?,?,?)
ON CONFLICT(id) DO UPDATE SET date=excluded.date,text=excluded.text,status=excluded.status,
source=excluded.source,updated_at=excluded.updated_at,resolved_at=excluded.resolved_at
WHERE problem_inbox_items.user_id=excluded.user_id;`).run(
        id, userId, payload.date || todayISO(), text, payload.status || 'open', payload.source || 'manual', timestamp, timestamp, payload.resolvedAt || null,
      );
      connection.exec('COMMIT;');
      onChange();
      return id;
    } catch (error) {
      try { connection.exec('ROLLBACK;'); } catch { /* preserve original error */ }
      throw error;
    }
  }

  function setProblemStatus(id, status, contextOrId) {
    const userId = requireUserId(contextOrId);
    const nextStatus = status === 'resolved' ? 'resolved' : 'open';
    const timestamp = nowISO();
    database.execute(`UPDATE problem_inbox_items SET status=?,updated_at=?,resolved_at=?
WHERE id=? AND user_id=?;`, [nextStatus, timestamp, nextStatus === 'resolved' ? timestamp : null, Number(id), userId]);
    onChange();
  }

  function deleteProblem(id, contextOrId) {
    const userId = requireUserId(contextOrId);
    database.execute('DELETE FROM problem_inbox_items WHERE id=? AND user_id=?;', [Number(id), userId]);
    onChange();
  }

  function resolveProblemsForDate(date, contextOrId) {
    const userId = requireUserId(contextOrId);
    const timestamp = nowISO();
    database.execute(`UPDATE problem_inbox_items SET status='resolved',updated_at=?,resolved_at=?
WHERE user_id=? AND date=? AND status='open';`, [timestamp, timestamp, userId, date || todayISO()]);
    onChange();
    return { ok: true, resolvedAt: timestamp };
  }

  function getStudyTarget(contextOrId) {
    const userId = requireUserId(contextOrId);
    const value = database.scalar('SELECT target_minutes FROM user_study_settings WHERE user_id=? LIMIT 1;', [userId]);
    if (value !== null && value !== undefined && value !== '') return Math.max(0, Number(value) || 0);
    if (userId !== Number(ownerUserId())) return 0;
    return Math.max(0, Number(database.scalar("SELECT value FROM app_metadata WHERE key='study_target_minutes' LIMIT 1;") || 0));
  }

  function saveStudyTarget(payload, contextOrId) {
    const userId = requireUserId(contextOrId);
    const explicitMinutes = Number(payload.targetMinutes ?? NaN);
    const minutes = Number.isFinite(explicitMinutes) ? Math.max(0, Math.round(explicitMinutes)) : Math.max(0, Math.round(Number(payload.targetHours || 0) * 60));
    database.execute(`INSERT INTO user_study_settings(user_id,target_minutes,updated_at)
VALUES(?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET
target_minutes=excluded.target_minutes,updated_at=excluded.updated_at;`, [userId, minutes]);
    if (userId === Number(ownerUserId())) {
      database.execute(`INSERT INTO app_metadata(key,value,updated_at) VALUES('study_target_minutes',?,datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`, [String(minutes)]);
    }
    onChange();
    return { targetMinutes: minutes, targetHours: Math.round((minutes / 60) * 10) / 10 };
  }

  function activateGoal(id, updatedAt, contextOrId) {
    const userId = requireUserId(contextOrId);
    database.execute('UPDATE goals SET is_active=CASE WHEN id=? THEN 1 ELSE 0 END,updated_at=? WHERE user_id=?;', [id, updatedAt, userId]);
  }

  const removeGoal = (id, contextOrId) => database.execute('DELETE FROM goals WHERE id=? AND user_id=?;', [id, requireUserId(contextOrId)]);
  const removeProject = (id, updatedAt, contextOrId) => database.execute('UPDATE study_projects SET is_active=0,updated_at=? WHERE id=? AND user_id=?;', [updatedAt, id, requireUserId(contextOrId)]);
  const removeSubject = (id, updatedAt, contextOrId) => database.execute('UPDATE subjects SET is_active=0,updated_at=? WHERE id=? AND user_id=?;', [updatedAt, id, requireUserId(contextOrId)]);
  const removeExam = (id, contextOrId) => database.execute('DELETE FROM mock_exam_records WHERE id=? AND user_id=?;', [id, requireUserId(contextOrId)]);
  const removeTask = (id, contextOrId) => database.execute('DELETE FROM short_term_tasks WHERE id=? AND user_id=?;', [id, requireUserId(contextOrId)]);
  const toggleTask = (id, completed, updatedAt, contextOrId) => database.execute(`UPDATE short_term_tasks
SET is_completed=?,completed_at=?,updated_at=? WHERE id=? AND user_id=?;`, [completed ? 1 : 0, completed ? updatedAt : null, updatedAt, id, requireUserId(contextOrId)]);

  function getStateSnapshot(contextOrId) {
    const userId = requireUserId(contextOrId);
    const goals = database.json(`SELECT id,name,description,deadline,is_active AS isActive,type,notes,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM goals WHERE user_id=? ORDER BY id;`, [userId]).map((item) => ({ ...item, isActive: Boolean(item.isActive) }));
    const dailyReviews = database.json(`SELECT id,date,summary,wins,problems,tomorrow_plan AS tomorrowPlan,score,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM daily_reviews WHERE user_id=? ORDER BY date DESC;`, [userId]);
    const studyProjects = database.json(`SELECT id,name,color,is_active AS isActive,sort_order AS sortOrder,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM study_projects WHERE user_id=? ORDER BY sort_order,id;`, [userId]).map((item) => ({ ...item, isActive: Boolean(item.isActive) }));
    const studyTimeRecords = database.json(`SELECT id,date,project_id AS projectId,project_name_snapshot AS projectNameSnapshot,
minutes,note,schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM study_time_records WHERE user_id=? ORDER BY date DESC,project_id;`, [userId]);
    const subjects = database.json(`SELECT id,name,color,is_active AS isActive,sort_order AS sortOrder,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM subjects WHERE user_id=? ORDER BY sort_order,id;`, [userId]).map((item) => ({ ...item, isActive: Boolean(item.isActive) }));
    const mockExamRecords = database.json(`SELECT id,date,subject_id AS subjectId,subject_name_snapshot AS subjectNameSnapshot,
score,full_score AS fullScore,paper_name AS paperName,duration_minutes AS durationMinutes,
wrong_count AS wrongCount,note,schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM mock_exam_records WHERE user_id=? ORDER BY date DESC,id DESC;`, [userId]);
    const shortTermTasks = database.json(`SELECT id,title,due_date AS dueDate,due_time AS dueTime,urgency,
is_completed AS isCompleted,completed_at AS completedAt,reminder_enabled AS reminderEnabled,
reminder_sent_offsets AS reminderSentOffsets,reminder_last_sent_at AS reminderLastSentAt,note,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM short_term_tasks WHERE user_id=? ORDER BY due_date,due_time,id;`, [userId]).map((item) => ({
      ...item,
      isCompleted: Boolean(item.isCompleted),
      reminderEnabled: Boolean(item.reminderEnabled),
      reminderSentOffsets: normalizeOffsets(item.reminderSentOffsets),
    }));
    const waterIntakeRecords = database.json(`SELECT id,date,cups,cup_ml AS cupMl,target_cups AS targetCups,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM water_intake_records WHERE user_id=? ORDER BY date DESC;`, [userId]);
    const confusingPayload = database.scalar('SELECT payload_json FROM user_confusing_words_backup WHERE user_id=? LIMIT 1;', [userId]);
    let confusingWordsBackup = null;
    try { confusingWordsBackup = confusingPayload ? JSON.parse(confusingPayload) : null; } catch { confusingWordsBackup = null; }
    return { goals, dailyReviews, studyProjects, studyTimeRecords, subjects, mockExamRecords, shortTermTasks, waterIntakeRecords, confusingWordsBackup };
  }

  function forUser(context) {
    const userId = requireUserId(context);
    const scoped = { ...context, userId };
    return Object.freeze({
      userId,
      listReviews: (options) => listReviews(options, scoped),
      listStudyRecords: (date) => listStudyRecords(date, scoped),
      saveGoal: (payload) => saveGoal(payload, scoped),
      saveProject: (payload) => saveProject(payload, scoped),
      saveSubject: (payload) => saveSubject(payload, scoped),
      saveExam: (payload) => saveExam(payload, scoped),
      saveTask: (payload) => saveTask(payload, scoped),
      upsertReview: (payload) => upsertReview(payload, scoped),
      saveDayRecords: (date, records) => saveDayRecords(date, records, scoped),
      saveWater: (payload) => saveWater(payload, scoped),
      listProblemInbox: (options) => listProblemInbox(options, scoped),
      saveProblem: (payload) => saveProblem(payload, scoped),
      setProblemStatus: (id, status) => setProblemStatus(id, status, scoped),
      deleteProblem: (id) => deleteProblem(id, scoped),
      resolveProblemsForDate: (date) => resolveProblemsForDate(date, scoped),
      getStudyTarget: () => getStudyTarget(scoped),
      saveStudyTarget: (payload) => saveStudyTarget(payload, scoped),
      activateGoal: (id, updatedAt) => activateGoal(id, updatedAt, scoped),
      removeGoal: (id) => removeGoal(id, scoped),
      removeProject: (id, updatedAt) => removeProject(id, updatedAt, scoped),
      removeSubject: (id, updatedAt) => removeSubject(id, updatedAt, scoped),
      removeExam: (id) => removeExam(id, scoped),
      removeTask: (id) => removeTask(id, scoped),
      toggleTask: (id, completed, updatedAt) => toggleTask(id, completed, updatedAt, scoped),
      getStateSnapshot: () => getStateSnapshot(scoped),
    });
  }

  return {
    forUser,
    listReviews,
    listStudyRecords,
    saveGoal,
    saveProject,
    saveSubject,
    saveExam,
    saveTask,
    upsertReview,
    saveDayRecords,
    saveWater,
    listProblemInbox,
    saveProblem,
    setProblemStatus,
    deleteProblem,
    resolveProblemsForDate,
    getStudyTarget,
    saveStudyTarget,
    embeddingCount: () => Number(database.scalar('SELECT COUNT(*) FROM review_sentence_embeddings;') || 0),
    activateGoal,
    removeGoal,
    removeProject,
    removeSubject,
    removeExam,
    removeTask,
    toggleTask,
    getStateSnapshot,
  };
}
