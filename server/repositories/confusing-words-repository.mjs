export function createConfusingWordsRepository(database) {
  return {
    readPayload(userId) {
      const row = database.json(
        'SELECT payload_json AS payloadJson FROM user_confusing_words_backup WHERE user_id=? LIMIT 1;',
        [Number(userId)],
      )[0];
      return row?.payloadJson || null;
    },
    latestHash(userId) {
      return database.scalar(`SELECT payload_hash FROM user_confusing_words_backup_versions
WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 1;`, [Number(userId)]) || '';
    },
    insertVersion(userId, payload, source, summary, createdAt) {
      database.execute(`INSERT INTO user_confusing_words_backup_versions(
user_id,schema_version,exported_at,backed_up_at,payload_json,source,
group_count,word_count,payload_hash,created_at
) VALUES(?,?,?,?,?,?,?,?,?,?);`, [
        Number(userId), Number(payload.schemaVersion || 1), payload.exportedAt, payload.backedUpAt,
        JSON.stringify(payload), source, summary.groupCount, summary.wordCount, summary.payloadHash, createdAt,
      ]);
      database.execute(`DELETE FROM user_confusing_words_backup_versions
WHERE user_id=? AND id NOT IN(
  SELECT id FROM user_confusing_words_backup_versions WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 80
);`, [Number(userId), Number(userId)]);
    },
    upsertCurrent(userId, payload) {
      database.execute(`INSERT INTO user_confusing_words_backup(
user_id,schema_version,exported_at,backed_up_at,payload_json
) VALUES(?,?,?,?,?)
ON CONFLICT(user_id) DO UPDATE SET schema_version=excluded.schema_version,
exported_at=excluded.exported_at,backed_up_at=excluded.backed_up_at,payload_json=excluded.payload_json;`, [
        Number(userId), Number(payload.schemaVersion || 1), payload.exportedAt, payload.backedUpAt, JSON.stringify(payload),
      ]);
    },
    listVersions(userId, limit = 20) {
      return database.json(`SELECT id,schema_version AS schemaVersion,exported_at AS exportedAt,
backed_up_at AS backedUpAt,source,group_count AS groupCount,word_count AS wordCount,
length(payload_json) AS payloadBytes,payload_hash AS payloadHash,created_at AS createdAt
FROM user_confusing_words_backup_versions WHERE user_id=?
ORDER BY created_at DESC,id DESC LIMIT ?;`, [Number(userId), Math.max(1, Math.min(80, Number(limit) || 20))]);
    },
    countVersions(userId) {
      return Number(database.scalar('SELECT COUNT(*) FROM user_confusing_words_backup_versions WHERE user_id=?;', [Number(userId)]) || 0);
    },
    findVersionPayload(versionId, userId) {
      const row = database.json(
        'SELECT payload_json AS payloadJson FROM user_confusing_words_backup_versions WHERE id = ? AND user_id = ? LIMIT 1;',
        [versionId, userId],
      )[0];
      return row?.payloadJson || null;
    },
  };
}
