import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createStudyPetRepository } from './study-pet-repository.mjs';
import { sqlString, sqlValue } from './sqlite-repository.mjs';

function testRepository() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/019_study_pet.sql', import.meta.url), 'utf8'));
  const db = {
    sqlString,
    sqlValue,
    transaction(statements) {
      sqlite.exec(`BEGIN IMMEDIATE;\n${statements.join('\n')}\nCOMMIT;`);
    },
    json(sql) {
      return sqlite.prepare(sql).all();
    },
  };
  return { sqlite, repository: createStudyPetRepository(db) };
}

const report = {
  date: '2026-06-18',
  timezone: 'Asia/Shanghai',
  deviceId: 'windows-main',
  totalComputerSeconds: 18000,
  studySeconds: 7200,
  entertainmentSeconds: 3600,
  toolSeconds: 2400,
  socialSeconds: 900,
  unknownSeconds: 3900,
  sites: [
    { domain: 'https://www.bilibili.com/video/1', category: 'entertainment', seconds: 1200, visits: 3 },
  ],
  entertainmentOvertimeCount: 2,
  strongReminderCount: 2,
  studyGoal: { targetStudySeconds: 10800, completed: false },
};

describe('study pet repository', () => {
  it('saves and reads a daily report', () => {
    const { repository } = testRepository();
    repository.saveDailyReport({ ...report, timezone: 'Asia/Tokyo' });
    const today = repository.getTodayReport('2026-06-18');
    expect(today.report?.deviceId).toBe('windows-main');
    expect(today.report?.studySeconds).toBe(7200);
    expect(today.report?.timezone).toBe('Asia/Shanghai');
    expect(today.report?.timezone).toBe('Asia/Shanghai');
    expect(today.sites).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: 'bilibili.com', seconds: 1200, visits: 3 }),
    ]));
  });

  it('always stores Asia/Shanghai regardless of client timezone', () => {
    const { repository } = testRepository();
    repository.saveDailyReport({ ...report, timezone: 'Asia/Tokyo' });
    expect(repository.getTodayReport('2026-06-18').report?.timezone).toBe('Asia/Shanghai');
  });

  it('overwrites the same date and replaces stale site rows', () => {
    const { repository } = testRepository();
    repository.saveDailyReport(report);
    repository.saveDailyReport({
      ...report,
      studySeconds: 9000,
      sites: [{ domain: 'github.com', category: 'study', seconds: 1800, visits: 4 }],
    });
    const today = repository.getTodayReport('2026-06-18');
    expect(today.report?.studySeconds).toBe(9000);
    expect(today.sites).toHaveLength(1);
    expect(today.sites[0]).toEqual(expect.objectContaining({ domain: 'github.com', category: 'study' }));
  });

  it('returns date-range totals and ranked site usage', () => {
    const { repository } = testRepository();
    repository.saveDailyReport(report);
    repository.saveDailyReport({
      ...report,
      date: '2026-06-17',
      sites: [{ domain: 'bilibili.com', category: 'entertainment', seconds: 600, visits: 1 }],
    });
    expect(repository.getStats('2026-06-17', '2026-06-18')).toHaveLength(2);
    expect(repository.getSiteUsage('2026-06-17', '2026-06-18')[0]).toEqual(
      expect.objectContaining({ domain: 'bilibili.com', seconds: 1800, visits: 4 }),
    );
  });
});
