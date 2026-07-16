import { existsSync, statSync } from 'node:fs';

export function createDictionaryService({
  repository,
  primaryDatabase,
  dictionarySqliteFile,
  sourceCsv,
  runSqliteFile,
  sqlitePath,
  sqliteIntegrityCheck,
  nowISO,
  createSafetyBackup = () => null,
  log = () => {},
}) {
  const cache = new Map();
  let ready = false;

  function primaryHasLegacyTable() {
    return Number(primaryDatabase.scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='dictionary_entries';") || 0) > 0;
  }

  function primaryLegacyCount() {
    return primaryHasLegacyTable() ? Number(primaryDatabase.scalar('SELECT COUNT(*) FROM dictionary_entries;') || 0) : 0;
  }

  function sourceSignature() {
    if (!sourceCsv || !existsSync(sourceCsv)) return '';
    const stats = statSync(sourceCsv);
    return `${stats.size}:${Math.round(stats.mtimeMs)}`;
  }

  function importFromCsv(signature) {
    runSqliteFile(dictionarySqliteFile, `DROP TABLE IF EXISTS dictionary_import;
CREATE TABLE dictionary_import (
  word TEXT,
  phonetic TEXT,
  definition TEXT,
  translation TEXT,
  pos TEXT,
  collins TEXT,
  oxford TEXT,
  tag TEXT,
  bnc TEXT,
  frq TEXT,
  exchange TEXT,
  detail TEXT,
  audio TEXT
);
.mode csv
.import --skip 1 ${sqlitePath(sourceCsv)} dictionary_import
BEGIN;
DELETE FROM dictionary_entries;
INSERT OR REPLACE INTO dictionary_entries (
  word, phonetic, english_definition, chinese_definition, part_of_speech,
  tag, frequency, updated_at
)
SELECT lower(trim(word)), phonetic, definition, translation, pos,
  tag, CAST(NULLIF(frq, '') AS INTEGER), datetime('now')
FROM dictionary_import WHERE trim(word) <> '' AND trim(translation) <> '';
DROP TABLE dictionary_import;
INSERT INTO dictionary_metadata(key,value,updated_at)
VALUES('source_signature',${repositorySqlString(signature)},datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
INSERT INTO dictionary_metadata(key,value,updated_at)
VALUES('indexed_at',${repositorySqlString(nowISO())},datetime('now'))
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
COMMIT;`, { maxBuffer: 256 * 1024 * 1024 });
  }

  function repositorySqlString(value) {
    return `'${String(value ?? '').replace(/'/g, "''")}'`;
  }

  function copyFromPrimary() {
    repository.copyFromPrimary(primaryDatabase.file, nowISO());
  }

  function removeLegacyTable(expectedCount) {
    if (!primaryHasLegacyTable()) return false;
    const externalCount = repository.count();
    if (!expectedCount || externalCount < expectedCount) {
      throw new Error(`Dictionary migration count mismatch: primary=${expectedCount}, external=${externalCount}`);
    }
    if (sqliteIntegrityCheck(dictionarySqliteFile) !== 'ok') {
      throw new Error('Dictionary database integrity check failed');
    }
    primaryDatabase.run(`DROP INDEX IF EXISTS idx_dictionary_entries_frequency;
DROP TABLE IF EXISTS dictionary_entries;
VACUUM;`);
    return true;
  }

  function ensureReady() {
    if (ready) return status();
    repository.ensureSchema();
    const signature = sourceSignature();
    const legacyCount = primaryLegacyCount();
    let safetyBackup = null;
    let imported = false;
    let migrated = false;

    if (signature && repository.getMetadata('source_signature') !== signature) {
      if (legacyCount) safetyBackup = createSafetyBackup('pre-dictionary-split', 'backup before dictionary database split');
      importFromCsv(signature);
      repository.checkpoint();
      imported = true;
    } else if (!repository.count() && legacyCount) {
      safetyBackup = createSafetyBackup('pre-dictionary-split', 'backup before dictionary database split');
      copyFromPrimary();
      repository.checkpoint();
      migrated = true;
    }

    if (legacyCount && repository.count() >= legacyCount) {
      if (!safetyBackup) safetyBackup = createSafetyBackup('pre-dictionary-split', 'backup before removing legacy dictionary table');
      removeLegacyTable(legacyCount);
      migrated = true;
    }

    repository.checkpoint();
    cache.clear();
    ready = true;
    const result = { ...status(), imported, migrated, safetyBackup: safetyBackup?.filePath || '' };
    log('info', 'dictionary_database_ready', result);
    return result;
  }

  function find(word) {
    ensureReady();
    const key = String(word || '').trim().toLowerCase();
    if (!key) return null;
    if (cache.has(key)) return cache.get(key);
    const row = repository.find(key);
    cache.set(key, row);
    return row;
  }

  function status() {
    repository.ensureSchema();
    return {
      file: dictionarySqliteFile,
      sizeBytes: existsSync(dictionarySqliteFile) ? statSync(dictionarySqliteFile).size : 0,
      count: repository.count(),
      indexedAt: repository.getMetadata('indexed_at') || repository.getMetadata('migrated_from_primary_at') || null,
      sourceSignature: repository.getMetadata('source_signature') || null,
      legacyTablePresent: primaryHasLegacyTable(),
    };
  }

  function reset() {
    ready = false;
    cache.clear();
    repository.close();
  }

  return { ensureReady, find, status, reset };
}
