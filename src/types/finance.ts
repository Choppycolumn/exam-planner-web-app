export type FinanceCurrency = 'CNY' | 'USD' | 'USDT' | 'USDC';

export type FinanceAssetType =
  | 'CASH_CNY'
  | 'CASH_USD'
  | 'CNY_FIXED_INCOME_FUND'
  | 'USD_FIXED_INCOME_WEALTH'
  | 'QDII_EQUITY_CNY'
  | 'QDII_EQUITY_USD'
  | 'REGIONAL_EQUITY_CNY'
  | 'CRYPTO_STABLECOIN'
  | 'CRYPTO_STABLECOIN_EARN'
  | 'GOLD_FUND'
  | 'OTHER';

export type FinanceRiskBucket = 'low_volatility' | 'core_equity' | 'satellite_equity' | 'platform_exploration' | 'cash';

export type FinanceMarketExposure =
  | 'China'
  | 'US_SP500'
  | 'US_NASDAQ100'
  | 'Japan'
  | 'Vietnam'
  | 'France'
  | 'Germany'
  | 'HongKong'
  | 'Gold'
  | 'USD_CashLike'
  | 'Stablecoin'
  | 'Other';

export type FinanceTransactionType =
  | 'OPENING_POSITION'
  | 'CASH_DEPOSIT'
  | 'CASH_WITHDRAWAL'
  | 'BUY'
  | 'SELL'
  | 'FX_CONVERSION'
  | 'DIVIDEND'
  | 'INTEREST'
  | 'REWARD'
  | 'FEE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'ADJUSTMENT';

export type FinanceTransactionStatus = 'confirmed' | 'pending' | 'cancelled';

export type FinanceCashflowKind = 'income' | 'expense' | 'investment' | 'transfer' | 'fee' | 'adjustment';

export type FinanceCashflowCategory =
  | 'salary'
  | 'bonus'
  | 'living'
  | 'food'
  | 'housing'
  | 'transport'
  | 'health'
  | 'education'
  | 'subscription'
  | 'entertainment'
  | 'tax'
  | 'cash_deposit'
  | 'cash_withdrawal'
  | 'investment_buy'
  | 'investment_sell'
  | 'dividend'
  | 'interest'
  | 'reward'
  | 'fx'
  | 'transfer'
  | 'fee'
  | 'adjustment'
  | 'other';

export type FinanceAssetStatus = 'active' | 'archived' | 'watch' | 'exit';

export type FinanceCostStatus = 'complete' | 'partial' | 'missing';

export type FinancePlanStatus = 'active' | 'paused' | 'draft' | 'completed' | 'cancelled';

export type FinanceTargetActionStatus = 'continue' | 'pause_new' | 'exit' | 'review';

export type FinanceQuoteProvider = 'manual' | 'eastmoney-fund' | 'frankfurter-fx' | 'coingecko-stablecoin';

export interface FinanceQuote {
  id: string;
  targetId: string;
  targetType: 'asset' | 'exchange_rate';
  price: number | null;
  currency: FinanceCurrency;
  priceDate: string;
  fetchedAt: string;
  source: string;
  provider: FinanceQuoteProvider;
  isManual: boolean;
  failed: boolean;
  error?: string;
  previousPrice?: number | null;
  previousPriceDate?: string;
  raw?: unknown;
}

export interface FinanceExchangeRate {
  pair: 'USD/CNY' | 'USDT/CNY' | 'USDC/CNY';
  rate: number | null;
  source: string;
  provider: FinanceQuoteProvider;
  asOfDate: string;
  fetchedAt: string;
  isManual: boolean;
  failed?: boolean;
  error?: string;
  previousRate?: number | null;
  previousAsOfDate?: string;
}

