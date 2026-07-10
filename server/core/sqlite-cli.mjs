import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { sqlString, sqlValue } from '../modules/sqlite-repository.mjs';

export { sqlString, sqlValue };

export function sqlitePath(value) {
  return `'${String(value || '').replace(/\\/g, '/').replace(/'/g, "''")}'`;
}

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

export function createSqliteCli({ sqliteFile, dataDir }) {
  const runSqlite = (script, { maxBuffer = 128 * 1024 * 1024 } = {}) => {
    mkdirSync(dataDir, { recursive: true });
    return runSqliteFile(sqliteFile, script, { maxBuffer });
  };

  const sqliteScalar = (sql) => runSqlite(`.headers off\n.mode list\n${sql}\n`).trim();
  const sqliteJson = (sql) => {
    const output = runSqlite(`.mode json\n${sql}\n`).trim();
    return output ? JSON.parse(output) : [];
  };
  const runSqliteTransaction = (statements = []) => {
    const body = Array.isArray(statements) ? statements.join('\n') : String(statements || '');
    return runSqlite(`BEGIN IMMEDIATE;\n${body}\nCOMMIT;`);
  };

  return { runSqlite, sqliteScalar, sqliteJson, runSqliteTransaction };
}
