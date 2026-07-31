import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createSessionAuth, lockMessage } from './session-auth.mjs';
import { createSqliteRepository } from '../modules/sqlite-repository.mjs';
import { createSessionRepository } from './session-repository.mjs';

function withAuth(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'exam-auth-test-'));
  const database = createSqliteRepository({ sqliteFile: join(dir, 'sessions.sqlite'), dataDir: dir });
  database.run(`CREATE TABLE user_accounts(
id INTEGER PRIMARY KEY,public_id TEXT,display_name TEXT,status TEXT,session_version INTEGER,role TEXT
);
CREATE TABLE user_capabilities(user_id INTEGER,capability TEXT,enabled INTEGER);
CREATE TABLE user_sessions(
id INTEGER PRIMARY KEY AUTOINCREMENT,token_hash TEXT UNIQUE,user_id INTEGER,role TEXT,account_type TEXT,
display_name_snapshot TEXT,session_version INTEGER,created_at TEXT,last_seen_at TEXT,expires_at TEXT,revoked_at TEXT,client_hash TEXT
);
INSERT INTO user_accounts VALUES
(1,'owner-public-id','我','active',1,'owner'),
(2,'member-public-id','学习伙伴','active',1,'member');
INSERT INTO user_capabilities VALUES(1,'study.use',1),(1,'users.manage',1),(2,'study.use',1);`);
  const sessionRepository = createSessionRepository(database);
  const auth = createSessionAuth({
    appPassword: 'write-pass',
    readOnlyPassword: 'read-pass',
    cookieSecret: 'test-secret',
    cookieName: 'exam_planner_session',
    sessionRepository,
    loginAttemptsFile: join(dir, 'attempts.json'),
    loginFailureLimit: 2,
    loginLockMs: 60_000,
    loginFailureDelayMinMs: 1,
    loginFailureDelaySpreadMs: 0,
    ownerUserId: () => 1,
    ...options,
  });
  return { auth, cleanup: () => { database.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe('session auth service', () => {
  it('creates readable write and read sessions', () => {
    const { auth, cleanup } = withAuth();
    try {
      const writeCookie = `exam_planner_session=${auth.createSessionValue('write')}`;
      const readCookie = `exam_planner_session=${auth.createSessionValue('read')}`;

      expect(auth.getSessionRole(writeCookie)).toBe('write');
      expect(auth.getSessionRole(readCookie)).toBe('read');
      expect(auth.isValidSession(writeCookie)).toBe(true);
      expect(auth.revokeSession(writeCookie)).toBe(true);
      expect(auth.isValidSession(writeCookie)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('preserves the learner identity in a signed session', () => {
    const { auth, cleanup } = withAuth();
    try {
      const value = auth.createSessionValue({ role: 'write', userId: 2, accountType: 'learner', displayName: '学习伙伴' });
      expect(auth.getSession(`exam_planner_session=${value}`)).toEqual(expect.objectContaining({
        role: 'write', userId: 2, accountType: 'learner', displayName: '学习伙伴',
      }));
    } finally {
      cleanup();
    }
  });

  it('returns null when not locked and a remainingMs object when locked', () => {
    const { auth, cleanup } = withAuth();
    try {
      expect(auth.getLoginLock('127.0.0.1')).toBeNull();
      auth.recordLoginFailure('127.0.0.1');
      const attempt = auth.recordLoginFailure('127.0.0.1');
      const lock = auth.getLoginLock('127.0.0.1');

      expect(attempt.lockedUntil).toBeGreaterThan(Date.now());
      expect(lock).toEqual(expect.objectContaining({ remainingMs: expect.any(Number) }));
      expect(lockMessage(lock.remainingMs)).toContain('临时锁定');
    } finally {
      cleanup();
    }
  });
});
