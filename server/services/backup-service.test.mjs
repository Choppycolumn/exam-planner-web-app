import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { resolveBackupPath } from '../modules/backup-validation.mjs';
import { createSqliteRepository, sqliteIntegrityCheck } from '../modules/sqlite-repository.mjs';
import { createBackupRepository } from '../repositories/backup-repository.mjs';
import { createBackupService } from './backup-service.mjs';

const directories = [];
afterEach(() => { while (directories.length) rmSync(directories.pop(), { recursive: true, force: true }); });

describe('backup service with persistent sqlite', () => {
  test('closes the live connection before replacing the database', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'exam-planner-backup-'));
    directories.push(dataDir);
    const sqliteFile = join(dataDir, 'app.sqlite');
    const backupsDir = join(dataDir, 'backups');
    const repository = createSqliteRepository({ sqliteFile, dataDir });
    const backupRepository = createBackupRepository(repository);
    repository.run(`CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
CREATE TABLE backup_log(id INTEGER PRIMARY KEY,kind TEXT,file_path TEXT,created_at TEXT,note TEXT);
CREATE TABLE dictionary_entries(word TEXT PRIMARY KEY);
CREATE TABLE sample(value TEXT);
INSERT INTO sample VALUES ('before');`);
    const service = createBackupService({
      backupsDir, sqliteFile, libraryDir: '', libraryFilesDir: '', assertDiskSpace: () => {},
      repository: backupRepository, sqliteIntegrityCheck,
      nowISO: () => new Date().toISOString(), resolveBackupPath, redactSecretText: String,
      ensureSqliteStore: () => repository.open(), resetSqliteRuntime: repository.close,
    });
    const backup = service.createBackupFile('manual', 'test');
    repository.run("INSERT INTO sample VALUES ('after');");
    service.restoreBackupFile(backup.filePath.split(/[\\/]/).pop());
    expect(repository.json('SELECT value FROM sample ORDER BY value;')).toEqual([{ value: 'before' }]);
    repository.close();
  });

  test('keeps only verified backups allowed by the retention policy', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'exam-planner-retention-'));
    directories.push(dataDir);
    const sqliteFile = join(dataDir, 'app.sqlite');
    const backupsDir = join(dataDir, 'backups');
    const repository = createSqliteRepository({ sqliteFile, dataDir });
    const backupRepository = createBackupRepository(repository);
    repository.run(`CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
CREATE TABLE backup_log(id INTEGER PRIMARY KEY,kind TEXT,file_path TEXT,created_at TEXT,note TEXT);
CREATE TABLE dictionary_entries(word TEXT PRIMARY KEY);
CREATE TABLE sample(value TEXT);`);
    const service = createBackupService({
      backupsDir, sqliteFile, libraryDir: '', libraryFilesDir: '', assertDiskSpace: () => {},
      repository: backupRepository, sqliteIntegrityCheck,
      nowISO: () => new Date().toISOString(), resolveBackupPath, redactSecretText: String,
      ensureSqliteStore: () => repository.open(), resetSqliteRuntime: repository.close,
      retention: { daily: 2, weekly: 1, deploy: 1, manual: 1, migration: 1, other: 1 },
    });
    const source = service.createBackupFile('daily', 'fixture').filePath;
    for (let index = 0; index < 4; index += 1) {
      copyFileSync(source, join(backupsDir, `exam-planner-daily-2026010${index}T000000Z.sqlite`));
    }
    const result = service.applyRetentionPolicy();
    expect(result.removed.length).toBeGreaterThanOrEqual(3);
    expect(readdirSync(backupsDir).filter((name) => /daily/.test(name))).toHaveLength(2);
    repository.close();
  });
});
