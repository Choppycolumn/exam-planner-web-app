import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createSeatAssistantSessionStore, decryptCookieBundle, deriveSeatAssistantCookieKey, encryptCookieBundle, validateCookieBundle } from './seat-assistant-session-store.mjs';

const nowValue = new Date('2026-08-21T12:00:00.000Z');
const cookie = { name: 'PHPSESSID', value: 'fixture-cookie-value', domain: 'libresource.hust.edu.cn', path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true };

function fakeRepository({ code = 'a'.repeat(24), expiresAt = '2026-08-21T12:10:00.000Z' } = {}) {
  let active = null;
  let consumed = false;
  return {
    consumePairing: vi.fn((input) => {
      if (consumed || input.pairingId !== 1 || input.codeHash !== createHash('sha256').update(code).digest('hex') || expiresAt <= input.createdAt) return null;
      consumed = true;
      active = { id: 9, pairingId: input.pairingId, status: 'active', origin: input.origin, cookieDomain: input.cookieDomain, cookieCount: input.cookieCount, cookieExpiresAt: input.cookieExpiresAt, localExpiresAt: input.localExpiresAt, bundleVersion: input.version, bundleNonce: input.nonce, bundleTag: input.tag, bundleCiphertext: input.ciphertext, lastUsedAt: null };
      return active;
    }),
    getActiveSeatSession: vi.fn(() => active),
    touchSeatSession: vi.fn((id, timestamp) => { if (active?.id === id) active.lastUsedAt = timestamp; }),
    deleteSeatSession: vi.fn((id) => { if (active?.id === id) { active = null; return true; } return false; }),
    revokeOtherSessions: vi.fn(),
  };
}

describe('seat assistant cookie encryption', () => {
  it('uses AES-256-GCM without plaintext ciphertext', () => {
    const key = deriveSeatAssistantCookieKey('fixture-cookie-secret-012345678901234567890123');
    const encrypted = encryptCookieBundle({ cookies: [cookie] }, { key });
    expect(encrypted.ciphertext).not.toContain(cookie.value);
    expect(decryptCookieBundle(encrypted, { key })).toHaveLength(1);
    expect(() => decryptCookieBundle(encrypted, { key: deriveSeatAssistantCookieKey('wrong-cookie-secret-012345678901234567890123') })).toThrow();
  });

  it('rejects forbidden names, wrong domains and expired cookies', () => {
    expect(() => validateCookieBundle([{ ...cookie, name: 'access_token' }], { now: nowValue.getTime() })).toThrow();
    expect(() => validateCookieBundle([{ ...cookie, domain: 'example.com' }], { now: nowValue.getTime() })).toThrow();
    expect(() => validateCookieBundle([{ ...cookie, expirationDate: nowValue.getTime() / 1000 - 1 }], { now: nowValue.getTime() })).toThrow();
  });
});

describe('seat assistant session pairing', () => {
  it('consumes once and builds a Cookie header only for the exact HUST origin', () => {
    const repository = fakeRepository();
    const store = createSeatAssistantSessionStore({ repository, cookieSecret: 'fixture-cookie-secret-012345678901234567890123', configuredOrigin: 'https://planner.example', now: () => nowValue });
    const result = store.completePairing({ pairingId: 1, code: 'a'.repeat(24), origin: 'https://planner.example', cookies: [cookie] });
    expect(result).toMatchObject({ sessionId: 9, cookieDomain: 'libresource.hust.edu.cn', cookieCount: 1 });
    expect(repository.consumePairing).toHaveBeenCalledTimes(1);
    expect(repository.consumePairing.mock.calls[0][0].ciphertext).not.toContain(cookie.value);
    expect(store.getCookieHeader('https://libresource.hust.edu.cn/http/80/133/9/114/202/yitlink/api.php/check')).toBe('PHPSESSID=fixture-cookie-value');
    expect(store.getCookieHeader('https://evil.example/anything')).toBe('');
    expect(() => store.completePairing({ pairingId: 1, code: 'a'.repeat(24), origin: 'https://planner.example', cookies: [cookie] })).toThrow('Pairing failed');
  });
});
