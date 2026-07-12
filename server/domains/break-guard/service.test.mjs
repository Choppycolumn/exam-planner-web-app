import { describe, expect, it, vi } from 'vitest';
import { createBreakGuardService } from './service.mjs';

function fixture() {
  const rows = new Map();
  const queued = [];
  const repository = {
    findEvent: vi.fn((eventId) => rows.get(eventId) || null),
    insertEvent: vi.fn((event, createdAt) => rows.set(event.eventId, { ...event, createdAt })),
    summaryByType: vi.fn(() => []),
    latestEvents: vi.fn(() => []),
    listActiveProjects: vi.fn(() => [{ id: 10, name: '高等数学', color: '#2563eb', sortOrder: 1 }]),
    getScheduleConfig: vi.fn(() => null),
    saveScheduleConfig: vi.fn((config) => config),
    appendStudyTime: vi.fn((input) => ({ ...input, projectName: '高等数学', minutes: 50 })),
  };
  const refreshStudySummariesForDate = vi.fn();
  const service = createBreakGuardService({
    token: 'test-token',
    safeSecretEqual: (left, right) => left === right,
    nowISO: () => '2026-07-10T04:00:00.000Z',
    todayISO: () => '2026-07-10',
    repository,
    tableChanged: vi.fn(),
    refreshStudySummariesForDate,
    queueProactiveNotification: (event) => { queued.push(event); return event; },
  });
  return { service, queued, repository, refreshStudySummariesForDate };
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

  it('accepts schedule progress alerts with structured lesson context', () => {
    const { service, queued } = fixture();
    const event = service.recordEvent({
      eventId: 'schedule_lag_20260712_1',
      eventType: 'schedule_lag',
      payload: { lessonNumber: 3, completedLessons: 2, dailyLessons: 8 },
    });
    expect(event.label).toBe('课表进度落后');
    const delivery = service.queueNotification(event);
    expect(delivery.content).toContain('2 / 8');
    expect(queued).toHaveLength(1);
  });

  it('writes completed classes into the matching study project once', () => {
    const { service, repository, refreshStudySummariesForDate } = fixture();
    const body = {
      eventId: 'class_completed_20260712_1',
      eventType: 'class_completed',
      payload: { lessonDate: '2026-07-12', projectId: 10, durationSeconds: 3000, lessonNumber: 1 },
    };
    const first = service.recordEvent(body);
    const second = service.recordEvent(body);
    expect(first.studyRecord.minutes).toBe(50);
    expect(second.duplicate).toBe(true);
    expect(repository.appendStudyTime).toHaveBeenCalledOnce();
    expect(refreshStudySummariesForDate).toHaveBeenCalledWith('2026-07-12');
  });
});
