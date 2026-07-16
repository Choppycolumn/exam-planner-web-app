import { describe, expect, it, vi } from 'vitest';
import { createSettingsCrypto } from './settings-crypto.mjs';

describe('settings crypto', () => {
  it('round trips with the stable primary key', () => {
    const crypto = createSettingsCrypto({ primarySecret: 'primary-secret-value' });
    const encrypted = crypto.encrypt('mail-password');
    expect(encrypted.startsWith('v2.')).toBe(true);
    expect(crypto.decrypt(encrypted)).toEqual({ ok: true, value: 'mail-password', needsMigration: false });
  });

  it('reads legacy ciphertext and marks it for migration', () => {
    const oldCrypto = createSettingsCrypto({ primarySecret: 'old-cookie-secret' });
    const legacyCiphertext = oldCrypto.encrypt('legacy-password').replace(/^v2\./, 'v1.');
    const crypto = createSettingsCrypto({
      primarySecret: 'new-stable-secret',
      legacySecrets: ['old-cookie-secret'],
    });
    expect(crypto.decrypt(legacyCiphertext)).toEqual({ ok: true, value: 'legacy-password', needsMigration: true });
  });

  it('deduplicates failures for an unrecoverable ciphertext', () => {
    const onDecryptFailure = vi.fn();
    const encrypted = createSettingsCrypto({ primarySecret: 'lost-secret' }).encrypt('password').replace(/^v2\./, 'v1.');
    const crypto = createSettingsCrypto({ primarySecret: 'current-secret', onDecryptFailure });
    expect(crypto.decrypt(encrypted).ok).toBe(false);
    expect(crypto.decrypt(encrypted).ok).toBe(false);
    expect(onDecryptFailure).toHaveBeenCalledOnce();
  });
});
