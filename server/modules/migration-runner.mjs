import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

function migrationVersion(fileName) {
  const match = /^(\d+)_/.exec(fileName);
  return match ? Number(match[1]) : 0;
}

function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

function migrationFiles(migrationsDir) {
  return readdirSync(migrationsDir)
    .filter((file) => /^\d+_.+\.sql$/i.test(file))
    .map((fileName) => {
      const content = readFileSync(join(migrationsDir, fileName), 'utf8');
      return {
        version: migrationVersion(fileName),
        fileName: basename(fileName),
        content,
        checksum: checksum(content),
      };
    })
    .sort((left, right) => left.version - right.version || left.fileName.localeCompare(right.fileName));
}

function ensureLedger(sqlite) {
  sqlite.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
  file_name TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_version ON schema_migrations(version, file_name);`);
}

function ledgerRows(sqlite) {
  ensureLedger(sqlite);
  return sqlite.json(`SELECT file_name AS fileName, version, checksum, status,
applied_at AS appliedAt, duration_ms AS durationMs
FROM schema_migrations ORDER BY version, file_name;`);
}

function recordMigration(sqlite, migration, status, durationMs = 0) {
  sqlite.run(`INSERT INTO schema_migrations(file_name,version,checksum,status,applied_at,duration_ms)
VALUES(${sqlString(migration.fileName)},${migration.version},${sqlString(migration.checksum)},${sqlString(status)},datetime('now'),${Math.max(0, Math.round(durationMs))});`);
}

export function migrationStatus({ sqlite, migrationsDir }) {
  const files = migrationFiles(migrationsDir);
  const applied = new Map(ledgerRows(sqlite).map((row) => [row.fileName, row]));
  const pending = [];
  const mismatched = [];
  for (const file of files) {
    const row = applied.get(file.fileName);
    if (!row) pending.push({ version: file.version, fileName: file.fileName });
    else if (row.checksum !== file.checksum) mismatched.push({
      version: file.version,
      fileName: file.fileName,
      expected: row.checksum,
      actual: file.checksum,
    });
  }
  return { files: files.length, applied: applied.size, pending, mismatched };
}

export function runSqlMigrations({
  sqlite,
  migrationsDir,
  currentVersion = 0,
  baselineThrough = currentVersion,
  setVersion,
  shouldApply = () => true,
}) {
  ensureLedger(sqlite);
  const existing = new Map(ledgerRows(sqlite).map((row) => [row.fileName, row]));
  const applied = [];

  for (const migration of migrationFiles(migrationsDir)) {
    const previous = existing.get(migration.fileName);
    if (previous) {
      if (previous.checksum !== migration.checksum) {
        throw new Error(`Migration checksum mismatch: ${migration.fileName}`);
      }
      continue;
    }
    if (migration.version <= baselineThrough) {
      recordMigration(sqlite, migration, 'baseline');
      continue;
    }
    if (!shouldApply(migration.fileName, migration.version)) {
      recordMigration(sqlite, migration, 'skipped');
      setVersion?.(migration.version);
      applied.push({ version: migration.version, fileName: migration.fileName, status: 'skipped' });
      continue;
    }

    const startedAt = Date.now();
    sqlite.run(`BEGIN IMMEDIATE;
${migration.content}
INSERT INTO schema_migrations(file_name,version,checksum,status,applied_at,duration_ms)
VALUES(${sqlString(migration.fileName)},${migration.version},${sqlString(migration.checksum)},'applied',datetime('now'),0);
COMMIT;`);
    const durationMs = Date.now() - startedAt;
    sqlite.execute('UPDATE schema_migrations SET duration_ms = ? WHERE file_name = ?;', [durationMs, migration.fileName]);
    setVersion?.(migration.version);
    applied.push({ version: migration.version, fileName: migration.fileName, status: 'applied', durationMs });
  }

  const status = migrationStatus({ sqlite, migrationsDir });
  if (status.mismatched.length) throw new Error(`Migration checksum mismatch: ${status.mismatched[0].fileName}`);
  return applied;
}
