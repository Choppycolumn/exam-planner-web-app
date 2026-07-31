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
  const statistics = {
    calls: 0,
    reads: 0,
    writes: 0,
    transactions: 0,
    busyErrors: 0,
    totalDurationMs: 0,
    slowCalls: 0,
    lastDurationMs: 0,
  };

  const measured = (operation, kind = 'read') => {
    const startedAt = performance.now();
    try {
      return operation();
    } catch (error) {
      if (/busy|locked/i.test(String(error?.message || ''))) statistics.busyErrors += 1;
      throw error;
    } finally {
      const durationMs = performance.now() - startedAt;
      statistics.calls += 1;
      if (kind === 'write') statistics.writes += 1;
      else statistics.reads += 1;
      statistics.totalDurationMs += durationMs;
      statistics.lastDurationMs = durationMs;
      if (durationMs >= 100) statistics.slowCalls += 1;
    }
  };

  const open = () => {
    if (database) return database;
    mkdirSync(dataDir, { recursive: true });
    database = new DatabaseSync(sqliteFile);
    database.exec(`PRAGMA busy_timeout=8000;
PRAGMA foreign_keys=ON;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA cache_size=-8192;`);
    if (sqliteFile !== ':memory:') {
      database.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=1000;');
    }
    return database;
  };

  const close = () => {
    if (!database) return;
    database.close();
    database = null;
  };

  const run = (script) => {
    measured(() => open().exec(String(script || '')), 'write');
    return '';
  };

  const execute = (sql, parameters = []) => {
    const statement = open().prepare(sql);
    return measured(() => (Array.isArray(parameters) ? statement.run(...parameters) : statement.run(parameters)), 'write');
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

  const transaction = (work = []) => {
    const db = open();
    return measured(() => {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const result = typeof work === 'function'
          ? work(db)
          : db.exec(Array.isArray(work) ? work.join('\n') : String(work || ''));
        db.exec('COMMIT;');
        statistics.transactions += 1;
        return result ?? '';
      } catch (error) {
        try { db.exec('ROLLBACK;'); } catch { /* preserve the original failure */ }
        throw error;
      }
    }, 'write');
  };

  const checkpoint = ({ truncate = false } = {}) => {
    if (sqliteFile === ':memory:') return [];
    const mode = truncate ? 'TRUNCATE' : 'PASSIVE';
    return measured(() => open().prepare(`PRAGMA wal_checkpoint(${mode});`).all(), 'write');
  };

  const optimize = () => measured(() => {
    const db = open();
    db.exec('PRAGMA optimize; ANALYZE;');
  }, 'write');

  return {
    file: sqliteFile,
    open,
    close,
    run,
    execute,
    scalar,
    json,
    transaction,
    checkpoint,
    optimize,
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
