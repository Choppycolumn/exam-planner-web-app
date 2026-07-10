import { describe, expect, it } from 'vitest';
import { classifyNotificationFailure, isWechatQuietHours, nextWechatActiveAt } from './notification-policy.mjs';

describe('notification degradation policy', () => {
  it('does not retry Weixin ret=-2 forever', () => {
    const result = classifyNotificationFailure('Weixin proactive send blocked (ret=-2)');
    expect(result.retryable).toBe(false);
    expect(result.action).toContain('Bark');
  });

  it('retries transient network failures', () => {
    expect(classifyNotificationFailure('fetch failed').retryable).toBe(true);
  });

  it('suppresses default WeChat delivery only from 03:00 through 06:59 China time', () => {
    expect(isWechatQuietHours(new Date('2026-07-09T19:00:00.000Z'))).toBe(true);
    expect(isWechatQuietHours(new Date('2026-07-09T22:59:00.000Z'))).toBe(true);
    expect(isWechatQuietHours(new Date('2026-07-09T23:00:00.000Z'))).toBe(false);
    expect(nextWechatActiveAt(new Date('2026-07-09T20:00:00.000Z'))).toBe('2026-07-09T23:00:00.000Z');
  });
});
