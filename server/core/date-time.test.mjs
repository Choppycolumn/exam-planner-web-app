import { describe, expect, it } from 'vitest';
import { currentPeriod, previousPeriod } from './date-time.mjs';

describe('report period helpers', () => {
  it('returns the report field names used by report generation routes', () => {
    expect(currentPeriod('weekly', '2026-09-19')).toEqual({
      start: '2026-09-14',
      end: '2026-09-20',
      periodStart: '2026-09-14',
      periodEnd: '2026-09-20',
    });
    expect(previousPeriod('weekly', '2026-09-19')).toEqual({
      start: '2026-09-07',
      end: '2026-09-13',
      periodStart: '2026-09-07',
      periodEnd: '2026-09-13',
    });
  });

  it('accepts the monthly report kind used by the application', () => {
    expect(currentPeriod('monthly', '2026-09-19')).toMatchObject({
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
    expect(previousPeriod('monthly', '2026-09-19')).toMatchObject({
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
    });
  });
});
