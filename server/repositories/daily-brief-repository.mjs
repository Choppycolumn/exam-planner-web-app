export function createDailyBriefRepository(database) {
  function parsePayload(value) {
    try {
      return value ? JSON.parse(value) : {};
    } catch {
      return {};
    }
  }

  function mapBrief(row) {
    if (!row) return null;
    return {
      ...row,
      id: Number(row.id),
      payload: parsePayload(row.payloadJson),
    };
  }

  function getByDate(date) {
    return mapBrief(database.json(`SELECT id,date,title,payload_json AS payloadJson,status,
emailed_at AS emailedAt,email_error AS emailError,generated_at AS generatedAt,updated_at AS updatedAt
FROM daily_briefs WHERE date=? LIMIT 1;`, [date])[0]);
  }

  return {
    getByDate,
    getLatest() {
      return mapBrief(database.json(`SELECT id,date,title,payload_json AS payloadJson,status,
emailed_at AS emailedAt,email_error AS emailError,generated_at AS generatedAt,updated_at AS updatedAt
FROM daily_briefs ORDER BY date DESC,id DESC LIMIT 1;`)[0]);
    },
    list(limit = 30) {
      const safeLimit = Math.max(1, Math.min(100, Number(limit) || 30));
      return database.json(`SELECT id,date,title,payload_json AS payloadJson,status,
emailed_at AS emailedAt,email_error AS emailError,generated_at AS generatedAt,updated_at AS updatedAt
FROM daily_briefs ORDER BY date DESC,id DESC LIMIT ?;`, [safeLimit]).map(mapBrief);
    },
    upsert({
      date,
      title,
      payload,
      status = 'generated',
      generatedAt,
      updatedAt = generatedAt,
      emailedAt = null,
      emailError = '',
    }) {
      database.execute(`INSERT INTO daily_briefs(
date,title,payload_json,status,emailed_at,email_error,generated_at,updated_at)
VALUES(?,?,?,?,?,?,?,?)
ON CONFLICT(date) DO UPDATE SET
title=excluded.title,payload_json=excluded.payload_json,status=excluded.status,
emailed_at=COALESCE(excluded.emailed_at,daily_briefs.emailed_at),
email_error=excluded.email_error,generated_at=excluded.generated_at,updated_at=excluded.updated_at;`, [
        date, title, JSON.stringify(payload), status, emailedAt, emailError, generatedAt, updatedAt,
      ]);
      return getByDate(date);
    },
    markEmailed(id, timestamp) {
      database.execute(`UPDATE daily_briefs
SET emailed_at = ?, email_error = '', updated_at = ?
WHERE id = ?;`, [timestamp, timestamp, id]);
    },
  };
}
