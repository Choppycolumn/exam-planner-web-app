import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteRepository } from './sqlite-repository.mjs';
import { migrationStatus, runSqlMigrations } from './migration-runner.mjs';

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('migration runner', () => {
  it('tracks duplicate numeric versions by filename and baselines existing versions', () => {
    const root = mkdtempSync(join(tmpdir(), 'migration-runner-'));
    roots.push(root);
    const migrationsDir = join(root, 'migrations');
    mkdirSync(migrationsDir);
    writeFileSync(join(migrationsDir, '001_first.sql'), 'CREATE TABLE first_table(id INTEGER);');
    writeFileSync(join(migrationsDir, '002_alpha.sql'), 'CREATE TABLE alpha_table(id INTEGER);');
    writeFileSync(join(migrationsDir, '002_beta.sql'), 'CREATE TABLE beta_table(id INTEGER);');
    const sqlite = createSqliteRepository({ sqliteFile: join(root, 'test.sqlite'), dataDir: root });

    const applied = runSqlMigrations({
      sqlite,
      migrationsDir,
      currentVersion: 1,
      setVersion: () => {},
    });

    expect(applied.map((item) => item.fileName)).toEqual(['002_alpha.sql', '002_beta.sql']);
    expect(sqlite.scalar("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('alpha_table','beta_table');")).toBe('2');
    expect(migrationStatus({ sqlite, migrationsDir })).toMatchObject({ applied: 3, pending: [], mismatched: [] });
    sqlite.close();
  });

  it('rejects a changed migration after it has been recorded', () => {
    const root = mkdtempSync(join(tmpdir(), 'migration-checksum-'));
    roots.push(root);
    const migrationsDir = join(root, 'migrations');
    mkdirSync(migrationsDir);
    const file = join(migrationsDir, '001_first.sql');
    writeFileSync(file, 'CREATE TABLE first_table(id INTEGER);');
    const sqlite = createSqliteRepository({ sqliteFile: join(root, 'test.sqlite'), dataDir: root });
    runSqlMigrations({ sqlite, migrationsDir, setVersion: () => {} });
    writeFileSync(file, 'CREATE TABLE changed_table(id INTEGER);');
    expect(() => runSqlMigrations({ sqlite, migrationsDir, setVersion: () => {} })).toThrow(/checksum mismatch/i);
    sqlite.close();
  });
});
