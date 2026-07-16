import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

export function createBackupService({
  backupsDir,
  sqliteFile,
  libraryDir,
  libraryFilesDir,
  assertDiskSpace,
  repository,
  sqliteIntegrityCheck,
  nowISO,
  resolveBackupPath,
  redactSecretText,
  ensureSqliteStore,
  resetSqliteRuntime,
  retention = {},
  dictionaryStatus = () => ({ count: 0, indexedAt: null, sizeBytes: 0 }),
}) {
  let backupVerificationCache = null;
  const retentionPolicy = {
    daily: Math.max(1, Number(retention.daily || 7)),
    weekly: Math.max(1, Number(retention.weekly || 4)),
    deploy: Math.max(1, Number(retention.deploy || 5)),
    manual: Math.max(1, Number(retention.manual || 5)),
    migration: Math.max(1, Number(retention.migration || 5)),
    other: Math.max(1, Number(retention.other || 3)),
  };

  function persistBackupVerification(result) {
    backupVerificationCache = result;
    repository.setMetadata('last_backup_verification_json', JSON.stringify(result));
    return result;
  }

  function storedBackupVerification() {
    if (backupVerificationCache) return backupVerificationCache;
    try {
      const raw = repository.getMetadata('last_backup_verification_json');
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
    repository.checkpoint();
    if (existsSync(filePath)) unlinkSync(filePath);
    repository.vacuumInto(filePath);
    const integrity = sqliteIntegrityCheck(filePath);
    if (integrity !== 'ok') {
      try {
        unlinkSync(filePath);
      } catch {
        // Ignore cleanup failure; the integrity error below is the useful signal.
      }
      throw new Error(`Backup integrity check failed: ${integrity}`);
    }
    repository.recordBackup(kind, filePath, note);
    persistBackupVerification({ ok: true, checkedAt: nowISO(), fileName: filePath.split(/[\\/]/).pop() || '', integrity: 'ok' });
    if (kind === 'weekly') {
      repository.setMetadata('last_weekly_backup_at', nowISO());
    }
    if (kind === 'daily') {
      repository.setMetadata('last_daily_backup_at', nowISO());
    }
    applyRetentionPolicy();
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
      .filter((name) => name.endsWith('.sqlite'))
      .map(backupFileToRecord)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  function retentionCategory(fileName) {
    if (/exam-planner-daily-/i.test(fileName)) return 'daily';
    if (/exam-planner-weekly-/i.test(fileName)) return 'weekly';
    if (/pre-deploy/i.test(fileName)) return 'deploy';
    if (/manual/i.test(fileName)) return 'manual';
    if (/^pre-|migration|pre-/i.test(fileName)) return 'migration';
    return 'other';
  }

  function applyRetentionPolicy() {
    const files = listBackupFiles();
    const grouped = Object.groupBy(files, (file) => retentionCategory(file.fileName));
    const removed = [];
    const skipped = [];
    for (const [category, categoryFiles] of Object.entries(grouped)) {
      const keepCount = retentionPolicy[category] || retentionPolicy.other;
      const keep = categoryFiles.slice(0, keepCount);
      const overflow = categoryFiles.slice(keepCount);
      if (!overflow.length) continue;
      const verified = keep.some((file) => {
        try {
          return sqliteIntegrityCheck(join(backupsDir, file.fileName)) === 'ok';
        } catch {
          return false;
        }
      });
      if (!verified) {
        skipped.push({ category, reason: 'no verified retained backup', count: overflow.length });
        continue;
      }
      for (const file of overflow) {
        try {
          unlinkSync(join(backupsDir, file.fileName));
          removed.push(file.fileName);
        } catch (error) {
          skipped.push({ category, fileName: file.fileName, reason: redactSecretText(error.message || String(error)) });
        }
      }
    }
    const result = { checkedAt: nowISO(), policy: retentionPolicy, removed, skipped };
    repository.setMetadata('last_backup_retention_json', JSON.stringify(result));
    return result;
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
    repository.checkpoint();
    resetSqliteRuntime?.();
    copyFileSync(sourceFile, sqliteFile);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${sqliteFile}${suffix}`;
      if (existsSync(sidecar)) unlinkSync(sidecar);
    }
    ensureSqliteStore();
    repository.recordBackup('restore', sourceFile, `restored from ${fileName}; safety backup ${safetyBackup.filePath}`);
    return { restoredFrom: fileName, safetyBackup };
  }

  function cleanupWeeklyBackups(keepCount = 12) {
    retentionPolicy.weekly = Math.max(1, Number(keepCount || retentionPolicy.weekly));
    return applyRetentionPolicy();
  }

  function cleanupDailyBackups(keepCount = 14) {
    retentionPolicy.daily = Math.max(1, Number(keepCount || retentionPolicy.daily));
    return applyRetentionPolicy();
  }

  function ensureDailyBackup() {
    const lastBackupAt = repository.getMetadata('last_daily_backup_at');
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (!lastBackupAt || Date.now() - new Date(lastBackupAt).getTime() >= oneDayMs) {
      createBackupFile('daily', 'automatic daily backup');
      applyRetentionPolicy();
    }
  }

  function ensureWeeklyBackup() {
    const lastBackupAt = repository.getMetadata('last_weekly_backup_at');
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
    if (!lastBackupAt || Date.now() - new Date(lastBackupAt).getTime() >= oneWeekMs) {
      createBackupFile('weekly', 'automatic weekly backup');
      applyRetentionPolicy();
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
    const lastBackup = repository.latestBackup();
    const dictionary = dictionaryStatus();
    const lastWeeklyBackupAt = repository.getMetadata('last_weekly_backup_at');
    const lastDailyBackupAt = repository.getMetadata('last_daily_backup_at');
    let lastRetention = null;
    try {
      const raw = repository.getMetadata('last_backup_retention_json');
      lastRetention = raw ? JSON.parse(raw) : null;
    } catch {
      lastRetention = null;
    }
    return {
      storage: 'split-sqlite',
      sqliteFile,
      sqliteSizeBytes: existsSync(sqliteFile) ? statSync(sqliteFile).size : 0,
      backupCount: backups.length,
      backups,
      lastBackup,
      latestVerification: latestBackupVerification(backups, { force: verifyLatest }),
      lastDailyBackupAt: lastDailyBackupAt || null,
      lastWeeklyBackupAt: lastWeeklyBackupAt || null,
      dictionaryCount: Number(dictionary.count || 0),
      dictionaryIndexedAt: dictionary.indexedAt || null,
      dictionary,
      retentionPolicy,
      lastRetention,
    };
  }

  function nextWeeklyBackupAt() {
    const lastWeeklyBackupAt = repository.getMetadata('last_weekly_backup_at');
    if (!lastWeeklyBackupAt) return nowISO();
    const next = new Date(new Date(lastWeeklyBackupAt).getTime() + 7 * 24 * 60 * 60 * 1000);
    return next.toISOString();
  }

  function nextDailyBackupAt() {
    const lastDailyBackupAt = repository.getMetadata('last_daily_backup_at');
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
    applyRetentionPolicy,
    ensureDailyBackup,
    ensureWeeklyBackup,
    getBackupStatus,
    nextWeeklyBackupAt,
    nextDailyBackupAt,
  };
}
