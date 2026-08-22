import { describe, expect, it } from 'vitest';
import { classifyNotificationFailure } from './notification-policy.mjs';

describe('notification degradation policy', () => {
  it('retries transient network failures', () => {
    expect(classifyNotificationFailure('fetch failed').retryable).toBe(true);
  });
});
