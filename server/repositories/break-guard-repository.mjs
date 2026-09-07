export function createBreakGuardRepository(database, { ownerUserId } = {}) {
  if (typeof ownerUserId !== 'function') throw new Error('ownerUserId resolver is required');
  const ownerId = () => Number(ownerUserId());
  function findSessionMutation(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return null;
    const rows = database.json(`SELECT event_type AS eventType, payload_json AS payloadJson, created_at AS createdAt
FROM break_guard_events
WHERE event_type IN ('study_session_corrected', 'study_session_deleted')
ORDER BY id ASC;`);
    for (const row of rows) {
      let payload = {};
      try { payload = JSON.parse(row.payloadJson || '{}'); } catch { payload = {}; }
      if (String(payload.sessionId || '').trim() === normalizedSessionId) return { ...row, payload };
    }
    return null;
  }
  return {
    listActiveProjects() {
      return database.json(`SELECT id, name, color, sort_order AS sortOrder
FROM study_projects WHERE user_id = ? AND is_active = 1 ORDER BY sort_order, id;`, [ownerId()]).map((row) => ({
        ...row,
        id: Number(row.id),
        sortOrder: Number(row.sortOrder || 0),
      }));
    },
    getScheduleConfig() {
      const raw = database.scalar("SELECT value FROM app_metadata WHERE key = 'break_guard_schedule_json' LIMIT 1;");
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    saveScheduleConfig(config) {
      database.execute(`INSERT INTO app_metadata(key,value,updated_at)
VALUES('break_guard_schedule_json',?,datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`, [JSON.stringify(config)]);
      return config;
    },
    findEvent(eventId) {
      return database.json(`SELECT event_id AS eventId, event_type AS eventType, status, source,
note, started_at AS startedAt, ended_at AS endedAt,
overdue_seconds AS overdueSeconds, created_at AS createdAt
FROM break_guard_events WHERE event_id = ? LIMIT 1;`, [eventId])[0] || null;
    },
    insertEvent(event, createdAt) {
      database.execute(`INSERT INTO break_guard_events
(event_id, event_type, status, source, note, started_at, ended_at, overdue_seconds, payload_json, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`, [
        event.eventId,
        event.eventType,
        event.status,
        event.source,
        event.note,
        event.startedAt,
        event.endedAt,
        event.overdueSeconds,
        JSON.stringify(event.payload),
        createdAt,
      ]);
    },
    summaryByType(date) {
      return database.json(`SELECT event_type AS eventType, COUNT(*) AS count, MAX(created_at) AS latestAt
FROM break_guard_events
WHERE date(created_at, 'localtime') = date(?)
GROUP BY event_type;`, [date]);
    },
    latestEvents(limit = 5) {
      return database.json(`SELECT id, event_type AS eventType, status, note,
overdue_seconds AS overdueSeconds, created_at AS createdAt
FROM break_guard_events ORDER BY created_at DESC, id DESC LIMIT ?;`, [limit]);
    },
    appendStudyTime({ sessionId, sessionDate, projectId, durationSeconds, sessionSequence }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sessionDate || ''))) return null;
      const project = database.json('SELECT id,name FROM study_projects WHERE id = ? AND user_id = ? AND is_active = 1 LIMIT 1;', [projectId, ownerId()])[0];
      if (!project) return null;
      if (findSessionMutation(sessionId)) {
        return {
          sessionDate,
          projectId: Number(project.id),
          projectName: project.name,
          minutes: 0,
          sessionSequence: Number(sessionSequence || 1),
          skipped: true,
          reason: 'session_mutation_already_applied',
        };
      }
      const minutes = Math.max(1, Math.min(24 * 60, Math.round(Number(durationSeconds || 0) / 60)));
      const note = `Break Guard 学习记录 #${Math.max(1, Number(sessionSequence || 1))}`;
      database.execute(`INSERT INTO study_time_records
(date,project_id,project_name_snapshot,minutes,note,schema_version,created_at,updated_at,user_id)
VALUES(?,?,?,?,?,1,datetime('now'),datetime('now'),?)
ON CONFLICT(date,project_id) DO UPDATE SET
  minutes=study_time_records.minutes+excluded.minutes,
  project_name_snapshot=excluded.project_name_snapshot,
  note=trim(study_time_records.note || CASE WHEN study_time_records.note <> '' THEN '；' ELSE '' END || excluded.note),
  updated_at=datetime('now');`, [sessionDate, project.id, project.name, minutes, note, ownerId()]);
      return { sessionDate, projectId: Number(project.id), projectName: project.name, minutes, sessionSequence: Number(sessionSequence || 1) };
    },
    adjustStudyTime({ sessionDate, projectId, previousDurationSeconds, durationSeconds, sessionSequence, deleted = false }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sessionDate || ''))) return null;
      const project = database.json('SELECT id,name FROM study_projects WHERE id = ? AND user_id = ? LIMIT 1;', [projectId, ownerId()])[0];
      if (!project) return null;
      const roundedMinutes = (seconds) => Math.max(1, Math.min(24 * 60, Math.round(Number(seconds || 0) / 60)));
      const previousMinutes = roundedMinutes(previousDurationSeconds);
      const nextMinutes = deleted ? 0 : roundedMinutes(durationSeconds);
      const deltaMinutes = nextMinutes - previousMinutes;
      const existing = database.json(`SELECT id,minutes,note FROM study_time_records
WHERE date=? AND project_id=? AND user_id=? LIMIT 1;`, [sessionDate, project.id, ownerId()])[0];
      if (!existing) {
        if (nextMinutes <= 0) {
          return { sessionDate, projectId: Number(project.id), projectName: project.name, previousMinutes, minutes: 0, deltaMinutes: 0, totalMinutes: 0 };
        }
        const note = `Break Guard 修正记录 #${Math.max(1, Number(sessionSequence || 1))}`;
        database.execute(`INSERT INTO study_time_records
(date,project_id,project_name_snapshot,minutes,note,schema_version,created_at,updated_at,user_id)
VALUES(?,?,?,?,?,1,datetime('now'),datetime('now'),?);`, [sessionDate, project.id, project.name, nextMinutes, note, ownerId()]);
        return { sessionDate, projectId: Number(project.id), projectName: project.name, previousMinutes, minutes: nextMinutes, deltaMinutes: nextMinutes, totalMinutes: nextMinutes };
      }
      const currentMinutes = Math.max(0, Number(existing.minutes || 0));
      const totalMinutes = Math.max(0, currentMinutes + deltaMinutes);
      if (totalMinutes === 0) {
        database.execute('DELETE FROM study_time_records WHERE id=? AND user_id=?;', [existing.id, ownerId()]);
      } else {
        database.execute(`UPDATE study_time_records SET minutes=?,project_name_snapshot=?,updated_at=datetime('now')
WHERE id=? AND user_id=?;`, [totalMinutes, project.name, existing.id, ownerId()]);
      }
      return {
        sessionDate,
        projectId: Number(project.id),
        projectName: project.name,
        previousMinutes,
        minutes: nextMinutes,
        deltaMinutes,
        totalMinutes,
      };
    },
  };
}
