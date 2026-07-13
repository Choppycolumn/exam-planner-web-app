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
  cleanups.push(() => { database.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return database;
}

describe('two-user account repository', () => {
  it('hashes passwords with a unique salt and verifies them', () => {
    const first = hashPassword('learner-secret');
    const second = hashPassword('learner-secret');
    expect(first).not.toBe(second);
    expect(first).not.toContain('learner-secret');
    expect(verifyPassword('learner-secret', first)).toBe(true);
    expect(verifyPassword('wrong-secret', first)).toBe(false);
  });

  it('creates exactly one learner, clones projects and stores only a hash', () => {
    const database = fixture();
    const repository = createUserAccountRepository(database, { maxUsers: 2 });
    const account = repository.createLearner('learner-secret');

    expect(account).toMatchObject({ userId: 2, accountType: 'learner', displayName: '学习伙伴' });
    expect(repository.authenticateLearner('learner-secret')).toMatchObject({ userId: 2 });
    expect(repository.authenticateLearner('wrong-secret')).toBeNull();
    expect(repository.canCreateLearner()).toBe(false);
    expect(database.json('SELECT name,user_id AS userId FROM study_projects ORDER BY id;')).toEqual([
      expect.objectContaining({ name: '高等数学', userId: 1 }),
      expect.objectContaining({ name: '高等数学', userId: 2 }),
    ]);
    const storedHash = database.scalar('SELECT password_hash FROM user_accounts WHERE id = 2;');
    expect(storedHash).not.toBe('learner-secret');
    expect(storedHash.startsWith('scrypt$')).toBe(true);
    expect(() => repository.createLearner('another-secret')).toThrow('用户数量已达到上限');
  });
});
