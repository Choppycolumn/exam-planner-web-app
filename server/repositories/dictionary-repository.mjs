export function createDictionaryRepository(database) {
  function ensureSchema() {
    database.run(`CREATE TABLE IF NOT EXISTS dictionary_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dictionary_entries (
  word TEXT PRIMARY KEY,
  phonetic TEXT,
  english_definition TEXT,
  chinese_definition TEXT,
  part_of_speech TEXT,
  tag TEXT,
  frequency INTEGER,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dictionary_entries_frequency ON dictionary_entries(frequency);`);
  }

  return {
    file: database.file,
    ensureSchema,
    close: database.close,
    checkpoint() {
      database.run('PRAGMA wal_checkpoint(TRUNCATE);');
    },
    count() {
      ensureSchema();
      return Number(database.scalar('SELECT COUNT(*) FROM dictionary_entries;') || 0);
    },
    find(word) {
      ensureSchema();
      return database.json(`SELECT word, phonetic, english_definition, chinese_definition, part_of_speech
FROM dictionary_entries WHERE word = ? LIMIT 1;`, [String(word || '').trim().toLowerCase()])[0] || null;
    },
    getMetadata(key) {
      ensureSchema();
      return database.scalar('SELECT value FROM dictionary_metadata WHERE key = ? LIMIT 1;', [key]) || '';
    },
    setMetadata(key, value) {
      ensureSchema();
      database.execute(`INSERT INTO dictionary_metadata(key,value,updated_at)
VALUES(?,?,datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;`, [key, String(value ?? '')]);
    },
    copyFromPrimary(primaryFile, migratedAt) {
      ensureSchema();
      database.run(`ATTACH DATABASE ${database.sqlString(primaryFile)} AS legacy;
BEGIN;
DELETE FROM dictionary_entries;
INSERT OR REPLACE INTO dictionary_entries (
  word, phonetic, english_definition, chinese_definition, part_of_speech,
  tag, frequency, updated_at
)
SELECT word, phonetic, english_definition, chinese_definition, part_of_speech,
  tag, frequency, updated_at
FROM legacy.dictionary_entries;
INSERT INTO dictionary_metadata(key,value,updated_at)
VALUES('migrated_from_primary_at',${database.sqlString(migratedAt)},datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
COMMIT;
DETACH DATABASE legacy;`);
    },
  };
}
