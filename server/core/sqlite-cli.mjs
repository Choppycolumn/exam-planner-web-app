import { spawnSync } from 'node:child_process';
import { sqlString, sqlValue, sqliteIntegrityCheck } from '../modules/sqlite-repository.mjs';

export { sqlString, sqlValue, sqliteIntegrityCheck };

export function sqlitePath(value) {
  return `'${String(value || '').replace(/\\/g, '/').replace(/'/g, "''")}'`;
}

// Reserved for offline backup validation and the one-time dictionary CSV import.
// Request-path queries use the persistent DatabaseSync repository instead.
export function runSqliteFile(databaseFile, script, { maxBuffer = 128 * 1024 * 1024 } = {}) {
  const result = spawnSync('sqlite3', [databaseFile], {
    input: script,
    encoding: 'utf8',
    maxBuffer,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`sqlite3 failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

export function createSqliteCli({ repository }) {
  if (!repository) throw new Error('persistent sqlite repository is required');
  return {
    runSqlite: repository.run,
    sqliteExecute: repository.execute,
    sqliteScalar: repository.scalar,
    sqliteJson: repository.json,
    runSqliteTransaction: repository.transaction,
    closeSqlite: repository.close,
  };
}
