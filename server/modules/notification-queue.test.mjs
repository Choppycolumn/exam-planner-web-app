import { describe, expect, it, vi } from 'vitest';
import { createNotificationQueue } from './notification-queue.mjs';

function fakeRepository(delivery) {
  return {
    upsertEvent: vi.fn(() => ({ id: 7 })),
    enqueueDelivery: vi.fn(() => ({ id: 11, status: 'queued' })),
    claimDueDeliveries: vi.fn(() => delivery ? [delivery] : []),
    markDeliverySending: vi.fn(),
    markDeliveryAccepted: vi.fn(),
    markDeliveryFailed: vi.fn(),
  };
}

describe('notification queue', () => {
  it('marks a successful proactive delivery as accepted by the channel', async () => {
    const repository = fakeRepository({
      id: 11,
      eventId: 7,
      attemptCount: 0,
      maxAttempts: 4,
      payload: { text: 'hello' },
    });
    const queue = createNotificationQueue({
      repository,
      sendProactive: vi.fn(async () => ({ ok: true, method: 'test' })),
      notifyEvent: vi.fn(),
    });

    await queue.processDue();

    expect(repository.markDeliveryAccepted).toHaveBeenCalledWith(11, expect.objectContaining({
      response: expect.objectContaining({ request: { text: 'hello' } }),
    }));
  });

  it('retries before creating an in-app fallback', async () => {
    const repository = fakeRepository({
      id: 11,
      eventId: 7,
      attemptCount: 0,
      maxAttempts: 2,
      payload: { text: 'hello' },
    });
    const notifyEvent = vi.fn();
    const queue = createNotificationQueue({
      repository,
      sendProactive: vi.fn(async () => ({ ok: false, error: 'offline' })),
      notifyEvent,
      retryDelaysMs: [1_000],
      now: () => new Date('2026-06-07T00:00:00.000Z'),
    });

    await queue.processDue();

    expect(repository.markDeliveryFailed).toHaveBeenCalledWith(11, expect.objectContaining({
      retrying: true,
      nextAttemptAt: '2026-06-07T00:00:01.000Z',
    }));
    expect(notifyEvent).not.toHaveBeenCalled();
  });

  it('creates an in-app fallback after the final attempt', async () => {
    const repository = fakeRepository({
      id: 11,
      eventId: 7,
      attemptCount: 1,
      maxAttempts: 2,
      payload: { text: 'hello' },
    });
    const notifyEvent = vi.fn();
    const queue = createNotificationQueue({
      repository,
      sendProactive: vi.fn(async () => ({ ok: false, error: 'offline' })),
      notifyEvent,
    });

    await queue.processDue();

    expect(repository.markDeliveryFailed).toHaveBeenCalledWith(11, expect.objectContaining({ retrying: false }));
    expect(notifyEvent).toHaveBeenCalledWith(expect.objectContaining({
      source: 'notification',
      severity: 'warning',
    }));
  });
});
