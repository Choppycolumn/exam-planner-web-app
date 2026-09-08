import { describe, expect, it, vi } from 'vitest';
import { createSeatAssistantService } from './seat-assistant-service.mjs';

function fixture({ now = '2026-08-22T10:00:00.000Z', providerQuery, session = {} } = {}) {
  let currentTime = new Date(now);
  let currentSession = {
    status: 'disconnected', providerName: 'hust_yitlink_readonly', message: '', lastCheckedAt: null, lastAttemptAt: null,
    lastSuccessAt: null, nextCheckAt: null, consecutiveFailures: 0, lastNotifiedStatus: '', updatedAt: null, ...session,
  };
  let notificationState = { stateKey: '', episodeKey: '', startedAt: null, notifyCount: 0, lastNotifiedAt: null };
  const observations = [];
  const audit = [];
  const notifications = [];
  const profile = {
    id: 1, enabled: true, venue: 'main', dateMode: 'tomorrow', startTime: '08:30', endTime: '22:00', areaPreference: [],
    seatPreference: ['17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28'], pollIntervalSeconds: 240, jitterSeconds: 0, nearIntervalSeconds: 60,
  };
  const repository = {
    getProfile: () => profile,
    saveProfile: vi.fn(() => profile),
    getSessionStatus: () => ({ ...currentSession }),
    saveSessionStatus: vi.fn((value) => { currentSession = { ...currentSession, ...value, updatedAt: currentTime.toISOString() }; return { ...currentSession }; }),
    claimQuerySlot: vi.fn((attemptAt, cutoffAt) => {
      const previous = Date.parse(currentSession.lastAttemptAt || currentSession.lastCheckedAt || '');
      if (Number.isFinite(previous) && previous > Date.parse(cutoffAt)) return false;
      currentSession = { ...currentSession, lastAttemptAt: attemptAt, lastCheckedAt: attemptAt };
      return true;
    }),
    insertObservation: vi.fn((value) => { const item = { id: observations.length + 1, ...value }; observations.push(item); return item; }),
    listObservations: (limit = 20) => observations.slice(-Number(limit)).reverse(),
    getNotificationState: () => ({ ...notificationState }),
    saveNotificationState: vi.fn((value) => { notificationState = { ...notificationState, ...value }; return { ...notificationState }; }),
    appendAudit: vi.fn((value) => audit.push(value)),
    listAudit: () => audit,
    listPairings: () => [],
    deleteHistory: () => ({ ok: true }),
    createPairing: () => ({ id: 1 }),
  };
  const provider = { name: 'hust_yitlink_readonly', enabled: true, canExecute: false, query: providerQuery || vi.fn(async () => ({ status: 'ok', totalSeats: 2, freeSeats: 2, availableSeats: ['017', '018'] })) };
  const service = createSeatAssistantService({ repository, provider, featureEnabled: true, minimumRequestIntervalSeconds: 60, now: () => currentTime, random: () => 0, queueProactiveNotification: (payload) => notifications.push(payload) });
  return {
    service, repository, provider, notifications,
    setNow: (value) => { currentTime = new Date(value); },
    profile,
    getSession: () => currentSession,
  };
}

