import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

export const SEAT_ASSISTANT_RESOURCE_HOST = 'libresource.hust.edu.cn';
export const SEAT_ASSISTANT_RESOURCE_ORIGIN = `https://${SEAT_ASSISTANT_RESOURCE_HOST}`;
export const SEAT_ASSISTANT_SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const SEAT_ASSISTANT_PAIRING_MAX_BODY_BYTES = 64 * 1024;
export const SEAT_ASSISTANT_COOKIE_MAX_COUNT = 64;
export const SEAT_ASSISTANT_COOKIE_MAX_VALUE_LENGTH = 4096;

const COOKIE_BUNDLE_AAD_PREFIX = 'exam-planner:seat-assistant:cookie-bundle:v1';
const ALLOWED_SAME_SITE = new Set(['unspecified', 'lax', 'strict', 'no_restriction']);
const FORBIDDEN_COOKIE_NAMES = /^(?:access[_-]?token|userid|user[_-]?id)$/i;

function invalidPayload() {
  const error = new Error('Invalid pairing payload');
  error.code = 'invalid_pairing_payload';
  error.statusCode = 400;
  return error;
}

function asBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidPayload();
  return Buffer.from(value, 'base64url');
}

function parseCookieExpiry(value) {
  if (value === null || value === undefined || value === '') return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 9_999_999_999) throw invalidPayload();
  return new Date(seconds * 1000).toISOString();
}

function normalizeCookie(raw, nowMs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalidPayload();
  const name = String(raw.name || '');
  const value = String(raw.value ?? '');
  const domain = String(raw.domain || '').trim().toLowerCase().replace(/^\.+/, '');
  const path = String(raw.path || '/');
  const sameSite = String(raw.sameSite || 'unspecified').toLowerCase();
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,128}$/.test(name)) throw invalidPayload();
  if (FORBIDDEN_COOKIE_NAMES.test(name)) throw invalidPayload();
  if (value.length > SEAT_ASSISTANT_COOKIE_MAX_VALUE_LENGTH || /[\r\n;]/.test(value)) throw invalidPayload();
  if (domain !== SEAT_ASSISTANT_RESOURCE_HOST || !/^\/[\x21-\x7e]{0,1023}$/.test(path)) throw invalidPayload();
  if (raw.secure !== true || !ALLOWED_SAME_SITE.has(sameSite)) throw invalidPayload();
  const expiry = parseCookieExpiry(raw.expirationDate);
  if (expiry && Date.parse(expiry) <= nowMs) throw invalidPayload();
  return {
    name,
    value,
    domain,
    path,
    secure: true,
    httpOnly: Boolean(raw.httpOnly),
    sameSite,
    expiry,
    session: Boolean(raw.session) || !expiry,
  };
}

export function normalizeExamPlannerOrigin(value, { configuredOrigin = '' } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw invalidPayload();
  }
  const origin = parsed.origin;
  const localAllowed = parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1';
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.hostname === 'localhost' || parsed.hostname === '::1' || parsed.hostname === '0.0.0.0' || (parsed.protocol === 'http:' && !localAllowed)) {
    throw invalidPayload();
  }
  if (configuredOrigin && origin !== normalizeConfiguredOrigin(configuredOrigin)) throw invalidPayload();
  return origin;
}

function normalizeConfiguredOrigin(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) throw new Error('invalid');
    return parsed.origin;
  } catch {
    throw invalidPayload();
  }
}

export function validateCookieBundle(rawCookies, { now = Date.now() } = {}) {
  if (!Array.isArray(rawCookies) || !rawCookies.length || rawCookies.length > SEAT_ASSISTANT_COOKIE_MAX_COUNT) throw invalidPayload();
  const normalized = rawCookies.map((cookie) => normalizeCookie(cookie, Number(now)));
  const seen = new Set();
  for (const cookie of normalized) {
    if (seen.has(cookie.name)) throw invalidPayload();
    seen.add(cookie.name);
  }
  const expiryValues = normalized.map((cookie) => cookie.expiry).filter(Boolean).map((value) => Date.parse(value));
  return {
    cookies: normalized,
    cookieExpiresAt: expiryValues.length ? new Date(Math.min(...expiryValues)).toISOString() : null,
  };
}

