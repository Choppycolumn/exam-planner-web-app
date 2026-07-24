const idleState = (userId) => ({
  userId: Number(userId),
  mode: 'idle',
  sessionId: null,
  projectId: null,
  projectName: '',
  pauseLabel: '',
  startedAt: null,
  targetSeconds: 0,
  revision: 0,
  updatedAt: null,
});

export function createFocusTimerRepository(database) {
  const mapState = (row, userId) => row ? {
    userId: Number(row.userId),
    mode: row.mode,
    sessionId: row.sessionId || null,
    projectId: row.projectId === null ? null : Number(row.projectId),
    projectName: row.projectName || '',
    pauseLabel: row.pauseLabel || '',
    startedAt: row.startedAt || null,
    targetSeconds: Number(row.targetSeconds || 0),
    revision: Number(row.revision || 0),
    updatedAt: row.updatedAt || null,
  } : idleState(userId);

  return {
    transaction(callback) {
      const connection = database.open();
      connection.exec('BEGIN IMMEDIATE;');
      try {
        const result = callback();
        connection.exec('COMMIT;');
        return result;
      } catch (error) {
        try { connection.exec('ROLLBACK;'); } catch { /* preserve the original error */ }
        throw error;
      }
    },

    getSettings(userId) {
      const row = database.json(`SELECT user_id AS userId, focus_minutes AS focusMinutes,
break_minutes AS breakMinutes, updated_at AS updatedAt
FROM focus_timer_settings WHERE user_id = ? LIMIT 1;`, [userId])[0];
      return row ? {
        userId: Number(row.userId),
        focusMinutes: Number(row.focusMinutes),
        breakMinutes: Number(row.breakMinutes),
        updatedAt: row.updatedAt,
      } : { userId: Number(userId), focusMinutes: 50, breakMinutes: 10, updatedAt: null };
    },

    saveSettings(userId, settings, updatedAt) {
      database.execute(`INSERT INTO focus_timer_settings(user_id,focus_minutes,break_minutes,updated_at)
VALUES(?,?,?,?)
ON CONFLICT(user_id) DO UPDATE SET
focus_minutes=excluded.focus_minutes,
break_minutes=excluded.break_minutes,
updated_at=excluded.updated_at;`, [userId, settings.focusMinutes, settings.breakMinutes, updatedAt]);
      return this.getSettings(userId);
    },

    getProject(userId, projectId) {
      const row = database.json(`SELECT id,name,color FROM study_projects
WHERE id = ? AND user_id = ? AND is_active = 1 LIMIT 1;`, [projectId, userId])[0];
      return row ? { id: Number(row.id), name: row.name, color: row.color } : null;
    },

    getState(userId) {
      const row = database.json(`SELECT user_id AS userId,mode,session_id AS sessionId,
project_id AS projectId,project_name_snapshot AS projectName,pause_label AS pauseLabel,
started_at AS startedAt,target_seconds AS targetSeconds,revision,updated_at AS updatedAt
FROM focus_timer_state WHERE user_id = ? LIMIT 1;`, [userId])[0];
      return mapState(row, userId);
    },

    saveState(userId, state, updatedAt) {
      const previous = this.getState(userId);
      const revision = previous.revision + 1;
      database.execute(`INSERT INTO focus_timer_state(
user_id,mode,session_id,project_id,project_name_snapshot,pause_label,
started_at,target_seconds,revision,updated_at
) VALUES(?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(user_id) DO UPDATE SET
mode=excluded.mode,session_id=excluded.session_id,project_id=excluded.project_id,
project_name_snapshot=excluded.project_name_snapshot,pause_label=excluded.pause_label,
started_at=excluded.started_at,target_seconds=excluded.target_seconds,
revision=excluded.revision,updated_at=excluded.updated_at;`, [
        userId,
        state.mode,
        state.sessionId || null,
        state.projectId || null,
        state.projectName || '',
        state.pauseLabel || '',
        state.startedAt || null,
        Number(state.targetSeconds || 0),
        revision,
        updatedAt,
      ]);
      return this.getState(userId);
    },

    findSession(userId, sessionId) {
      const row = database.json(`SELECT id,user_id AS userId,session_id AS sessionId,
session_date AS sessionDate,project_id AS projectId,project_name_snapshot AS projectName,
started_at AS startedAt,ended_at AS endedAt,duration_seconds AS durationSeconds,note,created_at AS createdAt
FROM focus_timer_sessions WHERE user_id = ? AND session_id = ? LIMIT 1;`, [userId, sessionId])[0];
      return row ? {
        ...row,
        id: Number(row.id),
        userId: Number(row.userId),
        projectId: Number(row.projectId),
        durationSeconds: Number(row.durationSeconds),
      } : null;
    },

    insertSession(userId, session, createdAt) {
      const result = database.execute(`INSERT OR IGNORE INTO focus_timer_sessions(
user_id,session_id,session_date,project_id,project_name_snapshot,
started_at,ended_at,duration_seconds,note,created_at
) VALUES(?,?,?,?,?,?,?,?,?,?);`, [
        userId,
        session.sessionId,
        session.sessionDate,
        session.projectId,
        session.projectName,
        session.startedAt,
        session.endedAt,
        session.durationSeconds,
        session.note || '',
        createdAt,
      ]);
      return Number(result.changes || 0) > 0;
    },

    addStudyTime(userId, session, updatedAt) {
      const minutes = Math.max(1, Math.min(24 * 60, Math.round(Number(session.durationSeconds || 0) / 60)));
      const note = `网页专注计时 · ${session.sessionId.slice(0, 8)}`;
      database.execute(`INSERT INTO study_time_records(
date,project_id,project_name_snapshot,minutes,note,schema_version,created_at,updated_at,user_id
) VALUES(?,?,?,?,?,1,?,?,?)
ON CONFLICT(date,project_id) DO UPDATE SET
minutes=study_time_records.minutes+excluded.minutes,
project_name_snapshot=excluded.project_name_snapshot,
note=trim(study_time_records.note || CASE WHEN study_time_records.note <> '' THEN '；' ELSE '' END || excluded.note),
updated_at=excluded.updated_at;`, [
        session.sessionDate,
        session.projectId,
        session.projectName,
        minutes,
        note,
        updatedAt,
        updatedAt,
        userId,
      ]);
      return minutes;
    },

    getActiveSegment(userId, sessionId) {
      const row = database.json(`SELECT segment_id AS segmentId,sequence_number AS sequenceNumber,
started_at AS startedAt,ended_at AS endedAt,duration_seconds AS durationSeconds
FROM focus_timer_segments
WHERE user_id = ? AND session_id = ? AND ended_at IS NULL
ORDER BY sequence_number DESC LIMIT 1;`, [userId, sessionId])[0];
      return row ? { ...row, sequenceNumber: Number(row.sequenceNumber), durationSeconds: Number(row.durationSeconds || 0) } : null;
    },

    startSegment(userId, sessionId, segmentId, startedAt, createdAt) {
      const next = Number(database.scalar(`SELECT COALESCE(MAX(sequence_number),0)+1
FROM focus_timer_segments WHERE user_id = ? AND session_id = ?;`, [userId, sessionId]) || 1);
      database.execute(`INSERT OR IGNORE INTO focus_timer_segments(
user_id,session_id,segment_id,sequence_number,started_at,created_at
) VALUES(?,?,?,?,?,?);`, [userId, sessionId, segmentId, next, startedAt, createdAt]);
      return this.getActiveSegment(userId, sessionId);
    },

    finishSegment(userId, sessionId, endedAt, durationSeconds) {
      const active = this.getActiveSegment(userId, sessionId);
      if (!active) return null;
      database.execute(`UPDATE focus_timer_segments
SET ended_at=?,duration_seconds=?
WHERE user_id=? AND segment_id=? AND ended_at IS NULL;`, [
        endedAt,
        durationSeconds,
        userId,
        active.segmentId,
      ]);
      return { ...active, endedAt, durationSeconds };
    },

    listSegments(userId, sessionId) {
      return database.json(`SELECT segment_id AS segmentId,sequence_number AS sequenceNumber,
started_at AS startedAt,ended_at AS endedAt,duration_seconds AS durationSeconds
FROM focus_timer_segments WHERE user_id = ? AND session_id = ?
ORDER BY sequence_number;`, [userId, sessionId]).map((row) => ({
        ...row,
        sequenceNumber: Number(row.sequenceNumber),
        durationSeconds: Number(row.durationSeconds || 0),
      }));
    },

    listSessions(userId, sessionDate) {
      return database.json(`SELECT id,session_id AS sessionId,session_date AS sessionDate,
project_id AS projectId,project_name_snapshot AS projectName,started_at AS startedAt,
ended_at AS endedAt,duration_seconds AS durationSeconds,note
FROM focus_timer_sessions WHERE user_id = ? AND session_date = ?
ORDER BY started_at DESC,id DESC;`, [userId, sessionDate]).map((row) => ({
        ...row,
        id: Number(row.id),
        projectId: Number(row.projectId),
        durationSeconds: Number(row.durationSeconds),
      }));
    },

    getDayClosure(userId, sessionDate) {
      const row = database.json(`SELECT session_date AS sessionDate,ended_at AS endedAt
FROM focus_timer_day_closures WHERE user_id = ? AND session_date = ? LIMIT 1;`, [userId, sessionDate])[0];
      return row || null;
    },

    closeDay(userId, sessionDate, endedAt) {
      database.execute(`INSERT INTO focus_timer_day_closures(user_id,session_date,ended_at,updated_at)
VALUES(?,?,?,?)
ON CONFLICT(user_id,session_date) DO UPDATE SET ended_at=excluded.ended_at,updated_at=excluded.updated_at;`,
      [userId, sessionDate, endedAt, endedAt]);
    },

    reopenDay(userId, sessionDate) {
      database.execute('DELETE FROM focus_timer_day_closures WHERE user_id = ? AND session_date = ?;', [userId, sessionDate]);
    },

    findOperation(userId, operationId) {
      const raw = database.scalar(`SELECT result_json FROM focus_timer_operations
WHERE user_id = ? AND operation_id = ? LIMIT 1;`, [userId, operationId]);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },

    saveOperation(userId, operationId, action, result, createdAt) {
      database.execute(`INSERT OR IGNORE INTO focus_timer_operations(
user_id,operation_id,action,result_json,created_at
) VALUES(?,?,?,?,?);`, [userId, operationId, action, JSON.stringify(result), createdAt]);
      database.execute(`DELETE FROM focus_timer_operations
WHERE user_id = ? AND created_at < datetime(?, '-30 days');`, [userId, createdAt]);
    },
  };
}
