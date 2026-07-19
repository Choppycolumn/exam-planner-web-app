import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteRepository } from '../modules/sqlite-repository.mjs';
import { hashPassword, verifyPassword } from './password-hash.mjs';
import { createUserAccountRepository } from './user-account-repository.mjs';

const cleanups = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'exam-users-'));
  const database = createSqliteRepository({ sqliteFile: join(dataDir, 'test.sqlite'), dataDir });
  database.run(`
    CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
    CREATE TABLE study_projects(id INTEGER PRIMARY KEY,name TEXT,color TEXT,is_active INTEGER,sort_order INTEGER,schema_version INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE study_time_records(id INTEGER PRIMARY KEY,date TEXT,project_id INTEGER,project_name_snapshot TEXT,minutes INTEGER,note TEXT,schema_version INTEGER,created_at TEXT,updated_at TEXT,UNIQUE(date,project_id));
    INSERT INTO study_projects VALUES(1,'高等数学','#2563eb',1,1,1,'now','now');
  `);
  database.run(readFileSync(new URL('../migrations/023_two_user_learning.sql', import.meta.url), 'utf8'));
  database.run(readFileSync(new URL('../migrations/026_three_user_accounts.sql', import.meta.url), 'utf8'));
  cleanups.push(() => { database.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return database;
}

describe('multi-user account repository', () => {
  it('hashes passwords with a unique salt and verifies them', () => {
    const first = hashPassword('learner-secret');
    const second = hashPassword('learner-secret');
    expect(first).not.toBe(second);
    expect(first).not.toContain('learner-secret');
    expect(verifyPassword('learner-secret', first)).toBe(true);
    expect(verifyPassword('wrong-secret', first)).toBe(false);
  });

  it('creates two isolated learners, authenticates each password and enforces the three-user limit', () => {
    const database = fixture();
    const repository = createUserAccountRepository(database, { maxUsers: 3 });
    const firstAccount = repository.createLearner('learner-secret');

    expect(firstAccount).toMatchObject({ userId: 2, accountType: 'learner', displayName: '学习伙伴' });
    expect(repository.authenticateLearner('learner-secret')).toMatchObject({ userId: 2 });
    expect(repository.authenticateLearner('wrong-secret')).toBeNull();
    expect(repository.canCreateLearner()).toBe(true);
    expect(() => repository.createLearner('learner-secret')).toThrow('该密码已被其他学习用户使用');

    const secondAccount = repository.createLearner('another-secret');
    expect(secondAccount).toMatchObject({ userId: 3, accountType: 'learner', displayName: '学习伙伴 2' });
    expect(repository.authenticateLearner('another-secret')).toMatchObject({ userId: 3 });
    expect(repository.canCreateLearner()).toBe(false);
    expect(database.json('SELECT name,user_id AS userId FROM study_projects ORDER BY id;')).toEqual([
      expect.objectContaining({ name: '高等数学', userId: 1 }),
      expect.objectContaining({ name: '高等数学', userId: 2 }),
      expect.objectContaining({ name: '高等数学', userId: 3 }),
    ]);
    const storedHashes = database.json('SELECT id,password_hash AS passwordHash FROM user_accounts WHERE account_type = ? ORDER BY id;', ['learner']);
    expect(storedHashes).toHaveLength(2);
    expect(storedHashes.every((row) => row.passwordHash.startsWith('scrypt$'))).toBe(true);
    expect(storedHashes.some((row) => row.passwordHash.includes('secret'))).toBe(false);
    expect(database.json('SELECT user_id AS userId FROM user_study_settings ORDER BY user_id;')).toEqual([
      { userId: 1 }, { userId: 2 }, { userId: 3 },
    ]);
    expect(() => repository.createLearner('fourth-secret')).toThrow('用户数量已达到上限');
  });
});