export function deriveSeatAssistantCookieKey(cookieSecret) {
  const secret = Buffer.from(String(cookieSecret || ''), 'utf8');
  if (secret.length < 32) throw new Error('COOKIE_SECRET must be at least 32 bytes for seat assistant session encryption');
  return Buffer.from(hkdfSync('sha256', secret, Buffer.from('exam-planner-seat-assistant-salt-v1'), Buffer.from('cookie-bundle-encryption'), 32));
}

export function encryptCookieBundle(bundle, { cookieSecret, key, aad = COOKIE_BUNDLE_AAD_PREFIX } = {}) {
  const encryptionKey = key || deriveSeatAssistantCookieKey(cookieSecret);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
  cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(bundle), 'utf8'), cipher.final()]);
  return {
    nonce: asBase64Url(nonce),
    tag: asBase64Url(cipher.getAuthTag()),
    ciphertext: asBase64Url(ciphertext),
    version: 1,
  };
}

export function decryptCookieBundle(encrypted, { cookieSecret, key, aad = COOKIE_BUNDLE_AAD_PREFIX, now = Date.now() } = {}) {
  if (!encrypted || Number(encrypted.version || 1) !== 1) throw new Error('Invalid cookie bundle');
  const encryptionKey = key || deriveSeatAssistantCookieKey(cookieSecret);
  const nonce = fromBase64Url(encrypted.nonce);
  const tag = fromBase64Url(encrypted.tag);
  const ciphertext = fromBase64Url(encrypted.ciphertext);
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length > SEAT_ASSISTANT_COOKIE_MAX_COUNT * (SEAT_ASSISTANT_COOKIE_MAX_VALUE_LENGTH + 256)) throw new Error('Invalid cookie bundle');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, nonce);
  decipher.setAAD(Buffer.from(String(aad), 'utf8'));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const bundle = JSON.parse(plaintext);
  const validated = validateCookieBundle(bundle?.cookies, { now });
  return validated.cookies;
}