describe('seat assistant service safety and notifications', () => {
  it('uses persisted attempt time for local throttling without writing remote rate_limited', async () => {
    const providerQuery = vi.fn();
    const fx = fixture({ now: '2026-08-22T10:00:30.000Z', providerQuery, session: { lastCheckedAt: '2026-08-22T10:00:00.000Z', lastAttemptAt: '2026-08-22T10:00:00.000Z' } });
    const result = await fx.service.refreshNow();
    expect(result.status).toBe('rate_limited_local');
    expect(providerQuery).not.toHaveBeenCalled();
    expect(fx.repository.saveSessionStatus).not.toHaveBeenCalled();
  });

  it('filters availability by the profile and uses unique notification event keys per episode/count', async () => {
    const providerQuery = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', totalSeats: 3, freeSeats: 3, availableSeats: ['017', '018', '099'] })
      .mockResolvedValueOnce({ status: 'ok', totalSeats: 2, freeSeats: 2, availableSeats: ['017', '018'] })
      .mockResolvedValueOnce({ status: 'ok', totalSeats: 1, freeSeats: 1, availableSeats: ['017'] })
      .mockResolvedValueOnce({ status: 'ok', totalSeats: 1, freeSeats: 1, availableSeats: ['017'] })
      .mockResolvedValueOnce({ status: 'ok', totalSeats: 1, freeSeats: 1, availableSeats: ['017'] })
      .mockResolvedValueOnce({ status: 'ok', totalSeats: 1, freeSeats: 1, availableSeats: ['017'] });
    const fx = fixture({ providerQuery });
    await fx.service.refreshNow();
    expect(fx.getSession().nextCheckAt).toContain('10:04:00');
    fx.setNow('2026-08-22T10:04:00.000Z'); await fx.service.refreshNow();
    expect(fx.notifications).toHaveLength(1);
    expect(fx.notifications[0].eventKey).toMatch(/:1$/);
    fx.setNow('2026-08-22T10:05:00.000Z'); await fx.service.refreshNow();
    fx.setNow('2026-08-22T10:06:00.000Z'); await fx.service.refreshNow();
    fx.setNow('2026-08-22T10:07:00.000Z'); const fourth = await fx.service.refreshNow();
    fx.setNow('2026-08-22T10:08:00.000Z'); await fx.service.refreshNow();
    expect(fx.notifications.filter((item) => item.source === 'seat_assistant')).toHaveLength(4);
    expect(new Set(fx.notifications.map((item) => item.eventKey)).size).toBe(4);
    expect(fourth.session.nextCheckAt).toContain('10:11:00');
  });

  it('pauses and warns on the third exception, including catch paths', async () => {
    const providerQuery = vi.fn(async () => { throw new Error('network failure'); });
    const fx = fixture({ providerQuery });
    const first = await fx.service.refreshNow();
    expect(new Date(first.session.nextCheckAt).getTime() - new Date('2026-08-22T10:00:00.000Z').getTime()).toBe(240_000);
    fx.setNow('2026-08-22T10:01:00.000Z'); await fx.service.refreshNow();
    expect(new Date(fx.getSession().nextCheckAt).getTime() - new Date('2026-08-22T10:01:00.000Z').getTime()).toBe(480_000);
    fx.setNow('2026-08-22T10:02:00.000Z'); const result = await fx.service.refreshNow();
    expect(result.status).toBe('paused');
    expect(fx.notifications).toHaveLength(1);
    expect(fx.notifications[0].severity).toBe('warning');
  });

  it('does not notify when the preferred range has no seats or more than two seats', async () => {
    const providerQuery = vi.fn()
      .mockResolvedValueOnce({ status: 'ok', totalSeats: 2, freeSeats: 2, availableSeats: ['016', '029'] })
      .mockResolvedValueOnce({ status: 'ok', totalSeats: 4, freeSeats: 4, availableSeats: ['017', '018', '019', '020'] });
    const fx = fixture({ providerQuery });
    await fx.service.refreshNow();
    expect(fx.notifications).toHaveLength(0);
    expect(fx.getSession().nextCheckAt).toContain('10:04:00');
    fx.setNow('2026-08-22T10:04:00.000Z');
    await fx.service.refreshNow();
    expect(fx.notifications).toHaveLength(0);
    expect(fx.getSession().nextCheckAt).toContain('10:08:00');
  });

  it.each([
    ['blocked', 'blocked'],
    ['rate_limited', 'rate_limited'],
    ['captcha_required', 'captcha_required'],
    ['login_required', 'login_required'],
  ])('persists and warns on a remote halt status (%s)', async (remoteStatus, expectedStatus) => {
    const fx = fixture({ providerQuery: vi.fn(async () => ({ status: remoteStatus, message: 'stop' })) });
    const result = await fx.service.refreshNow();
    expect(result.status).toBe(expectedStatus);
    expect(fx.getSession().status).toBe(expectedStatus);
    expect(fx.notifications).toHaveLength(1);
    expect(fx.notifications[0].eventKey).toMatch(/seat-assistant:status:/);
    await fx.service.refreshNow();
    expect(fx.notifications).toHaveLength(1);
    expect(fx.provider.query).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the persistent query claim cannot be written', async () => {
    const providerQuery = vi.fn();
    const fx = fixture({ providerQuery });
    fx.repository.claimQuerySlot.mockImplementation(() => { throw new Error('database is read-only'); });
    const result = await fx.service.refreshNow();
    expect(result.status).toBe('error');
    expect(providerQuery).not.toHaveBeenCalled();
  });

  it('preserves a halted reason after the provider revokes the session', async () => {
    const providerQuery = vi.fn();
    const fx = fixture({ providerQuery, session: { status: 'blocked', message: '风控已停止' } });
    fx.provider.enabled = false;
    const result = await fx.service.refreshNow();
    expect(result.status).toBe('blocked');
    expect(result.session.message).toBe('风控已停止');
    expect(providerQuery).not.toHaveBeenCalled();
    expect(fx.repository.saveSessionStatus).not.toHaveBeenCalled();
  });

  it('turns an expired connected session into one login-expired alert, while an unpaired session stays quiet', async () => {
    const connected = fixture({ session: { status: 'connected', message: 'previously healthy' } });
    connected.provider.enabled = false;
    const expired = await connected.service.refreshNow();
    expect(expired.status).toBe('login_required');
    expect(connected.notifications).toHaveLength(1);
    await connected.service.refreshNow();
    expect(connected.notifications).toHaveLength(1);

    const unpaired = fixture();
    unpaired.provider.enabled = false;
    const missing = await unpaired.service.refreshNow();
    expect(missing.status).toBe('disconnected');
    expect(unpaired.notifications).toHaveLength(0);
  });

  it('writes an explicit disconnected state for a manual session revoke', () => {
    const fx = fixture({ session: { status: 'connected' } });
    const session = fx.service.sessionRevoked('owner');
    expect(session.status).toBe('disconnected');
    expect(session.message).toContain('已断开');
  });

  it('clears all local history as a full session reset', () => {
    const fx = fixture({ session: { status: 'connected' } });
    const result = fx.service.deleteHistory();
    expect(result.ok).toBe(true);
    expect(result.session.status).toBe('disconnected');
    expect(result.session.message).toContain('重新配对');
  });
});
