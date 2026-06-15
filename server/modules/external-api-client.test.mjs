import { describe, expect, it, vi } from 'vitest';
import { createExternalApiClient } from './external-api-client.mjs';

describe('external API client', () => {
  it('uses fresh cache and stale fallback without hiding its age', async () => {
    let now = 0;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ value: 1 }) })
      .mockRejectedValue(new Error('fetch failed'));
    const client = createExternalApiClient({ fetchImpl, now: () => now });
    expect((await client.json('https://example.test', { freshMs: 100, staleMs: 1000 })).cacheStatus).toBe('network');
    now = 50;
    expect((await client.json('https://example.test', { freshMs: 100, staleMs: 1000 })).cacheStatus).toBe('fresh');
    now = 200;
    expect((await client.json('https://example.test', { freshMs: 100, staleMs: 1000, retries: 0 })).cacheStatus).toBe('stale-fallback');
  });
});
