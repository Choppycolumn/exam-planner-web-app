import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createSessionAuth, lockMessage } from './session-auth.mjs';

function withAuth(options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'exam-auth-test-'));
  const auth = createSessionAuth({
    appPassword: 'write-pass',
    readOnlyPassword: 'read-pass',
    cookieSecret: 'test-secret',
    cookieName: 'exam_planner_session',
    loginAttemptsFile: join(dir, 'attempts.json'),
    loginFailureLimit: 2,
    loginLockMs: 60_000,
    loginFailureDelayMinMs: 1,
    loginFailureDelaySpreadMs: 0,
    ...options,
  });
  return { auth, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
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
