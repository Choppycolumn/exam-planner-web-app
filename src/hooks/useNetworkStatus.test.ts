import { afterEach, describe, expect, it, vi } from 'vitest';

import { probeServerHealth } from './useNetworkStatus';

describe('probeServerHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the application server as reachable only after a successful health response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeServerHealth()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/health', expect.objectContaining({
      cache: 'no-store',
      credentials: 'same-origin',
    }));
  });

  it('reports connection failures without throwing into the page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network unavailable')));

    await expect(probeServerHealth()).resolves.toBe(false);
  });
});