export interface FinanceAsset {
  id: string;
  name: string;
  symbol?: string;
  platform?: string;
  assetType: FinanceAssetType;
  groupId: string;
  riskBucket: FinanceRiskBucket;
  marketExposure: FinanceMarketExposure;
  currency: FinanceCurrency;
  quoteProvider: FinanceQuoteProvider;
  quoteSymbol?: string;
  status: FinanceAssetStatus;
  continueInvesting: boolean;
  tags: string[];
  referenceAnnualYield?: number | null;
  units?: number | null;
  currentAmount?: number | null;
  totalCost?: number | null;
  trackingStartDate?: string;
  trackingBaselineAmount?: number | null;
  trackingBaselineUnits?: number | null;
  tradeRule?: FinanceTradeRule;
  latestPrice?: number | null;
  priceDate?: string;
  dataSource?: string;
  isManualData: boolean;
  costStatus: FinanceCostStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceTradeRule {
  priceDateLagBusinessDays: number;
  buyConfirmBusinessDays: number;
  sellConfirmBusinessDays: number;
  sellSettlementBusinessDays: number;
  cutoffTime?: string;
  description?: string;
}

export interface FinanceTransaction {
  id: string;
  dateTime: string;
  assetId?: string;
  platform?: string;
  type: FinanceTransactionType;
  units?: number | null;
  price?: number | null;
  amount?: number | null;
  costAmount?: number | null;
  currency: FinanceCurrency;
  fxRate?: number | null;
  fee?: number | null;
  feeCurrency?: FinanceCurrency;
  fromAssetId?: string;
  toAssetId?: string;
  fromCurrency?: FinanceCurrency;
  toCurrency?: FinanceCurrency;
  toAmount?: number | null;
  sourceCashAssetId?: string;
  relatedTransactionIds: string[];
  cashflowKind?: FinanceCashflowKind;
  cashflowCategory?: FinanceCashflowCategory;
  merchant?: string;
  counterparty?: string;
  tags?: string[];
  tradeDate?: string;
  priceDate?: string;
  confirmDate?: string;
  settlementDate?: string;
  estimatedByRule?: boolean;
  note?: string;
  status: FinanceTransactionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FinancePlan {
  id: string;
  assetId?: string;
  name: string;
  amount: number;
  currency: FinanceCurrency;
  frequency: string;
  status: FinancePlanStatus;
  startDate?: string;
  endDate?: string;
  expectedMonthlyAmount?: number | null;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceAllocationTarget {
  id: string;
  name: string;
  assetGroupIds: string[];
  targetPercent: number;
  tolerancePercent: number;
  continueInvesting: boolean;
  actionStatus: FinanceTargetActionStatus;
  riskNote: string;
  sortOrder: number;
}

export interface FinanceQuoteLog {
  id: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  source: string;
  message: string;
}

export interface FinanceSettings {
  baseCurrency: 'CNY';
  displayCurrency: FinanceCurrency;
  amountHidden: boolean;
  useChinaFundColors: boolean;
  dailyAutoUpdate: boolean;
  performanceStartDate?: string;
  lastAutoQuoteUpdateDate?: string;
}

export interface FinanceData {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  settings: FinanceSettings;
  assets: FinanceAsset[];
  transactions: FinanceTransaction[];
  plans: FinancePlan[];
  targets: FinanceAllocationTarget[];
  quotes: Record<string, FinanceQuote>;
  exchangeRates: Partial<Record<FinanceExchangeRate['pair'], FinanceExchangeRate>>;
  quoteLogs: FinanceQuoteLog[];
}

export interface FinanceHoldingSnapshot {
  asset: FinanceAsset;
  units: number | null;
  nativeMarketValue: number | null;
  cnyMarketValue: number | null;
  costNative: number | null;
  costCny: number | null;
  realizedPnlNative: number;
  unrealizedPnlNative: number | null;
  cumulativePnlNative: number | null;
  cumulativePnlCny: number | null;
  returnRate: number | null;
  todayPnlNative: number | null;
  todayPnlCny: number | null;
  quote: FinanceQuote | null;
  issues: string[];
  isStale: boolean;
  isManual: boolean;
}

export interface FinanceAllocationRow {
  key: string;
  label: string;
  valueCny: number;
  percent: number;
  targetPercent?: number;
  driftPercent?: number;
  status?: FinanceTargetActionStatus;
}

export interface FinancePortfolioSnapshot {
  generatedAt: string;
  holdings: FinanceHoldingSnapshot[];
  totalAssetsCny: number;
  investedAssetsCny: number;
  availableCashCny: number;
  todayPnlCny: number | null;
  cumulativePnlCny: number | null;
  cumulativeReturnRate: number | null;
  usdRelatedPercent: number;
  equityPercent: number;
  lowVolatilityPercent: number;
  stablecoinPlatformPercent: number;
  latestQuoteFetchedAt: string;
  alerts: string[];
  byGroup: FinanceAllocationRow[];
  byCurrency: FinanceAllocationRow[];
  byMarket: FinanceAllocationRow[];
  byRisk: FinanceAllocationRow[];
  targetRows: FinanceAllocationRow[];
}
