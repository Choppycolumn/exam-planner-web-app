import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createStudyComparisonService } from './service.mjs';

function addDaysISO(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

describe('study comparison service', () => {
  it('aggregates each account independently', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE user_accounts(id INTEGER PRIMARY KEY,account_type TEXT,display_name TEXT,is_active INTEGER);
      CREATE TABLE study_time_records(id INTEGER PRIMARY KEY,user_id INTEGER,date TEXT,minutes INTEGER);
      INSERT INTO user_accounts VALUES(1,'admin','我',1),(2,'learner','学习伙伴',1),(3,'learner','学习伙伴 2',1);
      INSERT INTO study_time_records VALUES
        (1,1,'2026-07-13',60),(2,1,'2026-07-12',30),(3,2,'2026-07-13',45),(4,2,'2026-07-12',15),
        (5,3,'2026-07-13',35),(6,3,'2026-07-11',25);
    `);
    const database = {
      json: (sql, parameters = []) => sqlite.prepare(sql).all(...parameters),
      scalar: (sql, parameters = []) => Object.values(sqlite.prepare(sql).get(...parameters) || {})[0] ?? '',
    };
    const service = createStudyComparisonService({
      database,
      todayISO: () => '2026-07-13',
      addDaysISO,
      nowISO: () => '2026-07-13T12:00:00.000Z',
    });
    const result = service.getComparison({ days: 7 });

    expect(result.accounts).toEqual([
      expect.objectContaining({ userId: 1, todayMinutes: 60, totalMinutes: 90, streakDays: 2 }),
      expect.objectContaining({ userId: 2, todayMinutes: 45, totalMinutes: 60, streakDays: 2 }),
      expect.objectContaining({ userId: 3, todayMinutes: 35, totalMinutes: 60, streakDays: 1 }),
    ]);
    expect(result.maxUsers).toBe(3);
    expect(result.daily.at(-1).users).toEqual({ 1: 60, 2: 45, 3: 35 });
    sqlite.close();
  });
});
