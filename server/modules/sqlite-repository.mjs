import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export function sqlString(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

export function sqlValue(value) {
  if (value === undefined || value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return sqlString(value);
}

function firstColumn(row) {
  if (!row) return '';
  const key = Object.keys(row)[0];
  const value = key === undefined ? '' : row[key];
  return value === null || value === undefined ? '' : String(value);
}

export function sqliteIntegrityCheck(sqliteFile) {
  const database = new DatabaseSync(sqliteFile);
  try {
    return firstColumn(database.prepare('PRAGMA integrity_check;').get());
  } finally {
    database.close();
  }
}

export function createSqliteRepository({ sqliteFile, dataDir }) {
  let database = null;
  const statistics = { calls: 0, totalDurationMs: 0, slowCalls: 0, lastDurationMs: 0 };

  const measured = (operation) => {
    const startedAt = performance.now();
    try { return operation(); } finally {
      const durationMs = performance.now() - startedAt;
      statistics.calls += 1;
      statistics.totalDurationMs += durationMs;
      statistics.lastDurationMs = durationMs;
      if (durationMs >= 100) statistics.slowCalls += 1;
    }
  };

  const open = () => {
    if (database) return database;
    mkdirSync(dataDir, { recursive: true });
    database = new DatabaseSync(sqliteFile);
    database.exec('PRAGMA busy_timeout = 5000;');
    database.exec('PRAGMA foreign_keys = ON;');
    return database;
  };

  const close = () => {
    if (!database) return;
    database.close();
    database = null;
  };

  const run = (script) => {
    measured(() => open().exec(String(script || '')));
    return '';
  };

  const execute = (sql, parameters = []) => {
    const statement = open().prepare(sql);
    return measured(() => (Array.isArray(parameters) ? statement.run(...parameters) : statement.run(parameters)));
  };

  const scalar = (sql, parameters = []) => {
    const statement = open().prepare(sql);
    const row = measured(() => (Array.isArray(parameters) ? statement.get(...parameters) : statement.get(parameters)));
    return firstColumn(row);
  };

  const json = (sql, parameters = []) => {
    const statement = open().prepare(sql);
    return measured(() => (Array.isArray(parameters) ? statement.all(...parameters) : statement.all(parameters)));
  };

  const transaction = (statements = []) => {
    const body = Array.isArray(statements) ? statements.join('\n') : String(statements || '');
    const db = open();
    db.exec('BEGIN IMMEDIATE;');
    try {
      db.exec(body);
      db.exec('COMMIT;');
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch { /* preserve the original failure */ }
      throw error;
    }
    return '';
  };

  return {
    file: sqliteFile,
    open,
    close,
    run,
    execute,
    scalar,
    json,
    transaction,
    metrics: () => ({
      ...statistics,
      open: Boolean(database),
      averageDurationMs: statistics.calls ? Math.round((statistics.totalDurationMs / statistics.calls) * 100) / 100 : 0,
      lastDurationMs: Math.round(statistics.lastDurationMs * 100) / 100,
    }),
    sqlString,
    sqlValue,
  };
}
