import { describe, expect, it, vi } from 'vitest';
import { createSeatAssistantScheduler } from './seat-assistant-scheduler.mjs';

describe('seat assistant scheduler lifecycle', () => {
  it('starts once, runs one task, reschedules, and stops cleanly', async () => {
    vi.useFakeTimers();
    try {
      const refreshNow = vi.fn(async () => ({ session: { nextCheckAt: new Date(Date.now() + 240_000).toISOString() } }));
      const scheduler = createSeatAssistantScheduler({
        service: { refreshNow },
        featureEnabled: true,
        providerEnabled: () => true,
        now: () => new Date(),
        random: () => 0,
      });
      expect(scheduler.start()).toBe(true);
      expect(scheduler.start()).toBe(false);
      expect(scheduler.isRunning()).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshNow).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(239_999);
      expect(refreshNow).toHaveBeenCalledTimes(1);
      scheduler.stop();
      expect(scheduler.isRunning()).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(refreshNow).toHaveBeenCalledTimes(1);
      expect(scheduler.start()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a dynamic worker scheduler alive while provider/session is locally disabled', async () => {
    vi.useFakeTimers();
    try {
      const refreshNow = vi.fn(async () => ({ session: { nextCheckAt: null } }));
      const scheduler = createSeatAssistantScheduler({
        service: { refreshNow },
        featureEnabled: true,
        providerEnabled: () => false,
        now: () => new Date(),
        random: () => 0,
      });
      expect(scheduler.start()).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(refreshNow).toHaveBeenCalledTimes(1);
      expect(scheduler.isRunning()).toBe(true);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
