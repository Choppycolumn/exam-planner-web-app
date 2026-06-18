import { describe, expect, it } from 'vitest';
import { summarizeHealth } from './health-status.mjs';

describe('unified health status', () => {
  it('returns the worst state and only actionable issues', () => {
    const result = summarizeHealth([
      { id: 'web', status: 'normal', title: 'Web' },
      { id: 'proxy', status: 'degraded', title: 'Proxy', action: 'Update subscription' },
    ]);
    expect(result.status).toBe('degraded');
    expect(result.actions).toHaveLength(1);
  });
});
