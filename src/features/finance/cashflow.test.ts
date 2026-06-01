import { describe, expect, it } from 'vitest';
import type { FinanceData } from '../../types/finance';
import { buildCashflowAnalysis } from './cashflow';

const baseData: FinanceData = {
  schemaVersion: 1,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  settings: {
    baseCurrency: 'CNY',
    displayCurrency: 'CNY',
    amountHidden: false,
    useChinaFundColors: true,
    dailyAutoUpdate: false,
  },
  assets: [
    {
      id: 'cash-cny',
      name: '人民币现金',
      assetType: 'CASH_CNY',
      groupId: 'cash',
      riskBucket: 'cash',
      marketExposure: 'China',
      currency: 'CNY',
      quoteProvider: 'manual',
      status: 'active',
      continueInvesting: false,
      tags: [],
      isManualData: true,
      costStatus: 'complete',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
    {
      id: 'fund-1',
      name: '指数基金',
      assetType: 'QDII_EQUITY_CNY',
      groupId: 'us_core_equity',
      riskBucket: 'core_equity',
      marketExposure: 'US_SP500',
      currency: 'CNY',
      quoteProvider: 'manual',
      status: 'active',
      continueInvesting: true,
      tags: [],
      isManualData: true,
      costStatus: 'complete',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
  ],
  transactions: [
    {
      id: 'salary',
      dateTime: '2026-06-01T01:00:00.000Z',
      assetId: 'cash-cny',
      type: 'CASH_DEPOSIT',
      amount: 10000,
      currency: 'CNY',
      relatedTransactionIds: [],
      cashflowKind: 'income',
      cashflowCategory: 'salary',
      status: 'confirmed',
      createdAt: '2026-06-01T01:00:00.000Z',
      updatedAt: '2026-06-01T01:00:00.000Z',
    },
    {
      id: 'rent',
      dateTime: '2026-06-02T01:00:00.000Z',
      assetId: 'cash-cny',
      type: 'CASH_WITHDRAWAL',
      amount: 2500,
      currency: 'CNY',
      relatedTransactionIds: [],
      cashflowKind: 'expense',
      cashflowCategory: 'housing',
      status: 'confirmed',
      createdAt: '2026-06-02T01:00:00.000Z',
      updatedAt: '2026-06-02T01:00:00.000Z',
    },
    {
      id: 'buy',
      dateTime: '2026-06-03T01:00:00.000Z',
      assetId: 'fund-1',
      type: 'BUY',
      amount: 3000,
      fee: 3,
      currency: 'CNY',
      relatedTransactionIds: [],
      status: 'confirmed',
      createdAt: '2026-06-03T01:00:00.000Z',
      updatedAt: '2026-06-03T01:00:00.000Z',
    },
  ],
  plans: [],
  targets: [],
  quotes: {},
  exchangeRates: {},
  quoteLogs: [],
};

describe('cashflow analysis', () => {
  it('summarizes income, expense and investment outflow', () => {
    const analysis = buildCashflowAnalysis(baseData, { from: '2026-06-01', to: '2026-06-30' });

    expect(analysis.summary.totalIncomeCny).toBe(10000);
    expect(analysis.summary.totalExpenseCny).toBe(2500);
    expect(analysis.summary.netCashflowCny).toBe(7500);
    expect(analysis.summary.investmentOutflowCny).toBe(3003);
    expect(analysis.summary.savingsRate).toBe(75);
    expect(analysis.expenseCategories[0].label).toBe('居住');
    expect(analysis.investmentCategories[0].label).toBe('买入投资');
  });
});
