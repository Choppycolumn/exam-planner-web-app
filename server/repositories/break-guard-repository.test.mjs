import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteRepository } from '../modules/sqlite-repository.mjs';
import { createBreakGuardRepository } from './break-guard-repository.mjs';

describe('break guard repository study corrections', () => {
  let database;
  let repository;

  beforeEach(() => {
    database = createSqliteRepository({ sqliteFile: ':memory:', dataDir: '.' });
    database.run(`
      CREATE TABLE study_projects(
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE study_time_records(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        project_id INTEGER NOT NULL,
        project_name_snapshot TEXT NOT NULL,
        minutes INTEGER NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        schema_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        UNIQUE(date,project_id)
      );
      CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
      CREATE TABLE break_guard_events(
        id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE,event_type TEXT,status TEXT,source TEXT,note TEXT,
        started_at TEXT,ended_at TEXT,overdue_seconds INTEGER,payload_json TEXT,created_at TEXT
      );
      INSERT INTO study_projects(id,user_id,name,color,sort_order,is_active)
      VALUES(20,1,'英一','#2563eb',1,1);
    `);
    repository = createBreakGuardRepository(database, { ownerUserId: () => 1 });
  });

  afterEach(() => database.close());

  it('changes only the completed-session contribution and preserves manual minutes', () => {
    database.execute(`INSERT INTO study_time_records
      (date,project_id,project_name_snapshot,minutes,note,schema_version,created_at,updated_at,user_id)
      VALUES('2026-08-10',20,'英一',75,'包含 25 分钟手动记录',1,'now','now',1);`);

    const corrected = repository.adjustStudyTime({
      sessionDate: '2026-08-10', projectId: 20,
      previousDurationSeconds: 50 * 60, durationSeconds: 30 * 60, sessionSequence: 1,
    });
    expect(corrected).toMatchObject({ previousMinutes: 50, minutes: 30, deltaMinutes: -20, totalMinutes: 55 });

    const deleted = repository.adjustStudyTime({
      sessionDate: '2026-08-10', projectId: 20,
      previousDurationSeconds: 30 * 60, durationSeconds: 0, sessionSequence: 1, deleted: true,
    });
    expect(deleted).toMatchObject({ previousMinutes: 30, minutes: 0, deltaMinutes: -30, totalMinutes: 25 });
    expect(Number(database.scalar("SELECT minutes FROM study_time_records WHERE date='2026-08-10' AND project_id=20 AND user_id=1;"))).toBe(25);
  });

  it('creates the corrected contribution when the aggregate record is missing', () => {
    const result = repository.adjustStudyTime({
      sessionDate: '2026-08-10', projectId: 20,
      previousDurationSeconds: 90 * 60, durationSeconds: 30 * 60, sessionSequence: 2,
    });

    expect(result).toMatchObject({ minutes: 30, deltaMinutes: 30, totalMinutes: 30 });
    expect(Number(database.scalar('SELECT minutes FROM study_time_records;'))).toBe(30);
  });

  it('does not append a late completion after a correction and applies the next correction to the corrected total', () => {
    const sessionId = 'breakguard-session-order-1';
    database.execute(`INSERT INTO break_guard_events(event_id,event_type,payload_json,created_at)
      VALUES(?,?,?,?);`, [
      'correction-first-1',
      'study_session_corrected',
      JSON.stringify({ sessionId }),
      '2026-08-10T10:00:00.000Z',
    ]);

    const correctedFirst = repository.adjustStudyTime({
      sessionDate: '2026-08-10', projectId: 20,
      previousDurationSeconds: 30 * 60, durationSeconds: 45 * 60, sessionSequence: 1,
    });
    expect(correctedFirst).toMatchObject({ minutes: 45, totalMinutes: 45 });

    const lateCompletion = repository.appendStudyTime({
      sessionId, sessionDate: '2026-08-10', projectId: 20,
      durationSeconds: 30 * 60, sessionSequence: 1,
    });
    expect(lateCompletion).toMatchObject({ skipped: true, reason: 'session_mutation_already_applied' });
    expect(Number(database.scalar('SELECT minutes FROM study_time_records;'))).toBe(45);

    const correctedAgain = repository.adjustStudyTime({
      sessionDate: '2026-08-10', projectId: 20,
      previousDurationSeconds: 45 * 60, durationSeconds: 20 * 60, sessionSequence: 1,
    });
    expect(correctedAgain).toMatchObject({ minutes: 20, deltaMinutes: -25, totalMinutes: 20 });
    expect(Number(database.scalar('SELECT minutes FROM study_time_records;'))).toBe(20);
  });

  it('does not recreate a deleted session when its original completion arrives late', () => {
    const sessionId = 'breakguard-session-order-delete';
    database.execute(`INSERT INTO break_guard_events(event_id,event_type,payload_json,created_at)
      VALUES(?,?,?,?);`, [
      'deletion-first-1',
      'study_session_deleted',
      JSON.stringify({ sessionId }),
      '2026-08-10T10:00:00.000Z',
    ]);

    const deletedFirst = repository.adjustStudyTime({
      sessionDate: '2026-08-10', projectId: 20,
      previousDurationSeconds: 30 * 60, durationSeconds: 0, sessionSequence: 1, deleted: true,
    });
    expect(deletedFirst).toMatchObject({ minutes: 0, totalMinutes: 0 });

    const lateCompletion = repository.appendStudyTime({
      sessionId, sessionDate: '2026-08-10', projectId: 20,
      durationSeconds: 30 * 60, sessionSequence: 1,
    });
    expect(lateCompletion).toMatchObject({ skipped: true, reason: 'session_mutation_already_applied' });
    expect(Number(database.scalar('SELECT COUNT(*) FROM study_time_records;'))).toBe(0);
  });
});
