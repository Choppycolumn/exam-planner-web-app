import { describe, expect, it, vi } from 'vitest';
import { createBreakGuardService } from './service.mjs';

function fixture() {
  const rows = new Map();
  const queued = [];
  const service = createBreakGuardService({
    token: 'test-token',
    safeSecretEqual: (left, right) => left === right,
    nowISO: () => '2026-07-10T04:00:00.000Z',
    todayISO: () => '2026-07-10',
    repository: {
      findEvent: vi.fn((eventId) => rows.get(eventId) || null),
      insertEvent: vi.fn((event, createdAt) => rows.set(event.eventId, {
        ...event,
        createdAt,
      })),
      summaryByType: vi.fn(() => []),
      latestEvents: vi.fn(() => []),
    },
    tableChanged: vi.fn(),
    queueProactiveNotification: (event) => { queued.push(event); return event; },
  });
  return { service, queued };
}

describe('break guard service', () => {
  it('uses constant-time token helper', () => {
    const { service } = fixture();
    expect(service.requireToken({ headers: { 'x-break-guard-token': 'test-token' } })).toEqual({ ok: true });
    expect(service.requireToken({ headers: { 'x-break-guard-token': 'bad' } }).status).toBe(401);
  });

  it('deduplicates retried event ids', () => {
    const { service, queued } = fixture();
    const body = { eventId: 'event_12345678', eventType: 'unfocused', overdueSeconds: 300 };
    const first = service.recordEvent(body);
    if (!first.duplicate) service.queueNotification(first);
    const second = service.recordEvent(body);
    if (!second.duplicate) service.queueNotification(second);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(queued).toHaveLength(1);
    expect(queued[0].eventKey).toContain('event_12345678');
  });
});
