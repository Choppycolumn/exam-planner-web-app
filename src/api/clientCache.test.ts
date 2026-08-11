import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearApiResponseCache, serverApi } from './client';

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  clearApiResponseCache();
  vi.unstubAllGlobals();
});

describe('API response cache', () => {
  it('shares concurrent reads and honors explicit invalidation', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ brief: null, latest: null }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([serverApi.getTodayBrief(), serverApi.getTodayBrief()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearApiResponseCache();
    await serverApi.getTodayBrief();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache failed reads', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ brief: null, latest: null }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(serverApi.getTodayBrief()).rejects.toThrow();
    await expect(serverApi.getTodayBrief()).resolves.toMatchObject({ brief: null });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
