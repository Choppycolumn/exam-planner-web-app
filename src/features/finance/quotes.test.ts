import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinanceAsset, FinanceExchangeRate, FinanceQuote } from '../../types/finance';
import { createEmptyFinanceData } from './storage';
import { manualAssetQuote, manualExchangeRate, updatePublicFinanceQuotes } from './quotes';

const timestamp = '2026-05-28T00:00:00.000Z';

function asset(input: Partial<FinanceAsset> & Pick<FinanceAsset, 'id' | 'name' | 'assetType' | 'currency'>): FinanceAsset {
  return {
    symbol: input.id,
    groupId: 'other',
    riskBucket: 'low_volatility',
    marketExposure: 'Other',
    quoteProvider: 'manual',
    status: 'active',
    continueInvesting: false,
    tags: [],
    currentAmount: null,
    totalCost: null,
    units: null,
    latestPrice: null,
    priceDate: '2026-05-27',
    dataSource: 'test',
    isManualData: true,
    costStatus: 'complete',
    notes: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...input,
  };
}

function quote(input: Partial<FinanceQuote> & Pick<FinanceQuote, 'targetId' | 'price' | 'currency' | 'priceDate'>): FinanceQuote {
  return {
    id: `quote-${input.targetId}`,
    targetType: 'asset',
    fetchedAt: timestamp,
    source: 'test',
    provider: 'manual',
    isManual: true,
    failed: false,
    ...input,
  };
}

function rate(input: Partial<FinanceExchangeRate> & Pick<FinanceExchangeRate, 'pair' | 'rate' | 'asOfDate'>): FinanceExchangeRate {
  return {
    source: 'test',
    provider: 'manual',
    fetchedAt: timestamp,
    isManual: true,
    ...input,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('finance quote baselines', () => {
  it('preserves previous-day quote and rate baselines for same-day manual edits', () => {
    const fund = asset({ id: 'fund', name: '基金', assetType: 'QDII_EQUITY_CNY', currency: 'CNY', latestPrice: 1.15 });
    const previousFundQuote = quote({
      targetId: 'fund',
      price: 1.2,
      currency: 'CNY',
      priceDate: '2026-05-28',
      previousPrice: 1.1,
      previousPriceDate: '2026-05-27',
    });
    const nextFundQuote = manualAssetQuote(fund, 1.23, '2026-05-28', '手动录入', previousFundQuote);
    expect(nextFundQuote.previousPrice).toBe(1.1);
    expect(nextFundQuote.previousPriceDate).toBe('2026-05-27');

    const previousRate = rate({
      pair: 'USD/CNY',
      rate: 7.2,
      asOfDate: '2026-05-28',
      previousRate: 7.1,
      previousAsOfDate: '2026-05-27',
    });
    const nextRate = manualExchangeRate('USD/CNY', 7.25, '2026-05-28', previousRate);
    expect(nextRate.previousRate).toBe(7.1);
    expect(nextRate.previousAsOfDate).toBe('2026-05-27');
  });

  it('keeps older baselines when public quotes refresh multiple times in one day', async () => {
    const data = createEmptyFinanceData();
    data.assets = [
      asset({
        id: 'fund',
        name: '基金',
        assetType: 'QDII_EQUITY_CNY',
        currency: 'CNY',
        quoteProvider: 'eastmoney-fund',
        quoteSymbol: '000001',
        isManualData: false,
      }),
    ];
    data.quotes.fund = quote({
      targetId: 'fund',
      price: 1.2,
      currency: 'CNY',
      priceDate: '2026-05-28',
      previousPrice: 1.1,
      previousPriceDate: '2026-05-27',
      provider: 'eastmoney-fund',
      isManual: false,
    });
    data.exchangeRates['USD/CNY'] = rate({
      pair: 'USD/CNY',
      rate: 7.2,
      asOfDate: '2026-05-28',
      previousRate: 7.1,
      previousAsOfDate: '2026-05-27',
      provider: 'frankfurter-fx',
      isManual: false,
    });
    data.exchangeRates['USDT/CNY'] = rate({
      pair: 'USDT/CNY',
      rate: 7.18,
      asOfDate: '2026-05-28',
      previousRate: 7.08,
      previousAsOfDate: '2026-05-27',
      provider: 'coingecko-stablecoin',
      isManual: false,
    });
    data.exchangeRates['USDC/CNY'] = rate({
      pair: 'USDC/CNY',
      rate: 7.17,
      asOfDate: '2026-05-28',
      previousRate: 7.07,
      previousAsOfDate: '2026-05-27',
      provider: 'coingecko-stablecoin',
      isManual: false,
    });

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/api/finance-public/usd-cny')) {
        return { ok: true, json: async () => ({ rate: 7.26, asOfDate: '2026-05-28', source: 'fx', provider: 'frankfurter-fx' }) } as Response;
      }
      if (url.includes('/api/finance-public/stablecoin-rates')) {
        return { ok: true, json: async () => ({ asOfDate: '2026-05-28', source: 'stable', provider: 'coingecko-stablecoin', rates: { 'USDT/CNY': 7.19, 'USDC/CNY': 7.18 } }) } as Response;
      }
      if (url.includes('/api/finance-public/fund?')) {
        return { ok: true, json: async () => ({ code: '000001', price: 1.25, priceDate: '2026-05-28', source: 'fund', provider: 'eastmoney-fund' }) } as Response;
      }
      throw new Error(`unexpected fetch ${url}`);
    }));

    const next = await updatePublicFinanceQuotes(data);
    expect(next.quotes.fund.previousPrice).toBe(1.1);
    expect(next.quotes.fund.previousPriceDate).toBe('2026-05-27');
    expect(next.exchangeRates['USD/CNY']?.previousRate).toBe(7.1);
    expect(next.exchangeRates['USD/CNY']?.previousAsOfDate).toBe('2026-05-27');
    expect(next.exchangeRates['USDT/CNY']?.previousRate).toBe(7.08);
    expect(next.exchangeRates['USDT/CNY']?.previousAsOfDate).toBe('2026-05-27');
  });
});
