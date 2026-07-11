import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSchedulerRegistry } from './scheduler-registry.mjs';

afterEach(() => vi.useRealTimers());

describe('scheduler registry', () => {
  it('replaces duplicate jobs and exposes one authoritative schedule', async () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const second = vi.fn();
    const scheduler = createSchedulerRegistry({ now: () => Date.now() });
    scheduler.scheduleOnce('brief', 1000, first);
    scheduler.scheduleOnce('brief', 2000, second);
    expect(scheduler.snapshot()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    expect(scheduler.snapshot()).toHaveLength(0);
  });

  it('serializes interval executions and stops every registered job', async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => {});
    const scheduler = createSchedulerRegistry({ now: () => Date.now() });
    scheduler.scheduleInterval('queue', 1000, task, { initialDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(2100);
    expect(task).toHaveBeenCalledTimes(3);
    expect(scheduler.snapshot()[0].nextRunAt).toBeTruthy();
    scheduler.stopAll();
    expect(scheduler.snapshot()).toEqual([]);
  });
});
