export function createBackupRepository(database) {
  return {
    setMetadata(key, value) {
      database.execute(`INSERT INTO app_metadata (key, value, updated_at)
VALUES (?, ?, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`, [key, String(value ?? '')]);
    },
    getMetadata(key) {
      return database.scalar('SELECT value FROM app_metadata WHERE key = ? LIMIT 1;', [key]) || '';
    },
    checkpoint() {
      database.run('PRAGMA wal_checkpoint(TRUNCATE);');
    },
    vacuumInto(filePath) {
      database.run(`VACUUM INTO ${database.sqlString(filePath)};`);
    },
    recordBackup(kind, filePath, note) {
      database.execute(`INSERT INTO backup_log (kind, file_path, created_at, note)
VALUES (?, ?, datetime('now'), ?);`, [kind, filePath, note]);
    },
    latestBackup() {
      return database.json(`SELECT kind, file_path AS filePath, created_at AS createdAt, note
FROM backup_log ORDER BY datetime(created_at) DESC LIMIT 1;`)[0] || null;
    },
    dictionaryCount() {
      return Number(database.scalar('SELECT COUNT(*) FROM dictionary_entries;') || 0);
    },
  };
}
