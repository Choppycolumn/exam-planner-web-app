import { describe, expect, it } from 'vitest';
import { classifyNotificationFailure } from './notification-policy.mjs';

describe('notification degradation policy', () => {
  it('does not retry Weixin ret=-2 forever', () => {
    const result = classifyNotificationFailure('Weixin proactive send blocked (ret=-2)');
    expect(result.retryable).toBe(false);
    expect(result.action).toContain('Bark');
  });

  it('retries transient network failures', () => {
    expect(classifyNotificationFailure('fetch failed').retryable).toBe(true);
  });
});
