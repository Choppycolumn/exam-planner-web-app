export function createConfusingWordsRepository(database) {
  return {
    findVersionPayload(versionId, userId = 1) {
      if (Number(userId) === 1) {
        const row = database.json(
          'SELECT payload_json AS payloadJson FROM confusing_words_backup_versions WHERE id = ? LIMIT 1;',
          [versionId],
        )[0];
        return row?.payloadJson || null;
      }
      const row = database.json(
        'SELECT payload_json AS payloadJson FROM user_confusing_words_backup_versions WHERE id = ? AND user_id = ? LIMIT 1;',
        [versionId, userId],
      )[0];
      return row?.payloadJson || null;
    },
  };
}
