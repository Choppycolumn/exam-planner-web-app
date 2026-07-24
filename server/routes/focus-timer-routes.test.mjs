import { describe, expect, it, vi } from 'vitest';
import { handleFocusTimerRoutes } from './focus-timer-routes.mjs';

describe('focus timer routes', () => {
  it('always scopes reads and writes to the authenticated user', async () => {
    const getDashboard = vi.fn(() => ({ state: { mode: 'idle' } }));
    const execute = vi.fn(() => ({ ok: true }));
    const responses = [];
    const dependencies = {
      session: { userId: 3 },
      sendJson: (_res, body, status = 200) => responses.push({ body, status }),
      readJsonBody: async () => ({ action: 'end_day', operationId: 'operation_route_001' }),
      focusTimerService: { getDashboard, execute },
    };

    expect(await handleFocusTimerRoutes(
      { method: 'GET', url: '/api/focus-timer' },
      {},
      dependencies,
    )).toBe(true);
    expect(await handleFocusTimerRoutes(
      { method: 'POST', url: '/api/focus-timer/action' },
      {},
      dependencies,
    )).toBe(true);
    expect(getDashboard).toHaveBeenCalledWith(3);
    expect(execute).toHaveBeenCalledWith(3, expect.objectContaining({ action: 'end_day' }));
    expect(responses).toHaveLength(2);
  });
});
