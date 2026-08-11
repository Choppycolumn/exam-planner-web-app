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
    adjustStudyTime: vi.fn((input) => ({ ...input, projectName: '高等数学', minutes: 30, deltaMinutes: -20 })),
  };
  const refreshStudySummariesForDate = vi.fn();
  const cancelScheduleLagNotifications = vi.fn();
  const service = createBreakGuardService({
    token: 'test-token',
    safeSecretEqual: (left, right) => left === right,
    nowISO: () => '2026-07-10T04:00:00.000Z',
    todayISO: () => '2026-07-10',
    repository,
    tableChanged: vi.fn(),
    refreshStudySummariesForDate,
    queueProactiveNotification: (event) => { queued.push(event); return event; },
    cancelScheduleLagNotifications,
  });
  return { service, queued, repository, refreshStudySummariesForDate, cancelScheduleLagNotifications };
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

  it('accepts study progress alerts with structured time context', () => {
    const { service, queued } = fixture();
    const event = service.recordEvent({
      eventId: 'schedule_lag_20260712_1',
      eventType: 'schedule_lag',
      payload: { projectId: 10, studyMinutes: 120, targetMinutes: 400 },
    });
    expect(event.label).toBe('学习进度落后');
    const delivery = service.queueNotification(event);
    expect(delivery.content).toContain('120 / 400 分钟');
    expect(queued).toHaveLength(1);
  });

  it('suppresses progress alerts left over from a previous study day', () => {
    const { service, queued } = fixture();
    const event = service.recordEvent({
      eventId: 'schedule_lag_stale_day',
      eventType: 'schedule_lag',
      payload: {
        sessionDate: '2026-07-09',
        projectId: 10,
        studyMinutes: 120,
        targetMinutes: 400,
      },
    });

    expect(service.queueNotification(event)).toMatchObject({
      status: 'suppressed',
      reason: 'stale_study_day',
    });
    expect(queued).toHaveLength(0);
  });

  it('suppresses schedule progress alerts while a meal pause is active', () => {
    const { service, queued, repository, cancelScheduleLagNotifications } = fixture();
    service.recordEvent({ eventId: 'dinner_20260713', eventType: 'dinner' });
    expect(cancelScheduleLagNotifications).toHaveBeenCalledOnce();
    repository.latestEvents.mockReturnValue([
      { eventType: 'schedule_lag', createdAt: '2026-07-13T11:31:00.000Z' },
      { eventType: 'dinner', createdAt: '2026-07-13T11:30:00.000Z' },
      { eventType: 'class_started', createdAt: '2026-07-13T10:00:00.000Z' },
    ]);
    const event = service.recordEvent({
      eventId: 'schedule_lag_meal_pause',
      eventType: 'schedule_lag',
      payload: { projectId: 10, studyMinutes: 120, targetMinutes: 400 },
    });
    expect(service.queueNotification(event)).toMatchObject({ status: 'suppressed', reason: 'meal_pause' });
    expect(queued).toHaveLength(0);

    repository.latestEvents.mockReturnValue([
      { eventType: 'schedule_lag', createdAt: '2026-07-13T12:31:00.000Z' },
      { eventType: 'class_started', createdAt: '2026-07-13T12:00:00.000Z' },
      { eventType: 'dinner', createdAt: '2026-07-13T11:30:00.000Z' },
    ]);
    const resumed = service.recordEvent({
      eventId: 'schedule_lag_after_meal',
      eventType: 'schedule_lag',
      payload: { projectId: 10, studyMinutes: 180, targetMinutes: 400 },
    });
    expect(service.queueNotification(resumed).content).toContain('180 / 400 分钟');
    expect(queued).toHaveLength(1);
  });

  it('normalizes a time target and exposes active projects directly', () => {
    const { service } = fixture();
    const result = service.saveScheduleConfig({ dailyTargetMinutes: 360 });
    expect(result.config.dailyTargetMinutes).toBe(360);
    expect(result.config).toEqual({
      dailyTargetMinutes: 360,
      longStudyMinutes: 180,
      breakMinutes: 10,
      lagGraceMinutes: 20,
      lagRepeatMinutes: 30,
    });
  });

  it('writes completed classes into the matching study project once', () => {
    const { service, repository, refreshStudySummariesForDate } = fixture();
    const body = {
      eventId: 'class_completed_20260712_1',
      eventType: 'class_completed',
      payload: { sessionDate: '2026-07-12', projectId: 10, durationSeconds: 3000, sessionSequence: 1 },
    };
    const first = service.recordEvent(body);
    const second = service.recordEvent(body);
    expect(first.studyRecord.minutes).toBe(50);
    expect(second.duplicate).toBe(true);
    expect(repository.appendStudyTime).toHaveBeenCalledOnce();
    expect(refreshStudySummariesForDate).toHaveBeenCalledWith('2026-07-12');
  });

  it('accepts an end-of-day summary without creating another study record', () => {
    const { service, repository } = fixture();
    const event = service.recordEvent({
      eventId: 'study_day_completed_20260712',
      eventType: 'study_day_completed',
      payload: { sessionDate: '2026-07-12', sessionCount: 3, studySeconds: 7200, targetMinutes: 240 },
    });
    expect(event.label).toBe('结束一天学习');
    expect(repository.appendStudyTime).not.toHaveBeenCalled();
  });

  it('applies completed-session corrections once and refreshes the matching date', () => {
    const { service, repository, refreshStudySummariesForDate } = fixture();
    const body = {
      eventId: 'session_12345678_corrected_1',
      eventType: 'study_session_corrected',
      payload: {
        sessionDate: '2026-08-10', projectId: 10, sessionSequence: 2,
        previousDurationSeconds: 3000, durationSeconds: 1800,
      },
    };
    const first = service.recordEvent(body);
    const second = service.recordEvent(body);
    expect(first.studyRecord.deltaMinutes).toBe(-20);
    expect(second.duplicate).toBe(true);
    expect(repository.adjustStudyTime).toHaveBeenCalledOnce();
    expect(refreshStudySummariesForDate).toHaveBeenCalledWith('2026-08-10');
  });

  it('supports deleting a completed session without treating it as another completion', () => {
    const { service, repository } = fixture();
    const event = service.recordEvent({
      eventId: 'session_12345678_deleted_1',
      eventType: 'study_session_deleted',
      payload: { sessionDate: '2026-08-10', projectId: 10, previousDurationSeconds: 1800 },
    });
    expect(event.label).toBe('删除学习记录');
    expect(repository.adjustStudyTime).toHaveBeenCalledWith(expect.objectContaining({ deleted: true }));
    expect(repository.appendStudyTime).not.toHaveBeenCalled();
  });
});
