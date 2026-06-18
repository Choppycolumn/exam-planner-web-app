import { describe, expect, it } from 'vitest';
import { peHistoryPercentile, scoreIndexPurchaseAssessment } from './index-assessment.mjs';

describe('index assessment', () => {
  it('calculates an empirical PE percentile', () => {
    const history = Array.from({ length: 61 }, (_, index) => ({ date: new Date(Date.UTC(2021 + Math.floor(index / 12), index % 12, 1)), pe: index + 10 }));
    expect(peHistoryPercentile(history, 40, 5)).toBeGreaterThan(45);
    expect(peHistoryPercentile(history, 40, 5)).toBeLessThan(55);
  });

  it('does not pause investing for a merely neutral valuation', () => {
    const result = scoreIndexPurchaseAssessment({ pePercentile5: 73.8, sma50Margin: 2.6, sma200Margin: 8.1 });
    expect(result.score).toBe(0);
    expect(result.signal).toContain('按计划定投');
  });
});
