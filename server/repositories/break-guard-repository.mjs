export function createBreakGuardRepository(database) {
  return {
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
  };
}
