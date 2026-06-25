import { describe, expect, it } from 'vitest';
import { calculateDayOrderPlan, calculateLedger, marketSessionForDate, riskTagsForReport } from './market-copilot-calculations.mjs';

describe('market copilot ledger calculations', () => {
  it('uses moving weighted average and realizes pnl on partial sells', () => {
    const result = calculateLedger({
      transactions: [
        { id: 1, tradedAt: '2026-06-01T10:00:00Z', instrumentSymbol: 'rQQQ', action: '买入', price: 100, quantity: 1, feeAmount: 1, feeCurrency: 'USDT', confirmed: 1 },
        { id: 2, tradedAt: '2026-06-02T10:00:00Z', instrumentSymbol: 'rQQQ', action: '买入', price: 200, quantity: 1, feeAmount: 1, feeCurrency: 'USDT', confirmed: 1 },
        { id: 3, tradedAt: '2026-06-03T10:00:00Z', instrumentSymbol: 'rQQQ', action: '卖出', price: 180, quantity: 0.5, feeAmount: 0.5, feeCurrency: 'USDT', confirmed: 1 },
      ],
      prices: { rQQQ: 190 },
      quoteCurrencies: { rQQQ: 'USDT' },
    });
    const pos = result.positions.find((item) => item.symbol === 'rQQQ');
    expect(pos.averageCost).toBeCloseTo(151, 6);
    expect(pos.realizedPnl).toBeCloseTo(14, 6);
    expect(pos.unrealizedPnl).toBeCloseTo(58.5, 6);
    expect(pos.cumulativeFees.USDT).toBeCloseTo(2.5, 6);
  });

  it('tracks fees in different currency without pretending quote conversion', () => {
    const result = calculateLedger({
      transactions: [
        { id: 1, tradedAt: '2026-06-01T10:00:00Z', instrumentSymbol: 'rQQQ', action: '买入', price: 100, quantity: 1, feeAmount: 0.01, feeCurrency: 'BNB', confirmed: 1 },
      ],
      prices: { rQQQ: 100 },
      quoteCurrencies: { rQQQ: 'USDT' },
    });
    const pos = result.positions.find((item) => item.symbol === 'rQQQ');
    expect(pos.averageCost).toBeCloseTo(100, 6);
    expect(pos.cumulativeFees.BNB).toBeCloseTo(0.01, 6);
  });

  it('excludes locked positions from qqq ammo', () => {
    const result = calculateLedger({
      cashBalances: [{ currency: 'USDT', amount: 150, lockedAmount: 25 }],
      lockedPositions: [{ instrumentSymbol: 'USDGO', quantity: 110, referencePrice: 1, includeInAmmo: 0 }],
    });
    expect(result.freeUsdt).toBe(125);
    expect(result.lockedValueUsdt).toBe(110);
    expect(result.qqqAmmoUsdt).toBe(125);
  });
});

describe('market copilot day order plan', () => {
  it('calculates fees, quantities, and budget overflow', () => {
    const plan = calculateDayOrderPlan({
      availableUsdt: 100,
      feeRate: 0.001,
      legs: [
        { limitPrice: 10, amountUsdt: 50 },
        { limitPrice: 9, amountUsdt: 60 },
      ],
    });
    expect(plan.legs[0].expectedFee).toBeCloseTo(0.05, 6);
    expect(plan.legs[0].expectedQuantity).toBeCloseTo(4.995, 6);
    expect(plan.totalAmount).toBe(110);
    expect(plan.exceedsAvailable).toBe(true);
  });
});

describe('market copilot market calendar and tags', () => {
  it('recognizes regular days, weekends, holidays, and half days', () => {
    expect(marketSessionForDate('2026-06-22').sessionType).toBe('regular');
    expect(marketSessionForDate('2026-06-21').sessionType).toBe('weekend');
    expect(marketSessionForDate('2026-07-03').sessionType).toBe('holiday');
    expect(marketSessionForDate('2026-11-27').sessionType).toBe('half_day');
  });

  it('adds transparent risk tags for stale data and day orders', () => {
    const tags = riskTagsForReport({
      snapshots: [{ delayStatus: 'stale', observedAt: '2026-06-01T00:00:00Z' }],
      macroEvents: [{ name: 'CPI' }],
      orderPlans: [{ status: 'active' }],
      session: { sessionType: 'regular' },
    });
    expect(tags).toContain('DATA_STALE');
    expect(tags).toContain('EVENT_RISK');
    expect(tags).toContain('DAY_ORDER_EXPIRY');
    expect(tags).toContain('LOCKED_FUNDS_EXCLUDED');
  });
});
