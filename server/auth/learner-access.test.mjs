import { describe, expect, it } from 'vitest';
import { learnerCanAccess } from './learner-access.mjs';

describe('learner API boundary', () => {
  it('allows learning records and comparison but blocks notifications and operations', () => {
    expect(learnerCanAccess('GET', '/api/projects')).toBe(true);
    expect(learnerCanAccess('POST', '/api/study-records/save-day')).toBe(true);
    expect(learnerCanAccess('GET', '/api/study-comparison')).toBe(true);
    expect(learnerCanAccess('GET', '/api/notifications/center')).toBe(false);
    expect(learnerCanAccess('POST', '/api/notifications/telegram/test')).toBe(false);
    expect(learnerCanAccess('GET', '/api/operations')).toBe(false);
    expect(learnerCanAccess('GET', '/api/break-guard/config')).toBe(false);
  });
});
