import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

export function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

export function sqlValue(value) {
  if (value === undefined || value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return sqlString(value);
}

export function createSqliteRepository({ sqliteFile, dataDir, sqliteCommand = 'sqlite3', sqliteUseShell = false }) {
  const run = (script, { maxBuffer = 128 * 1024 * 1024 } = {}) => {
    mkdirSync(dataDir, { recursive: true });
    const result = spawnSync(sqliteCommand, [sqliteFile], {
      input: script,
      encoding: 'utf8',
      maxBuffer,
      shell: sqliteUseShell,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`sqlite3 failed: ${result.stderr || result.stdout}`);
    return result.stdout;
  };

  const scalar = (sql) => run(`.headers off\n.mode list\n${sql}\n`).trim();
  const json = (sql) => {
    const output = run(`.mode json\n${sql}\n`).trim();
    return output ? JSON.parse(output) : [];
  };
  const transaction = (statements = []) => {
    const body = Array.isArray(statements) ? statements.join('\n') : String(statements || '');
    return run(`BEGIN IMMEDIATE;\n${body}\nCOMMIT;`);
  };

  return {
    file: sqliteFile,
    run,
    scalar,
    json,
    transaction,
    sqlString,
    sqlValue,
  };
}
