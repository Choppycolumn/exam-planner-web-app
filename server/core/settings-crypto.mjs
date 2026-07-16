import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function deriveKey(secret) {
  return createHash('sha256').update(String(secret || '')).digest();
}

function decryptWithKey(parts, key) {
  const [, iv, tag, encrypted] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function createSettingsCrypto({ primarySecret, legacySecrets = [], onDecryptFailure = () => {} }) {
  if (!primarySecret) throw new Error('SETTINGS_ENCRYPTION_KEY is required');
  const primaryKey = deriveKey(primarySecret);
  const legacyKeys = legacySecrets
    .filter(Boolean)
    .map(deriveKey)
    .filter((key) => !key.equals(primaryKey));
  const reportedFailures = new Set();

  function encrypt(value = '') {
    if (!value) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', primaryKey, iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return ['v2', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  }

  function decrypt(value = '') {
    const text = String(value || '');
    if (!text) return { ok: true, value: '', needsMigration: false };
    const parts = text.split('.');
    if (!['v1', 'v2'].includes(parts[0]) || parts.length !== 4) {
      return { ok: false, value: '', needsMigration: false };
    }
    const keys = parts[0] === 'v2' ? [primaryKey] : [primaryKey, ...legacyKeys];
    for (const key of keys) {
      try {
        return {
          ok: true,
          value: decryptWithKey(parts, key),
          needsMigration: parts[0] !== 'v2' || !key.equals(primaryKey),
        };
      } catch {
        // Try the next compatible key.
      }
    }
    const fingerprint = createHash('sha256').update(text).digest('hex').slice(0, 16);
    if (!reportedFailures.has(fingerprint)) {
      reportedFailures.add(fingerprint);
      onDecryptFailure({ fingerprint });
    }
    return { ok: false, value: '', needsMigration: false };
  }

  return { encrypt, decrypt };
}