function cookieHeaderForCookies(cookies, url, nowMs) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== SEAT_ASSISTANT_RESOURCE_HOST) return '';
  const eligible = cookies.filter((cookie) => {
    if (cookie.secure !== true || cookie.domain !== SEAT_ASSISTANT_RESOURCE_HOST) return false;
    if (!parsed.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`) && parsed.pathname !== cookie.path) return false;
    return !cookie.expiry || Date.parse(cookie.expiry) > nowMs;
  }).sort((left, right) => right.path.length - left.path.length);
  const seen = new Set();
  return eligible.filter((cookie) => {
    if (seen.has(cookie.name)) return false;
    seen.add(cookie.name);
    return true;
  }).map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

export function createSeatAssistantSessionStore({ repository, cookieSecret, configuredOrigin = '', now = () => new Date() } = {}) {
  if (!repository) throw new Error('seat assistant repository is required');
  const key = deriveSeatAssistantCookieKey(cookieSecret);

  function localExpiry(cookieExpiresAt, timestamp) {
    const localMax = new Date(timestamp.getTime() + SEAT_ASSISTANT_SESSION_MAX_AGE_MS).getTime();
    const cookieMax = cookieExpiresAt ? Date.parse(cookieExpiresAt) : Number.POSITIVE_INFINITY;
    return new Date(Math.min(localMax, cookieMax)).toISOString();
  }

  function completePairing({ pairingId, code, origin, cookies }) {
    const timestamp = now();
    if (!String(configuredOrigin || '').trim()) throw invalidPayload();
    const normalizedOrigin = normalizeExamPlannerOrigin(origin, { configuredOrigin });
    const validated = validateCookieBundle(cookies, { now: timestamp.getTime() });
    const localExpiresAt = localExpiry(validated.cookieExpiresAt, timestamp);
    const encrypted = encryptCookieBundle({ cookies: validated.cookies }, {
      key,
      aad: `${COOKIE_BUNDLE_AAD_PREFIX}|${normalizedOrigin}|${SEAT_ASSISTANT_RESOURCE_HOST}`,
    });
    const numericPairingId = Number(pairingId);
    const pairingCode = String(code || '');
    if (!Number.isSafeInteger(numericPairingId) || numericPairingId <= 0 || pairingCode.length < 16 || pairingCode.length > 128 || !/^[A-Za-z0-9_-]+$/.test(pairingCode)) throw invalidPayload();
    const result = repository.consumePairing({
      pairingId: numericPairingId,
      codeHash: createHash('sha256').update(pairingCode).digest('hex'),
      origin: normalizedOrigin,
      cookieDomain: SEAT_ASSISTANT_RESOURCE_HOST,
      cookieCount: validated.cookies.length,
      cookieExpiresAt: validated.cookieExpiresAt,
      localExpiresAt,
      nonce: encrypted.nonce,
      tag: encrypted.tag,
      ciphertext: encrypted.ciphertext,
      version: encrypted.version,
      createdAt: timestamp.toISOString(),
    });
    if (!result?.id) throw Object.assign(new Error('Pairing failed'), { code: 'pairing_failed', statusCode: 400 });
    repository.revokeOtherSessions(Number(result.id), timestamp.toISOString());
    return { sessionId: Number(result.id), origin: normalizedOrigin, cookieDomain: SEAT_ASSISTANT_RESOURCE_HOST, cookieCount: validated.cookies.length, expiresAt: localExpiresAt };
  }

  function activeSession() {
    const row = repository.getActiveSeatSession?.();
    if (!row) return null;
    const expiresAt = Date.parse(row.localExpiresAt || '');
    if (!Number.isFinite(expiresAt) || expiresAt <= now().getTime()) {
      repository.deleteSeatSession?.(Number(row.id));
      return null;
    }
    return row;
  }

  function getCookieHeader(url) {
    const row = activeSession();
    if (!row) return '';
    try {
      const cookies = decryptCookieBundle({ version: row.bundleVersion, nonce: row.bundleNonce, tag: row.bundleTag, ciphertext: row.bundleCiphertext }, {
        key,
        aad: `${COOKIE_BUNDLE_AAD_PREFIX}|${row.origin}|${row.cookieDomain}`,
        now: now().getTime(),
      });
      const header = cookieHeaderForCookies(cookies, url, now().getTime());
      if (!header) {
        repository.deleteSeatSession?.(Number(row.id));
        return '';
      }
      repository.touchSeatSession?.(Number(row.id), now().toISOString());
      return header;
    } catch {
      repository.deleteSeatSession?.(Number(row.id));
      return '';
    }
  }

  function revokeActiveSession() {
    const row = repository.getActiveSeatSession?.();
    if (!row) return false;
    repository.deleteSeatSession?.(Number(row.id));
    return true;
  }

  function revokeSession(id) {
    return Boolean(repository.deleteSeatSession?.(Number(id)));
  }

  function status() {
    const row = activeSession();
    return row ? {
      connected: true,
      sessionId: Number(row.id),
      origin: row.origin,
      cookieDomain: row.cookieDomain,
      cookieCount: Number(row.cookieCount || 0),
      cookieExpiresAt: row.cookieExpiresAt || null,
      expiresAt: row.localExpiresAt,
      lastUsedAt: row.lastUsedAt || null,
    } : { connected: false, sessionId: null, origin: null, cookieDomain: null, cookieCount: 0, cookieExpiresAt: null, expiresAt: null, lastUsedAt: null };
  }

  return {
    completePairing,
    getCookieHeader,
    hasActiveSession: () => Boolean(activeSession()),
    status,
    revokeActiveSession,
    revokeSession,
    revokeAllSessions: () => repository.deleteAllSeatSessions?.(),
  };
}
