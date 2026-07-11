export function createConfusingWordsRepository(database) {
  return {
    findVersionPayload(versionId) {
      const row = database.json(
        'SELECT payload_json AS payloadJson FROM confusing_words_backup_versions WHERE id = ? LIMIT 1;',
        [versionId],
      )[0];
      return row?.payloadJson || null;
    },
  };
}
