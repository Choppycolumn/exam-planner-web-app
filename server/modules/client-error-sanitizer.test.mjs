import { describe, expect, it } from 'vitest';
import { redactClientText, sanitizeClientErrorPayload, sanitizeClientPath } from './client-error-sanitizer.mjs';

describe('client error sanitizer', () => {
  it('redacts common secrets from client text', () => {
    const text = 'token=abc123 password: letmein Authorization: Bearer xyz exam_planner_session=sensitive;';
    const redacted = redactClientText(text);
    expect(redacted).not.toContain('abc123');
    expect(redacted).not.toContain('letmein');
    expect(redacted).not.toContain('xyz');
    expect(redacted).not.toContain('sensitive');
    expect(redacted).toContain('[redacted]');
  });

  it('removes query strings from paths', () => {
    expect(sanitizeClientPath('/settings?token=abc#top')).toBe('/settings#hash');
    expect(sanitizeClientPath('https://example.com/a/b?password=x')).toBe('/a/b');
  });

  it('normalizes payload fields and caps unsafe values', () => {
    const payload = sanitizeClientErrorPayload({
      source: 'window-error',
      path: '/x?secret=1',
      message: 'failed with api_key=123',
      stack: 'stack token=abc',
    }, { userAgent: 'browser token=hidden', createdAt: '2026-07-09T00:00:00.000Z' });
    expect(payload.source).toBe('window-error');
    expect(payload.path).toBe('/x');
    expect(payload.message).not.toContain('123');
    expect(payload.stack).not.toContain('abc');
    expect(payload.userAgent).not.toContain('hidden');
    expect(payload.createdAt).toBe('2026-07-09T00:00:00.000Z');
  });
});
