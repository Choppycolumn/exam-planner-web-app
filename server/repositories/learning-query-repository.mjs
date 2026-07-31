function validUserId(value) {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId < 1) throw new Error('valid userId is required');
  return userId;
}

function safeLimit(value, fallback, maximum = 100) {
  return Math.max(1, Math.min(maximum, Number(value) || fallback));
}

export function createLearningQueryRepository(database) {
  function studyUserIsolationReady() {
    return database.json('PRAGMA table_info(study_time_records);').some((column) => column.name === 'user_id');
  }

  function rebuildOwnerStudySummaries(userId, timestamp) {
    const hasUserId = studyUserIsolationReady();
    const ownerId = hasUserId ? validUserId(userId) : null;
    database.transaction((connection) => {
      connection.exec('DELETE FROM study_daily_summaries; DELETE FROM study_project_daily_summaries;');
      const userWhere = hasUserId ? ' WHERE user_id=?' : '';
      const daily = connection.prepare(`INSERT INTO study_daily_summaries(date,total_minutes,record_count,updated_at)
SELECT date,COALESCE(SUM(minutes),0),COUNT(*),?
FROM study_time_records${userWhere} GROUP BY date;`);
      const projects = connection.prepare(`INSERT INTO study_project_daily_summaries(
date,project_id,project_name_snapshot,minutes,record_count,updated_at)
SELECT date,project_id,project_name_snapshot,COALESCE(SUM(minutes),0),COUNT(*),?
FROM study_time_records${userWhere}
GROUP BY date,project_id,project_name_snapshot;`);
      hasUserId ? daily.run(timestamp, ownerId) : daily.run(timestamp);
      hasUserId ? projects.run(timestamp, ownerId) : projects.run(timestamp);
      connection.prepare(`INSERT INTO app_metadata(key,value,updated_at)
VALUES('study_summaries_rebuilt_at',?,datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`).run(timestamp);
    });
  }

  function refreshOwnerStudySummariesForDate(userId, date, timestamp) {
    const hasUserId = studyUserIsolationReady();
    const ownerId = hasUserId ? validUserId(userId) : null;
    database.transaction((connection) => {
      connection.prepare('DELETE FROM study_daily_summaries WHERE date=?;').run(date);
      connection.prepare('DELETE FROM study_project_daily_summaries WHERE date=?;').run(date);
      const userSuffix = hasUserId ? ' AND user_id=?' : '';
      const daily = connection.prepare(`INSERT INTO study_daily_summaries(date,total_minutes,record_count,updated_at)
SELECT date,COALESCE(SUM(minutes),0),COUNT(*),?
FROM study_time_records WHERE date=?${userSuffix} GROUP BY date;`);
      const projects = connection.prepare(`INSERT INTO study_project_daily_summaries(
date,project_id,project_name_snapshot,minutes,record_count,updated_at)
SELECT date,project_id,project_name_snapshot,COALESCE(SUM(minutes),0),COUNT(*),?
FROM study_time_records WHERE date=?${userSuffix}
GROUP BY date,project_id,project_name_snapshot;`);
      hasUserId ? daily.run(timestamp, date, ownerId) : daily.run(timestamp, date);
      hasUserId ? projects.run(timestamp, date, ownerId) : projects.run(timestamp, date);
      connection.prepare(`INSERT INTO app_metadata(key,value,updated_at)
VALUES('study_summaries_rebuilt_at',?,datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`).run(timestamp);
    });
  }

  function studySummaryStatus() {
    return {
      recordCount: Number(database.scalar('SELECT COUNT(*) FROM study_time_records;') || 0),
      summaryCount: Number(database.scalar('SELECT COUNT(*) FROM study_daily_summaries;') || 0),
      rebuiltAt: database.scalar("SELECT value FROM app_metadata WHERE key='study_summaries_rebuilt_at' LIMIT 1;") || '',
    };
  }

  function dailyStudyTotals(userId, startDate, endDate) {
    return database.json(`SELECT date,COALESCE(SUM(minutes),0) AS minutes
FROM study_time_records
WHERE user_id=? AND date BETWEEN ? AND ?
GROUP BY date ORDER BY date;`, [validUserId(userId), startDate, endDate]);
  }

  function totalStudyMinutes(userId, startDate = '', endDate = '') {
    const id = validUserId(userId);
    if (startDate && endDate) {
      return Number(database.scalar(`SELECT COALESCE(SUM(minutes),0) FROM study_time_records
WHERE user_id=? AND date BETWEEN ? AND ?;`, [id, startDate, endDate]) || 0);
    }
    return Number(database.scalar('SELECT COALESCE(SUM(minutes),0) FROM study_time_records WHERE user_id=?;', [id]) || 0);
  }

  function projectTotals(userId, startDate, endDate) {
    return database.json(`SELECT project_name_snapshot AS name,COALESCE(SUM(minutes),0) AS minutes
FROM study_time_records
WHERE user_id=? AND date BETWEEN ? AND ?
GROUP BY project_name_snapshot HAVING minutes>0
ORDER BY minutes DESC,name;`, [validUserId(userId), startDate, endDate]);
  }

  function projectDistribution(userId, date) {
    return database.json(`SELECT project_name_snapshot AS name,COALESCE(SUM(minutes),0) AS value
FROM study_time_records WHERE user_id=? AND date=?
GROUP BY project_name_snapshot HAVING value>0
ORDER BY value DESC;`, [validUserId(userId), date]);
  }

  function activityCalendarRows(userId, startDate, endDate) {
    const id = validUserId(userId);
    return {
      totals: dailyStudyTotals(id, startDate, endDate),
      reviews: database.json('SELECT date,score FROM daily_reviews WHERE user_id=? AND date BETWEEN ? AND ?;', [id, startDate, endDate]),
      water: database.json(`SELECT date,cups,target_cups AS targetCups
FROM water_intake_records WHERE user_id=? AND date BETWEEN ? AND ?;`, [id, startDate, endDate]),
      tasks: database.json(`SELECT due_date AS date,COUNT(*) AS total,
COALESCE(SUM(CASE WHEN is_completed=1 THEN 1 ELSE 0 END),0) AS completed
FROM short_term_tasks WHERE user_id=? AND due_date BETWEEN ? AND ?
GROUP BY due_date;`, [id, startDate, endDate]),
    };
  }

  function reviewScores(userId, startDate, endDate) {
    return database.json(`SELECT date,score FROM daily_reviews
WHERE user_id=? AND date BETWEEN ? AND ? ORDER BY date;`, [validUserId(userId), startDate, endDate]);
  }

  function errorThemeWall(startDate, endDate, limit = 12) {
    return database.json(`SELECT t.id,t.normalized_label AS normalizedLabel,t.label,
COUNT(o.id) AS occurrenceCount,COUNT(DISTINCT o.date) AS reviewDayCount,MAX(o.date) AS lastSeenAt
FROM error_themes t JOIN error_theme_occurrences o ON o.theme_id=t.id
WHERE o.date BETWEEN ? AND ?
GROUP BY t.id,t.normalized_label,t.label
ORDER BY occurrenceCount DESC,reviewDayCount DESC,lastSeenAt DESC
LIMIT ?;`, [startDate, endDate, safeLimit(limit, 12, 30)]);
  }

  function reviewPrefillSource(userId, date, previousDate) {
    const id = validUserId(userId);
    return {
      totalMinutes: totalStudyMinutes(id, date, date),
      topProject: database.json(`SELECT project_name_snapshot AS name,COALESCE(SUM(minutes),0) AS minutes
FROM study_time_records WHERE user_id=? AND date=?
GROUP BY project_name_snapshot ORDER BY minutes DESC,project_name_snapshot LIMIT 1;`, [id, date])[0] || null,
      unfinishedTasks: database.json(`SELECT id,title,due_date AS dueDate,due_time AS dueTime,urgency,
reminder_enabled AS reminderEnabled,reminder_sent_offsets AS reminderSentOffsets,
reminder_last_sent_at AS reminderLastSentAt
FROM short_term_tasks WHERE user_id=? AND due_date<=? AND is_completed=0
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,due_date,due_time,id
LIMIT 6;`, [id, date]),
      water: database.json(`SELECT cups,cup_ml AS cupMl,target_cups AS targetCups
FROM water_intake_records WHERE user_id=? AND date=? LIMIT 1;`, [id, date])[0] || null,
      previousReview: database.json(`SELECT tomorrow_plan AS tomorrowPlan
FROM daily_reviews WHERE user_id=? AND date=? LIMIT 1;`, [id, previousDate])[0] || null,
    };
  }

  function dashboardSource(userId, today, yesterday) {
    const id = validUserId(userId);
    return {
      activeGoal: database.json(`SELECT id,name,description,deadline,is_active AS isActive,type,notes,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM goals WHERE user_id=? AND is_active=1 ORDER BY id LIMIT 1;`, [id])[0] || null,
      todayTotal: totalStudyMinutes(id, today, today),
      totalStudyMinutes: totalStudyMinutes(id),
      latestExam: database.json(`SELECT id,date,subject_id AS subjectId,
subject_name_snapshot AS subjectNameSnapshot,score,full_score AS fullScore,
paper_name AS paperName,duration_minutes AS durationMinutes,wrong_count AS wrongCount,note,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM mock_exam_records WHERE user_id=? ORDER BY date DESC,id DESC LIMIT 1;`, [id])[0] || null,
      reviews: database.json(`SELECT id,date,summary,wins,problems,tomorrow_plan AS tomorrowPlan,score,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM daily_reviews WHERE user_id=? AND date IN (?,?);`, [id, today, yesterday]),
      visibleTasks: database.json(`SELECT id,title,due_date AS dueDate,due_time AS dueTime,urgency,
is_completed AS isCompleted,completed_at AS completedAt,reminder_enabled AS reminderEnabled,
reminder_sent_offsets AS reminderSentOffsets,reminder_last_sent_at AS reminderLastSentAt,note,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM short_term_tasks
WHERE user_id=? AND (is_completed=0 OR date(completed_at)=date(?))
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,due_date,due_time,id;`, [id, today]),
      waterRecord: database.json(`SELECT id,date,cups,cup_ml AS cupMl,target_cups AS targetCups,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM water_intake_records WHERE user_id=? AND date=? LIMIT 1;`, [id, today])[0] || null,
    };
  }

  function progressSource(userId, start30, today, previous7Start, previous7End) {
    const id = validUserId(userId);
    return {
      dailyRows: dailyStudyTotals(id, start30, today),
      reviewRows: reviewScores(id, start30, today),
      previous7Minutes: totalStudyMinutes(id, previous7Start, previous7End),
      reviewStats: database.json(`SELECT COUNT(*) AS count,AVG(score) AS averageScore
FROM daily_reviews WHERE user_id=? AND date BETWEEN ? AND ?;`, [id, start30, today])[0] || {},
      taskStats: database.json(`SELECT COUNT(*) AS total,
SUM(CASE WHEN is_completed=1 THEN 1 ELSE 0 END) AS completed
FROM short_term_tasks WHERE user_id=? AND due_date BETWEEN ? AND ?;`, [id, start30, today])[0] || {},
    };
  }

  function studyDates(userId, startDate, endDate) {
    return dailyStudyTotals(userId, startDate, endDate);
  }

  function projectProgressSource(userId, start30, today, start7, previous7Start, previous7End) {
    const id = validUserId(userId);
    return {
      projects: database.json(`SELECT id,name,color,is_active AS isActive,sort_order AS sortOrder
FROM study_projects WHERE user_id=?
ORDER BY is_active DESC,sort_order ASC,id ASC;`, [id]),
      totals: database.json(`SELECT project_id AS projectId,SUM(minutes) AS totalMinutes,
SUM(CASE WHEN date BETWEEN ? AND ? THEN minutes ELSE 0 END) AS last30Minutes,
SUM(CASE WHEN date BETWEEN ? AND ? THEN minutes ELSE 0 END) AS last7Minutes,
SUM(CASE WHEN date BETWEEN ? AND ? THEN minutes ELSE 0 END) AS previous7Minutes,
MAX(date) AS lastStudiedAt,COUNT(*) AS recordCount
FROM study_time_records WHERE user_id=? GROUP BY project_id;`, [
        start30, today, start7, today, previous7Start, previous7End, id,
      ]),
    };
  }

  function listGoals(userId) {
    return database.json(`SELECT id,name,description,deadline,is_active AS isActive,type,notes,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM goals WHERE user_id=? ORDER BY created_at DESC,id DESC;`, [validUserId(userId)]);
  }

  function listProjects(userId) {
    return database.json(`SELECT id,name,color,is_active AS isActive,sort_order AS sortOrder,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM study_projects WHERE user_id=? ORDER BY sort_order,id;`, [validUserId(userId)]);
  }

  function listSubjects(userId) {
    return database.json(`SELECT id,name,color,is_active AS isActive,sort_order AS sortOrder,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM subjects WHERE user_id=? ORDER BY sort_order,id;`, [validUserId(userId)]);
  }

  const examSelect = `SELECT id,date,subject_id AS subjectId,
subject_name_snapshot AS subjectNameSnapshot,score,full_score AS fullScore,
paper_name AS paperName,duration_minutes AS durationMinutes,wrong_count AS wrongCount,note,
schema_version AS schemaVersion,created_at AS createdAt,updated_at AS updatedAt
FROM mock_exam_records`;

  function mockExamSummary(userId, { subjectId = null, limit = 20, offset = 0 } = {}) {
    const id = validUserId(userId);
    const filter = Number.isInteger(Number(subjectId)) && Number(subjectId) > 0;
    const where = filter ? 'WHERE user_id=? AND subject_id=?' : 'WHERE user_id=?';
    const parameters = filter ? [id, Number(subjectId)] : [id];
    const safePageSize = safeLimit(limit, 20, 100);
    const safeOffset = Math.max(0, Number(offset) || 0);
    const total = Number(database.scalar(`SELECT COUNT(*) FROM mock_exam_records ${where};`, parameters) || 0);
    const exams = database.json(`${examSelect} ${where}
ORDER BY date DESC,id DESC LIMIT ? OFFSET ?;`, [...parameters, safePageSize, safeOffset]);
    const latest = database.json(`${examSelect} ${where}
ORDER BY date DESC,id DESC LIMIT 1;`, parameters)[0] || null;
    const stats = database.json(`SELECT MAX(score) AS highest,ROUND(AVG(score),1) AS average,MIN(score) AS lowest
FROM mock_exam_records ${where};`, parameters)[0] || {};
    const trend = database.json(`${examSelect} ${where}
ORDER BY date DESC,id DESC LIMIT 80;`, parameters);
    return { total, exams, latest, stats, trend, limit: safePageSize, offset: safeOffset };
  }

  function briefLearningSnapshot(userId, yesterday, date, last7Start) {
    const id = validUserId(userId);
    return {
      activeGoal: database.json('SELECT name,deadline FROM goals WHERE user_id=? AND is_active=1 ORDER BY id LIMIT 1;', [id])[0] || null,
      yesterdayReview: database.json(`SELECT date,summary,wins,problems,tomorrow_plan AS tomorrowPlan,score
FROM daily_reviews WHERE user_id=? AND date=? LIMIT 1;`, [id, yesterday])[0] || null,
      todayTasks: database.json(`SELECT id,title,due_date AS dueDate,due_time AS dueTime,urgency,
is_completed AS isCompleted,completed_at AS completedAt,reminder_enabled AS reminderEnabled,
reminder_sent_offsets AS reminderSentOffsets,reminder_last_sent_at AS reminderLastSentAt,note
FROM short_term_tasks WHERE user_id=? AND is_completed=0 AND due_date<=?
ORDER BY CASE urgency WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,due_date,due_time,id
LIMIT 8;`, [id, date]),
      latestExam: database.json(`SELECT date,subject_name_snapshot AS subjectName,score,
full_score AS fullScore,paper_name AS paperName
FROM mock_exam_records WHERE user_id=? ORDER BY date DESC,id DESC LIMIT 1;`, [id])[0] || null,
      yesterdayMinutes: totalStudyMinutes(id, yesterday, yesterday),
      last7Minutes: totalStudyMinutes(id, last7Start, date),
    };
  }

  return {
    studyUserIsolationReady,
    rebuildOwnerStudySummaries,
    refreshOwnerStudySummariesForDate,
    studySummaryStatus,
    dailyStudyTotals,
    totalStudyMinutes,
    projectTotals,
    projectDistribution,
    activityCalendarRows,
    reviewScores,
    errorThemeWall,
    reviewPrefillSource,
    dashboardSource,
    progressSource,
    studyDates,
    projectProgressSource,
    listGoals,
    listProjects,
    listSubjects,
    mockExamSummary,
    briefLearningSnapshot,
  };
}
