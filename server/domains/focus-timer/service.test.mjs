import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createSqliteRepository } from '../../modules/sqlite-repository.mjs';
import { createFocusTimerRepository } from '../../repositories/focus-timer-repository.mjs';
import { createFocusTimerService } from './service.mjs';

function operation(action, values = {}, suffix = action) {
  return {
    action,
    operationId: `operation_${suffix}_0001`,
    occurredAt: values.occurredAt,
    ...values,
  };
}

function fixture(initialNow = Date.parse('2026-07-24T02:00:00.000Z')) {
  const database = createSqliteRepository({ sqliteFile: ':memory:', dataDir: process.cwd() });
  database.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE user_accounts(
      id INTEGER PRIMARY KEY,
      account_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE study_projects(
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
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
      UNIQUE(date, project_id)
    );
    INSERT INTO user_accounts VALUES
      (1,'admin','我','',1,'now','now'),
      (2,'learner','学习伙伴','',1,'now','now'),
      (3,'learner','学习伙伴 2','',1,'now','now');
    INSERT INTO study_projects VALUES
      (101,1,'高等数学','#2563eb',1),
      (202,2,'英一','#16a34a',1),
      (303,3,'信号与系统','#f97316',1);
  `);
  database.run(readFileSync(new URL('../../migrations/027_focus_timer.sql', import.meta.url), 'utf8'));

  let clock = initialNow;
  const refreshStudySummariesForDate = [];
  const service = createFocusTimerService({
    repository: createFocusTimerRepository(database),
    now: () => clock,
    todayISO: () => '2026-07-24',
    tableChanged: () => {},
    refreshStudySummariesForDate: (date) => refreshStudySummariesForDate.push(date),
  });
  return {
    database,
    service,
    setNow(value) {
      clock = typeof value === 'number' ? value : Date.parse(value);
    },
    refreshStudySummariesForDate,
  };
}

describe('focus timer service', () => {
  it('keeps timer state, projects, sessions, and study records isolated per user', () => {
    const { database, service, setNow } = fixture();
    service.execute(2, operation('start_focus', {
      sessionId: 'session_user2_0001',
      projectId: 202,
      occurredAt: '2026-07-24T02:00:00.000Z',
    }, 'start_user2'));

    expect(service.getDashboard(2).state.projectName).toBe('英一');
    expect(service.getDashboard(3).state.mode).toBe('idle');
    expect(() => service.execute(3, operation('start_focus', {
      sessionId: 'session_user3_bad1',
      projectId: 202,
      occurredAt: '2026-07-24T02:00:00.000Z',
    }, 'wrong_project'))).toThrow('不属于当前用户');

    setNow('2026-07-24T02:40:00.000Z');
    service.execute(2, operation('complete_focus', {
      sessionId: 'session_user2_0001',
      occurredAt: '2026-07-24T02:40:00.000Z',
    }, 'complete_user2'));

    expect(database.json(`SELECT user_id AS userId,project_id AS projectId,minutes
FROM study_time_records ORDER BY user_id;`)).toEqual([
      { userId: 2, projectId: 202, minutes: 40 },
    ]);
    expect(service.getDashboard(3).sessions).toEqual([]);
    database.close();
  });

  it('deduplicates offline replay without adding study time twice', () => {
    const { database, service, setNow } = fixture();
    service.execute(2, operation('start_focus', {
      sessionId: 'session_replay_0001',
      projectId: 202,
      occurredAt: '2026-07-24T02:00:00.000Z',
    }, 'replay_start'));
    setNow('2026-07-24T02:25:00.000Z');
    const completed = operation('complete_focus', {
      sessionId: 'session_replay_0001',
      occurredAt: '2026-07-24T02:25:00.000Z',
    }, 'replay_finish');
    expect(service.execute(2, completed).duplicate).toBeUndefined();
    expect(service.execute(2, completed).duplicate).toBe(true);
    service.execute(2, operation('complete_focus', {
      sessionId: 'session_replay_0001',
      occurredAt: '2026-07-24T02:25:00.000Z',
    }, 'replay_finish_again'));

    expect(Number(database.scalar('SELECT minutes FROM study_time_records WHERE user_id = 2;'))).toBe(25);
    expect(Number(database.scalar('SELECT COUNT(*) FROM focus_timer_sessions WHERE user_id = 2;'))).toBe(1);
    database.close();
  });

  it('automatically ends expired focus and preserves Shanghai session date', () => {
    const { database, service, setNow } = fixture(Date.parse('2026-07-24T15:58:00.000Z'));
    service.execute(1, operation('save_settings', {
      focusMinutes: 5,
      breakMinutes: 10,
      occurredAt: '2026-07-24T15:58:00.000Z',
    }, 'settings_admin'));
    service.execute(1, operation('start_focus', {
      sessionId: 'session_midnight_01',
      projectId: 101,
      occurredAt: '2026-07-24T15:58:00.000Z',
    }, 'start_midnight'));
    setNow('2026-07-24T16:03:01.000Z');

    const dashboard = service.getDashboard(1);
    expect(dashboard.state.mode).toBe('break');
    expect(database.json(`SELECT session_date AS sessionDate,duration_seconds AS durationSeconds
FROM focus_timer_sessions WHERE user_id = 1;`)).toEqual([
      { sessionDate: '2026-07-24', durationSeconds: 300 },
    ]);
    database.close();
  });

  it('isolates segments and gives meal pauses no countdown', () => {
    const { service } = fixture();
    service.execute(2, operation('start_focus', {
      sessionId: 'session_segment_01',
      projectId: 202,
      occurredAt: '2026-07-24T02:00:00.000Z',
    }, 'segment_focus'));
    service.execute(2, operation('start_segment', {
      segmentId: 'segment_user2_0001',
      occurredAt: '2026-07-24T02:05:00.000Z',
    }, 'segment_start'));
    expect(service.getDashboard(2).state.segments).toHaveLength(1);
    expect(service.getDashboard(3).state.segments).toHaveLength(0);

    service.execute(3, operation('start_meal', {
      mealType: 'dinner',
      sessionId: 'meal_user3_000001',
      occurredAt: '2026-07-24T10:00:00.000Z',
    }, 'meal_user3'));
    const meal = service.getDashboard(3).state;
    expect(meal.mode).toBe('meal');
    expect(meal.pauseLabel).toBe('晚饭');
    expect(meal.targetSeconds).toBe(0);
    expect(meal.expired).toBe(false);
  });
});
