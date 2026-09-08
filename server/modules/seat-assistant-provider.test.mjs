import { describe, expect, it, vi } from 'vitest';
import { createHustYitlinkReadonlyProvider, createSeatAssistantProvider, HUST_YITLINK_API_BASE } from './seat-assistant-provider.mjs';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name === 'content-type' ? 'application/json' : null },
    text: async () => JSON.stringify(payload),
  };
}

const profile = { startTime: '08:30', endTime: '22:00' };

describe('seat assistant HUST provider', () => {
  it('only issues the audited GET requests and has no executable path', async () => {
    const calls = [];
    const fetchFn = vi.fn(async (url, options) => {
      calls.push({ url, options });
      if (String(url).includes('/v3areadays/101')) return response({ status: 1, data: { list: [{ id: 77, area: '101', day: '2026-08-23', startTime: '08:00', endTime: '23:00' }] } });
      return response({ status: 1, data: { list: [{ no: '017', status: 1, status_name: '空闲' }, { no: '99', status: 1, status_name: '空闲' }] } });
    });
    const provider = createHustYitlinkReadonlyProvider({
      fetchFn,
      sessionStore: { getCookieHeader: () => 'sid=redacted', hasActiveSession: () => true },
      now: () => new Date('2026-08-22T10:00:00.000Z'),
    });
    const result = await provider.query({ profile, targetDate: '2026-08-23' });
    expect(result).toMatchObject({ status: 'ok', availableSeats: ['017', '99'], freeSeats: 2 });
    expect(provider.canExecute).toBe(false);
    expect('execute' in provider).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls.every(({ options }) => options.method === 'GET')).toBe(true);
    expect(calls[0].url).toBe(`${HUST_YITLINK_API_BASE}/v3areadays/101`);
    expect(new URL(calls[1].url).pathname).toBe(`${new URL(HUST_YITLINK_API_BASE).pathname}/spaces_old`);
    expect([...new URL(calls[1].url).searchParams.keys()].sort()).toEqual(['area', 'day', 'endTime', 'segment', 'startTime']);
  });

  it('rejects any non-audited area and maps 403 to a stopped provider state', async () => {
    expect(() => createHustYitlinkReadonlyProvider({ areaId: '102', fetchFn: vi.fn() })).toThrow(/101/);
    const revokeActiveSession = vi.fn();
    const provider = createHustYitlinkReadonlyProvider({
      fetchFn: vi.fn(async () => response({ status: 0, msg: 'blocked by risk control' }, 403)),
      sessionStore: { getCookieHeader: () => 'sid=value', hasActiveSession: () => true, revokeActiveSession },
    });
    await expect(provider.query({ profile, targetDate: '2026-08-23' })).resolves.toMatchObject({ status: 'blocked' });
    expect(revokeActiveSession).toHaveBeenCalled();
  });

  it.each([
    [401, { status: 0, msg: 'login required' }, 'login_required'],
    [429, { status: 0, msg: '请求过于频繁' }, 'rate_limited'],
    [200, { status: 0, msg: '请完成验证码验证' }, 'captcha_required'],
    [200, { status: 0, msg: 'risk control blocked' }, 'blocked'],
  ])('stops on remote status %s (%s)', async (httpStatus, payload, expectedStatus) => {
    const revokeActiveSession = vi.fn();
    const provider = createHustYitlinkReadonlyProvider({
      fetchFn: vi.fn(async () => response(payload, httpStatus)),
      sessionStore: { getCookieHeader: () => 'sid=value', hasActiveSession: () => true, revokeActiveSession },
    });
    await expect(provider.query({ profile, targetDate: '2026-08-23' })).resolves.toMatchObject({ status: expectedStatus });
    expect(revokeActiveSession).toHaveBeenCalled();
  });

  it('fails closed when either audited response changes shape', async () => {
    const missingSegments = createHustYitlinkReadonlyProvider({
      fetchFn: vi.fn(async () => response({ status: 1, data: {} })),
      sessionStore: { getCookieHeader: () => 'sid=value', hasActiveSession: () => true },
    });
    await expect(missingSegments.query({ profile, targetDate: '2026-08-23' })).resolves.toMatchObject({ status: 'error' });

    const malformedSegment = createHustYitlinkReadonlyProvider({
      fetchFn: vi.fn(async () => response({ status: 1, data: { list: [{ id: 77, area: '101', day: '2026-08-23' }] } })),
      sessionStore: { getCookieHeader: () => 'sid=value', hasActiveSession: () => true },
    });
    await expect(malformedSegment.query({ profile, targetDate: '2026-08-23' })).resolves.toMatchObject({ status: 'error' });

    let callCount = 0;
    const malformedSeats = createHustYitlinkReadonlyProvider({
      fetchFn: vi.fn(async (url) => {
        callCount += 1;
        if (callCount === 1) return response({ status: 1, data: { list: [{ id: 77, area: '101', day: '2026-08-23', startTime: '08:00', endTime: '23:00' }] } });
        return response({ status: 1, data: { list: [{ no: '', status: 'free' }] } });
      }),
      sessionStore: { getCookieHeader: () => 'sid=value', hasActiveSession: () => true },
    });
    await expect(malformedSeats.query({ profile, targetDate: '2026-08-23' })).resolves.toMatchObject({ status: 'error' });
  });

  it('propagates an Abort timeout instead of retrying or following a redirect', async () => {
    const fetchFn = vi.fn((_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const provider = createHustYitlinkReadonlyProvider({
      fetchFn,
      timeoutMs: 1_000,
      sessionStore: { getCookieHeader: () => 'sid=value', hasActiveSession: () => true },
    });
    await expect(provider.query({ profile, targetDate: '2026-08-23' })).rejects.toThrow('aborted');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  }, 3_000);

  it('does not construct an executable fake or unreviewed provider', () => {
    const disabled = createSeatAssistantProvider({ mode: 'fake' });
    expect(disabled.canExecute).toBe(false);
    expect('execute' in disabled).toBe(false);
  });
});
