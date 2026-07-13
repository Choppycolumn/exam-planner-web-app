import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password) {
  const normalized = String(password || '');
  const salt = randomBytes(16);
  const derived = scryptSync(normalized, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(password, storedHash) {
  const [algorithm, saltText, hashText] = String(storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    const actual = scryptSync(String(password || ''), salt, expected.length || KEY_LENGTH);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
