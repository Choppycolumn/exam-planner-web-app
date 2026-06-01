import { describe, expect, it } from 'vitest';
import type { FinanceAsset, FinanceData, FinanceTransaction } from '../../types/finance';
import { buildPortfolioSnapshot } from './calculations';
import { createEmptyFinanceData } from './storage';
import { generateFinanceMarkdownReport } from './reports';

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
    priceDate: '2026-05-28',
    dataSource: 'test',
    isManualData: true,
    costStatus: 'complete',
    notes: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...input,
  };
}

function transaction(input: Partial<FinanceTransaction> & Pick<FinanceTransaction, 'id' | 'type' | 'currency'>): FinanceTransaction {
  return {
    dateTime: timestamp,
    assetId: undefined,
    platform: 'test',
    units: null,
    price: null,
    amount: null,
    costAmount: null,
    fxRate: null,
    fee: null,
    feeCurrency: input.currency,
    relatedTransactionIds: [],
    note: '',
    status: 'confirmed',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...input,
  };
}

function baseData(): FinanceData {
  return createEmptyFinanceData();
}

describe('finance calculations', () => {
  it('uses opening records as the tracking baseline from today', () => {
    const data = baseData();
    data.assets = [
      asset({
        id: 'fund-legacy',
        name: '旧基金',
        assetType: 'QDII_EQUITY_CNY',
        currency: 'CNY',
        currentAmount: 1000,
        costStatus: 'missing',
      }),
    ];
    data.transactions = [
      transaction({ id: 'opening', type: 'OPENING_POSITION', assetId: 'fund-legacy', amount: 1000, currency: 'CNY', costAmount: null }),
    ];

    const snapshot = buildPortfolioSnapshot(data);
    expect(snapshot.totalAssetsCny).toBe(1000);
    expect(snapshot.holdings[0].cumulativePnlNative).toBe(0);
    expect(snapshot.holdings[0].returnRate).toBe(0);
    expect(snapshot.holdings[0].issues.join(' ')).not.toContain('成本数据待补充');
  });

  it('keeps cash imprecise while FX is pending and settles linked USD buys after confirmation', () => {
    const data = baseData();
    data.exchangeRates['USD/CNY'] = {
      pair: 'USD/CNY',
      rate: 7.2,
      source: 'test',
      provider: 'manual',
      asOfDate: '2026-05-28',
      fetchedAt: timestamp,
      isManual: true,
    };
    data.assets = [
      asset({ id: 'cash-cny', name: '待投资现金池', assetType: 'CASH_CNY', currency: 'CNY', groupId: 'cny_cash_low_vol', riskBucket: 'cash', marketExposure: 'China' }),
      asset({ id: 'cash-usd', name: '美元现金', assetType: 'CASH_USD', currency: 'USD', groupId: 'usd_low_vol', riskBucket: 'cash', marketExposure: 'USD_CashLike' }),
      asset({ id: 'wealth-usd', name: '美元理财', assetType: 'USD_FIXED_INCOME_WEALTH', currency: 'USD', currentAmount: 80 }),
      asset({ id: 'nasdaq-usd', name: '美元纳指', assetType: 'QDII_EQUITY_USD', currency: 'USD', currentAmount: 20 }),
    ];
    data.transactions = [
      transaction({ id: 'opening-cny', type: 'OPENING_POSITION', assetId: 'cash-cny', amount: 30000, costAmount: 30000, currency: 'CNY' }),
      transaction({
        id: 'fx',
        type: 'FX_CONVERSION',
        currency: 'CNY',
        fromAssetId: 'cash-cny',
        toAssetId: 'cash-usd',
        fromCurrency: 'CNY',
        toCurrency: 'USD',
        toAmount: 100,
        status: 'pending',
        relatedTransactionIds: ['buy-80', 'buy-20'],
      }),
      transaction({ id: 'buy-80', type: 'BUY', assetId: 'wealth-usd', amount: 80, currency: 'USD', sourceCashAssetId: 'cash-usd', relatedTransactionIds: ['fx'] }),
      transaction({ id: 'buy-20', type: 'BUY', assetId: 'nasdaq-usd', amount: 20, currency: 'USD', sourceCashAssetId: 'cash-usd', relatedTransactionIds: ['fx'] }),
    ];

    const pendingSnapshot = buildPortfolioSnapshot(data);
    expect(pendingSnapshot.holdings.find((holding) => holding.asset.id === 'cash-cny')?.nativeMarketValue).toBe(30000);
    expect(pendingSnapshot.holdings.find((holding) => holding.asset.id === 'cash-usd')?.nativeMarketValue).toBe(0);
    expect(pendingSnapshot.alerts.join(' ')).toContain('待确认换汇');

    data.transactions = data.transactions.map((item) => (item.id === 'fx' ? { ...item, status: 'confirmed', fxRate: 7.2, fee: 5 } : item));
    const confirmedSnapshot = buildPortfolioSnapshot(data);
    expect(confirmedSnapshot.holdings.find((holding) => holding.asset.id === 'cash-cny')?.nativeMarketValue).toBe(29275);
    expect(confirmedSnapshot.holdings.find((holding) => holding.asset.id === 'cash-usd')?.nativeMarketValue).toBe(0);
  });

  it('converts USD and stablecoin assets to CNY with independent rates', () => {
    const data = baseData();
    data.exchangeRates['USD/CNY'] = { pair: 'USD/CNY', rate: 7, source: 'test', provider: 'manual', asOfDate: '2026-05-28', fetchedAt: timestamp, isManual: true };
    data.exchangeRates['USDT/CNY'] = { pair: 'USDT/CNY', rate: 6.9, source: 'test', provider: 'manual', asOfDate: '2026-05-28', fetchedAt: timestamp, isManual: true };
    data.assets = [
      asset({ id: 'usd', name: 'USD Asset', assetType: 'CASH_USD', currency: 'USD' }),
      asset({ id: 'usdt', name: 'USDT Earn', assetType: 'CRYPTO_STABLECOIN_EARN', currency: 'USDT', currentAmount: 50, units: 50, riskBucket: 'platform_exploration', marketExposure: 'Stablecoin' }),
    ];
    data.transactions = [transaction({ id: 'usd-opening', type: 'OPENING_POSITION', assetId: 'usd', amount: 100, costAmount: 100, currency: 'USD' })];

    const snapshot = buildPortfolioSnapshot(data);
    expect(snapshot.totalAssetsCny).toBe(1045);
  });

  it('keeps today PnL anchored to the previous valuation date and includes FX-driven CNY changes', () => {
    const data = baseData();
    data.exchangeRates['USD/CNY'] = {
      pair: 'USD/CNY',
      rate: 7.2,
      source: 'test',
      provider: 'manual',
      asOfDate: '2026-05-28',
      fetchedAt: timestamp,
      isManual: true,
      previousRate: 7.1,
      previousAsOfDate: '2026-05-27',
    };
    data.exchangeRates['USDT/CNY'] = {
      pair: 'USDT/CNY',
      rate: 7.2,
      source: 'test',
      provider: 'manual',
      asOfDate: '2026-05-28',
      fetchedAt: timestamp,
      isManual: true,
      previousRate: 7.1,
      previousAsOfDate: '2026-05-27',
    };
    data.assets = [
      asset({ id: 'cash-usd', name: '美元现金', assetType: 'CASH_USD', currency: 'USD', groupId: 'usd_low_vol', riskBucket: 'cash', marketExposure: 'USD_CashLike' }),
      asset({ id: 'stable', name: 'USDT 活期', assetType: 'CRYPTO_STABLECOIN_EARN', currency: 'USDT', currentAmount: 1000, units: 1000, riskBucket: 'platform_exploration', marketExposure: 'Stablecoin' }),
    ];
    data.transactions = [
      transaction({ id: 'usd-opening', type: 'OPENING_POSITION', assetId: 'cash-usd', amount: 100, costAmount: 100, currency: 'USD' }),
    ];
    data.quotes.stable = {
      id: 'quote-stable',
      targetId: 'stable',
      targetType: 'asset',
      price: 1,
      currency: 'USDT',
      priceDate: '2026-05-28',
      fetchedAt: timestamp,
      source: 'test',
      provider: 'manual',
      isManual: true,
      failed: false,
      previousPrice: 1,
      previousPriceDate: '2026-05-27',
    };

    const snapshot = buildPortfolioSnapshot(data);
    const usdCash = snapshot.holdings.find((holding) => holding.asset.id === 'cash-usd');
    const stable = snapshot.holdings.find((holding) => holding.asset.id === 'stable');
    expect(usdCash?.todayPnlCny).toBe(10);
    expect(stable?.todayPnlCny).toBe(100);
    expect(snapshot.todayPnlCny).toBe(110);
  });

  it('applies buys, sells, interest and fees to PnL, but never treats APR as income', () => {
    const data = baseData();
    data.assets = [
      asset({ id: 'fund', name: '基金', assetType: 'QDII_EQUITY_CNY', currency: 'CNY' }),
      asset({ id: 'stable', name: '稳定币', assetType: 'CRYPTO_STABLECOIN_EARN', currency: 'USDT', currentAmount: 1000, totalCost: 1000, costStatus: 'complete', referenceAnnualYield: 9.9, riskBucket: 'platform_exploration', marketExposure: 'Stablecoin' }),
    ];
    data.exchangeRates['USDT/CNY'] = { pair: 'USDT/CNY', rate: 7, source: 'test', provider: 'manual', asOfDate: '2026-05-28', fetchedAt: timestamp, isManual: true };
    data.quotes.fund = {
      id: 'quote-fund',
      targetId: 'fund',
      targetType: 'asset',
      price: 12,
      currency: 'CNY',
      priceDate: '2026-05-28',
      fetchedAt: timestamp,
      source: 'test',
      provider: 'manual',
      isManual: true,
      failed: false,
      previousPrice: 11,
    };
    data.transactions = [
      transaction({ id: 'buy', type: 'BUY', assetId: 'fund', amount: 100, units: 10, currency: 'CNY' }),
      transaction({ id: 'sell', type: 'SELL', assetId: 'fund', amount: 70, units: 5, currency: 'CNY' }),
      transaction({ id: 'interest', type: 'INTEREST', assetId: 'fund', amount: 3, currency: 'CNY' }),
      transaction({ id: 'fee', type: 'FEE', assetId: 'fund', amount: 1, currency: 'CNY' }),
    ];

    const snapshot = buildPortfolioSnapshot(data);
    const fund = snapshot.holdings.find((holding) => holding.asset.id === 'fund');
    const stable = snapshot.holdings.find((holding) => holding.asset.id === 'stable');
    expect(fund?.cumulativePnlNative).toBe(32);
    expect(fund?.todayPnlNative).toBe(5);
    expect(stable?.cumulativePnlNative).toBe(0);
  });

  it('adds direct stablecoin income on top of the tracking baseline balance', () => {
    const data = baseData();
    data.exchangeRates['USDT/CNY'] = { pair: 'USDT/CNY', rate: 7, source: 'test', provider: 'manual', asOfDate: '2026-05-28', fetchedAt: timestamp, isManual: true };
    data.assets = [
      asset({
        id: 'stable',
        name: 'USDT 活期',
        assetType: 'CRYPTO_STABLECOIN_EARN',
        currency: 'USDT',
        currentAmount: 1000,
        trackingBaselineAmount: 1000,
        trackingBaselineUnits: 1000,
        riskBucket: 'platform_exploration',
        marketExposure: 'Stablecoin',
      }),
    ];
    data.transactions = [
      transaction({ id: 'reward', type: 'REWARD', assetId: 'stable', amount: 2.5, units: 2.5, price: 1, currency: 'USDT' }),
    ];

    const snapshot = buildPortfolioSnapshot(data);
    const stable = snapshot.holdings.find((holding) => holding.asset.id === 'stable');
    expect(stable?.nativeMarketValue).toBe(1002.5);
    expect(stable?.cumulativePnlNative).toBe(2.5);
  });

  it('keeps last successful price visible when quote update fails and reports the issue', () => {
    const data = baseData();
    data.assets = [asset({ id: 'fund', name: '基金', assetType: 'QDII_EQUITY_CNY', currency: 'CNY', units: 100 })];
    data.quotes.fund = {
      id: 'quote-failed',
      targetId: 'fund',
      targetType: 'asset',
      price: 1.2,
      currency: 'CNY',
      priceDate: '2026-05-27',
      fetchedAt: timestamp,
      source: 'test',
      provider: 'manual',
      isManual: false,
      failed: true,
      error: 'HTTP 500',
      previousPrice: 1.1,
    };
    data.transactions = [transaction({ id: 'opening', type: 'OPENING_POSITION', assetId: 'fund', units: 100, costAmount: 100, currency: 'CNY' })];

    const snapshot = buildPortfolioSnapshot(data);
    expect(snapshot.holdings[0].nativeMarketValue).toBe(120);
    expect(snapshot.holdings[0].issues.join(' ')).toContain('行情更新失败');
  });

  it('exports markdown reports with missing-data warnings and current holdings', () => {
    const data = baseData();
    data.assets = [asset({ id: 'fund', name: '旧基金', assetType: 'QDII_EQUITY_CNY', currency: 'CNY', currentAmount: 1000, costStatus: 'missing' })];
    data.transactions = [transaction({ id: 'opening', type: 'OPENING_POSITION', assetId: 'fund', amount: 1000, currency: 'CNY' })];

    const snapshot = buildPortfolioSnapshot(data);
    const report = generateFinanceMarkdownReport(data, snapshot, { kind: 'daily', periodStart: '2026-05-28', periodEnd: '2026-05-28' });
    expect(report).toContain('# 个人理财组合报告');
    expect(report).toContain('旧基金');
    expect(report).toContain('起算基准');
    expect(report).toContain('起算后盈亏');
  });
});
