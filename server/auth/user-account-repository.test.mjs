import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteRepository } from '../modules/sqlite-repository.mjs';
import { hashPassword, verifyPassword } from './password-hash.mjs';
import { createUserAccountRepository } from './user-account-repository.mjs';
import { createSessionRepository } from './session-repository.mjs';

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
    CREATE TABLE confusing_words_backup(id INTEGER PRIMARY KEY,schema_version INTEGER,exported_at TEXT,backed_up_at TEXT,payload_json TEXT);
    CREATE TABLE confusing_words_backup_versions(id INTEGER PRIMARY KEY,schema_version INTEGER,exported_at TEXT,backed_up_at TEXT,payload_json TEXT,source TEXT,group_count INTEGER,word_count INTEGER,payload_hash TEXT,created_at TEXT);
    CREATE TABLE user_confusing_words_backup(user_id INTEGER PRIMARY KEY,schema_version INTEGER,exported_at TEXT,backed_up_at TEXT,payload_json TEXT);
    CREATE TABLE user_confusing_words_backup_versions(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,schema_version INTEGER,exported_at TEXT,backed_up_at TEXT,payload_json TEXT,source TEXT,group_count INTEGER,word_count INTEGER,payload_hash TEXT,created_at TEXT);
    INSERT INTO study_projects VALUES(1,'高等数学','#2563eb',1,1,1,'now','now');
  `);
  database.run(readFileSync(new URL('../migrations/023_two_user_learning.sql', import.meta.url), 'utf8'));
  database.run(readFileSync(new URL('../migrations/026_three_user_accounts.sql', import.meta.url), 'utf8'));
  database.run(readFileSync(new URL('../migrations/027_focus_timer.sql', import.meta.url), 'utf8'));
  database.run(readFileSync(new URL('../migrations/028_formal_multi_user.sql', import.meta.url), 'utf8'));
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

  it('creates isolated members, authenticates selected accounts and enforces a configurable limit', () => {
    const database = fixture();
    const repository = createUserAccountRepository(database, { maxUsers: 4 });
    repository.ensureAdminCredential('admin-secret');
    const firstAccount = repository.createLearner('learner-secret');

    expect(firstAccount).toMatchObject({ userId: 2, accountType: 'learner', displayName: '学习伙伴' });
    expect(repository.authenticateAccount(firstAccount.publicId, 'learner-secret')).toMatchObject({ userId: 2, userRole: 'member' });
    expect(repository.authenticateLearner('wrong-secret')).toBeNull();
    expect(repository.canCreateLearner()).toBe(true);
    expect(() => repository.createLearner('learner-secret')).toThrow('该密码已被其他账户使用');

    const secondAccount = repository.createLearner('another-secret');
    expect(secondAccount).toMatchObject({ userId: 3, accountType: 'learner', displayName: '学习伙伴 2' });
    expect(repository.authenticateLearner('another-secret')).toMatchObject({ userId: 3 });
    expect(repository.canCreateLearner()).toBe(true);
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
    const invite = repository.createInvite({ createdByUserId: 1, displayName: '受邀成员', expiresInHours: 1 });
    const invited = repository.consumeInvite({ token: invite.token, password: 'third-secret' });
    expect(invited).toMatchObject({ userId: 4, displayName: '受邀成员', userRole: 'member' });
    expect(repository.canCreateLearner()).toBe(false);
    expect(() => repository.consumeInvite({ token: invite.token, password: 'fourth-secret' })).toThrow('邀请码无效或已过期');
    expect(() => repository.createLearner('fourth-secret')).toThrow('用户数量已达到上限');
  });

  it('revokes active sessions when an account is disabled or its password changes', () => {
    const database = fixture();
    const accounts = createUserAccountRepository(database, { maxUsers: 4 });
    const sessions = createSessionRepository(database);
    accounts.ensureAdminCredential('admin-secret');
    const member = accounts.createLearner('member-secret');

    const firstToken = sessions.create(member);
    expect(sessions.find(firstToken)).toMatchObject({ userId: member.userId });
    accounts.updateAccount(member.userId, { status: 'disabled' });
    expect(sessions.find(firstToken)).toBeNull();

    accounts.updateAccount(member.userId, { status: 'active' });
    const current = accounts.authenticateAccount(member.publicId, 'member-secret');
    const secondToken = sessions.create(current);
    expect(sessions.find(secondToken)).toMatchObject({ userId: member.userId });
    accounts.resetPassword(member.userId, 'member-secret-updated');
    expect(sessions.find(secondToken)).toBeNull();
    expect(accounts.authenticateAccount(member.publicId, 'member-secret')).toBeNull();
    expect(accounts.authenticateAccount(member.publicId, 'member-secret-updated')).toMatchObject({ userId: member.userId });
  });
});
