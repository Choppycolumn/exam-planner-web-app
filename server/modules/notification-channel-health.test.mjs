import { describe, expect, it } from 'vitest';
import { createNotificationChannelHealth } from './notification-channel-health.mjs';

function memoryRepository() {
  const rows = new Map();
  return {
    getChannelHealth: (key) => rows.get(key) || null,
    saveChannelHealth: (row) => rows.set(row.channelKey, { ...row }),
    listChannelHealth: () => [...rows.values()],
    channelDeliveryMetrics: () => [],
  };
}

describe('notification channel health', () => {
  it('opens a circuit after consecutive retryable failures and resets on success', () => {
    const repository = memoryRepository();
    const clock = new Date('2026-07-16T00:00:00.000Z');
    const health = createNotificationChannelHealth({
      repository,
      now: () => clock,
      failureThreshold: 2,
    });

    expect(health.recordFailure('telegram_default', { retryable: true, status: 'degraded' }, 'fetch failed').circuitOpenUntil).toBeNull();
    expect(health.recordFailure('telegram_default', { retryable: true, status: 'degraded' }, 'fetch failed').circuitOpenUntil).toBeTruthy();
    expect(health.beforeSend('telegram_default').allowed).toBe(false);

    health.recordSuccess('telegram_default');
    expect(health.beforeSend('telegram_default').allowed).toBe(true);
    expect(health.snapshot([{ channelKey: 'telegram_default', type: 'telegram', name: 'Telegram', enabled: true }])[0]).toMatchObject({
      status: 'normal',
      consecutiveFailures: 0,
      circuitOpen: false,
    });
  });
});
