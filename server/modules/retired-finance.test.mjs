import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const serverSource = readFileSync(new URL('../auth-static-server.mjs', import.meta.url), 'utf8');

describe('retired finance module', () => {
  it('does not expose finance routes or exchange credentials', () => {
    for (const retired of [
      '/api/finance-',
      'BINANCE_API_KEY',
      'BITGET_API_KEY',
      'EXCHANGE_API_PROXY_URL',
      'finance_vaults',
    ]) {
      expect(serverSource).not.toContain(retired);
    }
  });
});
