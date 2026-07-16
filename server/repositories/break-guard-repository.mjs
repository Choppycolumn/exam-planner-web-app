export function createBreakGuardRepository(database) {
  return {
    listActiveProjects() {
      return database.json(`SELECT id, name, color, sort_order AS sortOrder
FROM study_projects WHERE user_id = 1 AND is_active = 1 ORDER BY sort_order, id;`).map((row) => ({
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
    appendStudyTime({ sessionDate, projectId, durationSeconds, sessionSequence }) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sessionDate || ''))) return null;
      const project = database.json('SELECT id,name FROM study_projects WHERE id = ? AND user_id = 1 AND is_active = 1 LIMIT 1;', [projectId])[0];
      if (!project) return null;
      const minutes = Math.max(1, Math.min(24 * 60, Math.round(Number(durationSeconds || 0) / 60)));
      const note = `Break Guard 学习记录 #${Math.max(1, Number(sessionSequence || 1))}`;
      database.execute(`INSERT INTO study_time_records
(date,project_id,project_name_snapshot,minutes,note,schema_version,created_at,updated_at,user_id)
VALUES(?,?,?,?,?,1,datetime('now'),datetime('now'),1)
ON CONFLICT(date,project_id) DO UPDATE SET
  minutes=study_time_records.minutes+excluded.minutes,
  project_name_snapshot=excluded.project_name_snapshot,
  note=trim(study_time_records.note || CASE WHEN study_time_records.note <> '' THEN '；' ELSE '' END || excluded.note),
  updated_at=datetime('now');`, [sessionDate, project.id, project.name, minutes, note]);
      return { sessionDate, projectId: Number(project.id), projectName: project.name, minutes, sessionSequence: Number(sessionSequence || 1) };
    },
  };
}
