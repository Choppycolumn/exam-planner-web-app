import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function createBackupService({
  backupsDir,
  sqliteFile,
  libraryDir,
  libraryFilesDir,
  assertDiskSpace,
  runSqlite,
  sqliteIntegrityCheck,
  sqlitePath,
  sqlString,
  sqliteScalar,
  sqliteJson,
  nowISO,
  resolveBackupPath,
  redactSecretText,
  ensureSqliteStore,
  resetSqliteRuntime,
}) {
  let backupVerificationCache = null;

  function persistBackupVerification(result) {
    backupVerificationCache = result;
    runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_backup_verification_json', ${sqlString(JSON.stringify(result))}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
    return result;
  }

  function storedBackupVerification() {
    if (backupVerificationCache) return backupVerificationCache;
    try {
      const raw = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_backup_verification_json' LIMIT 1;");
      backupVerificationCache = raw ? JSON.parse(raw) : null;
    } catch {
      backupVerificationCache = null;
    }
    return backupVerificationCache;
  }

  function createBackupFile(kind = 'manual', note = '') {
    mkdirSync(backupsDir, { recursive: true });
    assertDiskSpace();
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, `-${Date.now() % 1000}Z`);
    const filePath = join(backupsDir, `exam-planner-${kind}-${timestamp}.sqlite`);
    let libraryArchivePath = null;
    runSqlite('PRAGMA wal_checkpoint(TRUNCATE);');
    if (existsSync(filePath)) unlinkSync(filePath);
    runSqlite(`VACUUM INTO ${sqlitePath(filePath)};`);
    const integrity = sqliteIntegrityCheck(filePath);
    if (integrity !== 'ok') {
      try {
        unlinkSync(filePath);
      } catch {
        // Ignore cleanup failure; the integrity error below is the useful signal.
      }
      throw new Error(`Backup integrity check failed: ${integrity}`);
    }
    runSqlite(`INSERT INTO backup_log (kind, file_path, created_at, note)
VALUES (${sqlString(kind)}, ${sqlString(filePath)}, datetime('now'), ${sqlString(note)});`);
    persistBackupVerification({ ok: true, checkedAt: nowISO(), fileName: filePath.split(/[\\/]/).pop() || '', integrity: 'ok' });
    if (kind === 'weekly') {
      runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_weekly_backup_at', ${sqlString(nowISO())}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
    }
    if (kind === 'daily') {
      runSqlite(`INSERT INTO app_metadata (key, value, updated_at)
VALUES ('last_daily_backup_at', ${sqlString(nowISO())}, datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;`);
    }
    return { kind, filePath, libraryArchivePath, createdAt: nowISO() };
  }

  function backupFileToRecord(fileName) {
    const filePath = join(backupsDir, fileName);
    const stats = statSync(filePath);
    const match = fileName.match(/^exam-planner-([a-z-]+)-(.+)\.sqlite$/);
    return {
      fileName,
      kind: match?.[1] || 'unknown',
      createdAt: stats.mtime.toISOString(),
      sizeBytes: stats.size,
    };
  }

  function listBackupFiles() {
    if (!existsSync(backupsDir)) return [];
    return readdirSync(backupsDir)
      .filter((name) => /^exam-planner-[a-z-]+-.+\.sqlite$/.test(name))
      .map(backupFileToRecord)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  function restoreBackupFile(fileName) {
    const sourceFile = resolveBackupPath(backupsDir, fileName);
    if (!existsSync(sourceFile)) {
      throw new Error('Backup file not found');
    }
    const integrity = sqliteIntegrityCheck(sourceFile);
    if (integrity !== 'ok') {
      throw new Error(`Backup integrity check failed: ${integrity}`);
    }

    const safetyBackup = createBackupFile('pre-restore', `automatic safety backup before restoring ${fileName}`);
    runSqlite('PRAGMA wal_checkpoint(TRUNCATE);');
    resetSqliteRuntime?.();
    copyFileSync(sourceFile, sqliteFile);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${sqliteFile}${suffix}`;
      if (existsSync(sidecar)) unlinkSync(sidecar);
    }
    ensureSqliteStore();
    runSqlite(`INSERT INTO backup_log (kind, file_path, created_at, note)
VALUES ('restore', ${sqlString(sourceFile)}, datetime('now'), ${sqlString(`restored from ${fileName}; safety backup ${safetyBackup.filePath}`)});`);
    return { restoredFrom: fileName, safetyBackup };
  }

  function cleanupWeeklyBackups(keepCount = 12) {
    if (!existsSync(backupsDir)) return;
    const weeklyBackups = readdirSync(backupsDir)
      .filter((name) => /^exam-planner-weekly-.*\.sqlite$/.test(name))
      .sort()
      .reverse();
    for (const name of weeklyBackups.slice(keepCount)) {
      try {
        unlinkSync(join(backupsDir, name));
      } catch {
        // A stale backup failing to delete should not block the app.
      }
    }
  }

  function cleanupDailyBackups(keepCount = 14) {
    if (!existsSync(backupsDir)) return;
    const dailyBackups = readdirSync(backupsDir)
      .filter((name) => /^exam-planner-daily-.*\.sqlite$/.test(name))
      .sort()
      .reverse();
    for (const name of dailyBackups.slice(keepCount)) {
      try {
        unlinkSync(join(backupsDir, name));
      } catch {
        // A stale backup failing to delete should not block the app.
      }
    }
  }

  function ensureDailyBackup() {
    const lastBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_daily_backup_at' LIMIT 1;");
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (!lastBackupAt || Date.now() - new Date(lastBackupAt).getTime() >= oneDayMs) {
      createBackupFile('daily', 'automatic daily backup');
      cleanupDailyBackups();
    }
  }

  function ensureWeeklyBackup() {
    const lastBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_weekly_backup_at' LIMIT 1;");
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    if (!lastBackupAt || Date.now() - new Date(lastBackupAt).getTime() >= oneWeekMs) {
      createBackupFile('weekly', 'automatic weekly backup');
      cleanupWeeklyBackups();
    }
  }

  function latestBackupVerification(backups = [], { force = false } = {}) {
    const latest = backups.find((backup) => backup.kind === 'manual' || backup.kind === 'daily' || backup.kind === 'weekly') || backups[0];
    if (!latest) return { ok: false, checkedAt: nowISO(), fileName: '', integrity: 'missing' };
    const cacheFreshMs = 6 * 60 * 60 * 1000;
    const cached = storedBackupVerification();
    if (!force && cached?.fileName === latest.fileName && Date.now() - new Date(cached.checkedAt).getTime() < cacheFreshMs) {
      return cached;
    }
    if (!force) return cached?.fileName === latest.fileName ? cached : { ok: null, checkedAt: '', fileName: latest.fileName, integrity: 'not_checked' };
    try {
      const integrity = sqliteIntegrityCheck(join(backupsDir, latest.fileName));
      return persistBackupVerification({ ok: integrity === 'ok', checkedAt: nowISO(), fileName: latest.fileName, integrity });
    } catch (error) {
      return persistBackupVerification({ ok: false, checkedAt: nowISO(), fileName: latest.fileName, integrity: redactSecretText(error.message || String(error)) });
    }
  }

  function getBackupStatus({ verifyLatest = false } = {}) {
    ensureSqliteStore();
    const backups = listBackupFiles();
    const backupRows = sqliteJson(`SELECT kind, file_path AS filePath, created_at AS createdAt, note
FROM backup_log
ORDER BY datetime(created_at) DESC
LIMIT 1;`);
    const dictionaryCount = Number(sqliteScalar('SELECT COUNT(*) FROM dictionary_entries;') || 0);
    const lastWeeklyBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_weekly_backup_at' LIMIT 1;");
    const lastDailyBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_daily_backup_at' LIMIT 1;");
    const dictionaryIndexedAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'dictionary_indexed_at' LIMIT 1;");
    return {
      storage: 'sqlite-tables',
      sqliteFile,
      sqliteSizeBytes: existsSync(sqliteFile) ? statSync(sqliteFile).size : 0,
      backupCount: backups.length,
      backups,
      lastBackup: backupRows[0] || null,
      latestVerification: latestBackupVerification(backups, { force: verifyLatest }),
      lastDailyBackupAt: lastDailyBackupAt || null,
      lastWeeklyBackupAt: lastWeeklyBackupAt || null,
      dictionaryCount,
      dictionaryIndexedAt: dictionaryIndexedAt || null,
    };
  }

  function nextWeeklyBackupAt() {
    const lastWeeklyBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_weekly_backup_at' LIMIT 1;");
    if (!lastWeeklyBackupAt) return nowISO();
    const next = new Date(new Date(lastWeeklyBackupAt).getTime() + 7 * 24 * 60 * 60 * 1000);
    return next.toISOString();
  }

  function nextDailyBackupAt() {
    const lastDailyBackupAt = sqliteScalar("SELECT value FROM app_metadata WHERE key = 'last_daily_backup_at' LIMIT 1;");
    if (!lastDailyBackupAt) return nowISO();
    const next = new Date(new Date(lastDailyBackupAt).getTime() + 24 * 60 * 60 * 1000);
    return next.toISOString();
  }

  return {
    createBackupFile,
    listBackupFiles,
    restoreBackupFile,
    cleanupWeeklyBackups,
    cleanupDailyBackups,
    ensureDailyBackup,
    ensureWeeklyBackup,
    getBackupStatus,
    nextWeeklyBackupAt,
    nextDailyBackupAt,
  };
}
