import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileJson,
  FileText,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { useUnsavedChangesPrompt } from '../hooks/useUnsavedChangesPrompt';
import type {
  FinanceAllocationTarget,
  FinanceAsset,
  FinanceCashflowCategory,
  FinanceCashflowKind,
  FinanceCurrency,
  FinanceData,
  FinanceExchangeRate,
  FinanceHoldingSnapshot,
  FinancePlan,
  FinancePlanStatus,
  FinanceQuoteProvider,
  FinanceTradeRule,
  FinanceTransaction,
} from '../types/finance';
import {
  financeActionStatusLabels,
  financeAssetTypeOptions,
  financeCurrencyOptions,
  financeGroupLabels,
  financeGroupOptions,
  financeMarketExposureOptions,
  financeRiskBucketOptions,
  financeTransactionStatusLabels,
  financeTransactionStatusOptions,
  financeTransactionTypeLabels,
  financeTransactionTypeOptions,
} from '../features/finance/constants';
import {
  buildPortfolioSnapshot,
  formatMoney,
  formatPercent,
  newFinanceId,
  nowISO,
  roundMoney,
  todayDateISO,
} from '../features/finance/calculations';
import {
  clearRememberedFinancePassphrase,
  createEmptyFinanceData,
  deleteFinanceVault,
  decryptFinanceVault,
  downloadBlob,
  financeVaultExists,
  getEncryptedFinanceVault,
  getRememberedFinancePassphrase,
  normalizeImportedFinanceData,
  saveFinanceVault,
  setEncryptedFinanceVault,
  setRememberedFinancePassphrase,
} from '../features/finance/storage';
import { fetchPublicFundQuoteByCode, manualAssetQuote, manualExchangeRate, updatePublicFinanceQuotes } from '../features/finance/quotes';
import { deleteCloudFinanceVault, getCloudFinanceVault, getFinanceDeviceId, uploadCloudFinanceVault, type FinanceCloudVaultMeta } from '../features/finance/sync';
import {
  defaultReportOptions,
  exportFinanceJson,
  exportHoldingsCsv,
  exportTransactionsCsv,
  generateFinanceMarkdownReport,
  type FinanceReportKind,
  type FinanceReportOptions,
} from '../features/finance/reports';
import {
  buildCashflowAnalysis,
  cashflowCategoryOptions,
  cashflowKindOptions,
  exportCashflowCsv,
} from '../features/finance/cashflow';
import { CashflowPanel } from '../features/finance/components/CashflowPanel';
import { bankRowsToFinanceTransactions, extractPdfTextFromFile, parseIcbcStatementText, type BankImportResult } from '../features/finance/bankImport';

const chartPalette = ['#2563eb', '#16a34a', '#f97316', '#0f766e', '#dc2626', '#9333ea', '#ca8a04', '#64748b'];

type FinanceView = 'dashboard' | 'assets' | 'cashflow' | 'plans' | 'reports' | 'sync';

const financeViews: Array<{ id: FinanceView; label: string }> = [
  { id: 'dashboard', label: '总览' },
  { id: 'assets', label: '资产' },
  { id: 'cashflow', label: '流水' },
  { id: 'plans', label: '计划/目标' },
  { id: 'reports', label: '报告' },
  { id: 'sync', label: '同步' },
];

type AssetDraft = {
  id?: string;
  name: string;
  symbol: string;
  platform: string;
  assetType: FinanceAsset['assetType'];
  groupId: string;
  riskBucket: FinanceAsset['riskBucket'];
  marketExposure: FinanceAsset['marketExposure'];
  currency: FinanceCurrency;
  quoteProvider: FinanceQuoteProvider;
  quoteSymbol: string;
  status: FinanceAsset['status'];
  continueInvesting: boolean;
  tags: string;
  referenceAnnualYield: string;
  units: string;
  currentAmount: string;
  totalCost: string;
  latestPrice: string;
  priceDate: string;
  priceDateLagBusinessDays: string;
  buyConfirmBusinessDays: string;
  sellConfirmBusinessDays: string;
  sellSettlementBusinessDays: string;
  dataSource: string;
  isManualData: boolean;
  costStatus: FinanceAsset['costStatus'];
  notes: string;
};

type TransactionDraft = {
  id?: string;
  dateTime: string;
  assetId: string;
  platform: string;
  type: FinanceTransaction['type'];
  units: string;
  price: string;
  amount: string;
  costAmount: string;
  currency: FinanceCurrency;
  fxRate: string;
  fee: string;
  feeCurrency: FinanceCurrency;
  fromAssetId: string;
  toAssetId: string;
  fromCurrency: FinanceCurrency;
  toCurrency: FinanceCurrency;
  toAmount: string;
  sourceCashAssetId: string;
  relatedTransactionIds: string;
  cashflowKind: '' | FinanceCashflowKind;
  cashflowCategory: '' | FinanceCashflowCategory;
  merchant: string;
  counterparty: string;
  tags: string;
  note: string;
  status: FinanceTransaction['status'];
};

type PlanDraft = {
  id?: string;
  assetId: string;
  name: string;
  amount: string;
  currency: FinanceCurrency;
  frequency: string;
  status: FinancePlanStatus;
  startDate: string;
  endDate: string;
  expectedMonthlyAmount: string;
  note: string;
};

type QuickTradeDraft = {
  type: 'BUY' | 'SELL';
  tradeDate: string;
  amount: string;
  price: string;
  fee: string;
  sourceCashAssetId: string;
  note: string;
};

type BalanceSnapshotDraft = {
  date: string;
  incomeAmount: string;
  beforeBalance: string;
  afterBalance: string;
  note: string;
};

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function numberOrZero(value: string) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function defaultTradeRuleForAsset(asset: Pick<FinanceAsset, 'assetType' | 'quoteProvider'>): FinanceTradeRule {
  if (asset.assetType === 'QDII_EQUITY_CNY' || asset.assetType === 'QDII_EQUITY_USD' || asset.assetType === 'REGIONAL_EQUITY_CNY') {
    return {
      priceDateLagBusinessDays: 0,
      buyConfirmBusinessDays: 2,
      sellConfirmBusinessDays: 2,
      sellSettlementBusinessDays: 5,
      cutoffTime: '15:00',
      description: 'QDII/区域基金默认按 T 日净值、T+2 确认估算。',
    };
  }
  if (asset.assetType === 'CNY_FIXED_INCOME_FUND' || asset.assetType === 'GOLD_FUND') {
    return {
      priceDateLagBusinessDays: 0,
      buyConfirmBusinessDays: 1,
      sellConfirmBusinessDays: 1,
      sellSettlementBusinessDays: 2,
      cutoffTime: '15:00',
      description: '普通公募基金默认按 T 日净值、T+1 确认估算。',
    };
  }
  return {
    priceDateLagBusinessDays: 0,
    buyConfirmBusinessDays: 0,
    sellConfirmBusinessDays: 0,
    sellSettlementBusinessDays: 0,
    description: '手动余额类资产默认 T+0 记录。',
  };
}

function isBalanceIncomeAssetType(assetType: FinanceAsset['assetType']) {
  return assetType === 'USD_FIXED_INCOME_WEALTH' || assetType === 'CRYPTO_STABLECOIN' || assetType === 'CRYPTO_STABLECOIN_EARN';
}

function effectiveTradeRule(asset: FinanceAsset) {
  return { ...defaultTradeRuleForAsset(asset), ...asset.tradeRule };
}

function addBusinessDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateText;
  let remaining = Math.max(0, Math.trunc(days));
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return todayDateISO(date);
}

function tradeDatesFor(asset: FinanceAsset, type: 'BUY' | 'SELL', tradeDate: string) {
  const rule = effectiveTradeRule(asset);
  return {
    priceDate: addBusinessDays(tradeDate, rule.priceDateLagBusinessDays),
    confirmDate: addBusinessDays(tradeDate, type === 'BUY' ? rule.buyConfirmBusinessDays : rule.sellConfirmBusinessDays),
    settlementDate: type === 'SELL' ? addBusinessDays(tradeDate, rule.sellSettlementBusinessDays) : undefined,
    rule,
  };
}

function inferAssetDraftFromFundName(name: string) {
  if (/债|固收|货币|现金/.test(name)) return { assetType: 'CNY_FIXED_INCOME_FUND' as const, groupId: 'cny_cash_low_vol', riskBucket: 'low_volatility' as const, marketExposure: 'China' as const };
  if (/纳斯达克|NASDAQ|Nasdaq/i.test(name)) return { assetType: 'QDII_EQUITY_CNY' as const, groupId: 'us_core_equity', riskBucket: 'core_equity' as const, marketExposure: 'US_NASDAQ100' as const };
  if (/标普|S&P|SP500|500/.test(name)) return { assetType: 'QDII_EQUITY_CNY' as const, groupId: 'us_core_equity', riskBucket: 'core_equity' as const, marketExposure: 'US_SP500' as const };
  if (/日经|日本/.test(name)) return { assetType: 'REGIONAL_EQUITY_CNY' as const, groupId: 'japan_view', riskBucket: 'satellite_equity' as const, marketExposure: 'Japan' as const };
  if (/越南/.test(name)) return { assetType: 'REGIONAL_EQUITY_CNY' as const, groupId: 'vietnam_satellite', riskBucket: 'satellite_equity' as const, marketExposure: 'Vietnam' as const };
  if (/黄金|金/.test(name)) return { assetType: 'GOLD_FUND' as const, groupId: 'other', riskBucket: 'satellite_equity' as const, marketExposure: 'Gold' as const };
  return { assetType: 'QDII_EQUITY_CNY' as const, groupId: 'other', riskBucket: 'satellite_equity' as const, marketExposure: 'Other' as const };
}

function manualIncomeAssetTemplate(keyword: string): Partial<AssetDraft> | null {
  const value = keyword.trim();
  if (!value) return null;
  if (/230713|高盛|工银|盛景|美元理财/i.test(value)) {
    return {
      name: '高盛工银理财·盛景每日开放固定收益类美元理财产品1期',
      symbol: value.match(/\d{6}/)?.[0] ?? '230713',
      platform: '高盛工银理财/工银理财',
      assetType: 'USD_FIXED_INCOME_WEALTH',
      groupId: 'usd_low_vol',
      riskBucket: 'low_volatility',
      marketExposure: 'USD_CashLike',
      currency: 'USD',
      quoteProvider: 'manual',
      quoteSymbol: '',
      latestPrice: '1',
      priceDate: todayDateISO(),
      dataSource: '手动余额更新；不登录银行账户',
      isManualData: true,
      notes: '公开行情暂不可可靠查询，请定期录入余额或单位净值。非保本浮动收益。',
    };
  }
  if (/USDT|USDC|稳定币|活期|Earn|Binance|Bitget|币安/i.test(value)) {
    const currency = /USDC/i.test(value) ? 'USDC' : 'USDT';
    const platform = /bitget/i.test(value) ? 'Bitget' : /binance|币安/i.test(value) ? 'Binance' : '';
    return {
      name: `${platform ? `${platform} ` : ''}${currency} 活期生息`,
      symbol: currency,
      platform,
      assetType: 'CRYPTO_STABLECOIN_EARN',
      groupId: 'stablecoin_platform',
      riskBucket: 'platform_exploration',
      marketExposure: 'Stablecoin',
      currency,
      quoteProvider: 'coingecko-stablecoin',
      quoteSymbol: currency,
      latestPrice: '1',
      priceDate: todayDateISO(),
      dataSource: 'CoinGecko 稳定币价格；真实收益需手动录入利息/奖励',
      isManualData: false,
      notes: '参考年化只做备注，不自动计入收益。',
    };
  }
  return null;
}

function emptyAssetDraft(): AssetDraft {
  return {
    name: '',
    symbol: '',
    platform: '',
    assetType: 'OTHER',
    groupId: 'other',
    riskBucket: 'low_volatility',
    marketExposure: 'Other',
    currency: 'CNY',
    quoteProvider: 'manual',
    quoteSymbol: '',
    status: 'active',
    continueInvesting: false,
    tags: '',
    referenceAnnualYield: '',
    units: '',
    currentAmount: '',
    totalCost: '',
    latestPrice: '',
    priceDate: todayDateISO(),
    priceDateLagBusinessDays: '0',
    buyConfirmBusinessDays: '0',
    sellConfirmBusinessDays: '0',
    sellSettlementBusinessDays: '0',
    dataSource: '手动录入',
    isManualData: true,
    costStatus: 'missing',
    notes: '',
  };
}

function emptyTransactionDraft(): TransactionDraft {
  return {
    dateTime: `${todayDateISO()}T09:00`,
    assetId: '',
    platform: '',
    type: 'BUY',
    units: '',
    price: '',
    amount: '',
    costAmount: '',
    currency: 'CNY',
    fxRate: '',
    fee: '',
    feeCurrency: 'CNY',
    fromAssetId: '',
    toAssetId: '',
    fromCurrency: 'CNY',
    toCurrency: 'USD',
    toAmount: '',
    sourceCashAssetId: '',
    relatedTransactionIds: '',
    cashflowKind: '',
    cashflowCategory: '',
    merchant: '',
    counterparty: '',
    tags: '',
    note: '',
    status: 'confirmed',
  };
}

function emptyPlanDraft(): PlanDraft {
  return {
    assetId: '',
    name: '',
    amount: '',
    currency: 'CNY',
    frequency: '每月',
    status: 'draft',
    startDate: todayDateISO(),
    endDate: '',
    expectedMonthlyAmount: '',
    note: '',
  };
}

function emptyQuickTradeDraft(): QuickTradeDraft {
  return {
    type: 'BUY',
    tradeDate: todayDateISO(),
    amount: '',
    price: '',
    fee: '',
    sourceCashAssetId: '',
    note: '',
  };
}

function emptyBalanceSnapshotDraft(): BalanceSnapshotDraft {
  return {
    date: todayDateISO(),
    incomeAmount: '',
    beforeBalance: '',
    afterBalance: '',
    note: '',
  };
}

function quotePriceForHolding(holding: FinanceHoldingSnapshot) {
  const { asset } = holding;
  const price = holding.quote?.price ?? asset.latestPrice;
  if (typeof price === 'number' && Number.isFinite(price) && price > 0) return price;
  if (asset.assetType === 'CRYPTO_STABLECOIN' || asset.assetType === 'CRYPTO_STABLECOIN_EARN') return 1;
  if (asset.quoteProvider === 'manual' && typeof asset.currentAmount === 'number') return 1;
  return null;
}

function ensureTrackingStartBaselines(input: FinanceData) {
  const performanceStartDate = input.settings.performanceStartDate ?? todayDateISO();
  const openingAmountByAsset = new Map<string, number>();
  input.transactions.forEach((transaction) => {
    if (transaction.type !== 'OPENING_POSITION' || !transaction.assetId) return;
    if (typeof transaction.amount === 'number' && Number.isFinite(transaction.amount)) openingAmountByAsset.set(transaction.assetId, transaction.amount);
  });
  let changed = false;
  const assets = input.assets.map((asset) => {
    if (asset.status === 'archived' || asset.assetType === 'CASH_CNY' || asset.assetType === 'CASH_USD') return asset;
    const baselineAmount = asset.trackingBaselineAmount ?? asset.currentAmount ?? openingAmountByAsset.get(asset.id) ?? null;
    const price = input.quotes[asset.id]?.price ?? asset.latestPrice ?? (asset.assetType === 'CRYPTO_STABLECOIN' || asset.assetType === 'CRYPTO_STABLECOIN_EARN' ? 1 : null);
    const baselineUnits =
      asset.trackingBaselineUnits ??
      asset.units ??
      (typeof baselineAmount === 'number' && typeof price === 'number' && price > 0 ? roundMoney(baselineAmount / price, 6) : null);
    const tradeRule = asset.tradeRule ?? defaultTradeRuleForAsset(asset);
    if (asset.trackingStartDate && asset.trackingBaselineAmount === baselineAmount && asset.trackingBaselineUnits === baselineUnits && asset.tradeRule) return asset;
    changed = true;
    return {
      ...asset,
      trackingStartDate: asset.trackingStartDate ?? performanceStartDate,
      trackingBaselineAmount: asset.trackingBaselineAmount ?? baselineAmount,
      trackingBaselineUnits: asset.trackingBaselineUnits ?? baselineUnits,
      tradeRule,
    };
  });
  return changed ? { ...input, settings: { ...input.settings, performanceStartDate }, assets } : { ...input, settings: { ...input.settings, performanceStartDate } };
}

function assetToDraft(asset: FinanceAsset): AssetDraft {
  const rule = effectiveTradeRule(asset);
  return {
    id: asset.id,
    name: asset.name,
    symbol: asset.symbol ?? '',
    platform: asset.platform ?? '',
    assetType: asset.assetType,
    groupId: asset.groupId,
    riskBucket: asset.riskBucket,
    marketExposure: asset.marketExposure,
    currency: asset.currency,
    quoteProvider: asset.quoteProvider,
    quoteSymbol: asset.quoteSymbol ?? '',
    status: asset.status,
    continueInvesting: asset.continueInvesting,
    tags: asset.tags.join('，'),
    referenceAnnualYield: asset.referenceAnnualYield == null ? '' : String(asset.referenceAnnualYield),
    units: asset.units == null ? '' : String(asset.units),
    currentAmount: asset.currentAmount == null ? '' : String(asset.currentAmount),
    totalCost: asset.totalCost == null ? '' : String(asset.totalCost),
    latestPrice: asset.latestPrice == null ? '' : String(asset.latestPrice),
    priceDate: asset.priceDate ?? todayDateISO(),
    priceDateLagBusinessDays: String(rule.priceDateLagBusinessDays),
    buyConfirmBusinessDays: String(rule.buyConfirmBusinessDays),
    sellConfirmBusinessDays: String(rule.sellConfirmBusinessDays),
    sellSettlementBusinessDays: String(rule.sellSettlementBusinessDays),
    dataSource: asset.dataSource ?? '',
    isManualData: asset.isManualData,
    costStatus: asset.costStatus,
    notes: asset.notes ?? '',
  };
}

function transactionToDraft(transaction: FinanceTransaction): TransactionDraft {
  return {
    id: transaction.id,
    dateTime: transaction.dateTime.slice(0, 16),
    assetId: transaction.assetId ?? '',
    platform: transaction.platform ?? '',
    type: transaction.type,
    units: transaction.units == null ? '' : String(transaction.units),
    price: transaction.price == null ? '' : String(transaction.price),
    amount: transaction.amount == null ? '' : String(transaction.amount),
    costAmount: transaction.costAmount == null ? '' : String(transaction.costAmount),
    currency: transaction.currency,
    fxRate: transaction.fxRate == null ? '' : String(transaction.fxRate),
    fee: transaction.fee == null ? '' : String(transaction.fee),
    feeCurrency: transaction.feeCurrency ?? transaction.currency,
    fromAssetId: transaction.fromAssetId ?? '',
    toAssetId: transaction.toAssetId ?? '',
    fromCurrency: transaction.fromCurrency ?? 'CNY',
    toCurrency: transaction.toCurrency ?? 'USD',
    toAmount: transaction.toAmount == null ? '' : String(transaction.toAmount),
    sourceCashAssetId: transaction.sourceCashAssetId ?? '',
    relatedTransactionIds: transaction.relatedTransactionIds.join(','),
    cashflowKind: transaction.cashflowKind ?? '',
    cashflowCategory: transaction.cashflowCategory ?? '',
    merchant: transaction.merchant ?? '',
    counterparty: transaction.counterparty ?? '',
    tags: (transaction.tags ?? []).join('，'),
    note: transaction.note ?? '',
    status: transaction.status,
  };
}

function planToDraft(plan: FinancePlan): PlanDraft {
  return {
    id: plan.id,
    assetId: plan.assetId ?? '',
    name: plan.name,
    amount: String(plan.amount),
    currency: plan.currency,
    frequency: plan.frequency,
    status: plan.status,
    startDate: plan.startDate ?? todayDateISO(),
    endDate: plan.endDate ?? '',
    expectedMonthlyAmount: plan.expectedMonthlyAmount == null ? '' : String(plan.expectedMonthlyAmount),
    note: plan.note ?? '',
  };
}

function MiniChart({ data, mode, hidden }: { data: Array<{ label: string; valueCny: number; percent: number }>; mode: 'pie' | 'bar'; hidden: boolean }) {
  if (!data.length) return <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-500">暂无可展示数据</div>;
  if (mode === 'bar') {
    return (
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.slice(0, 10)} margin={{ bottom: 36 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" angle={-24} height={58} interval={0} tick={{ fontSize: 11 }} textAnchor="end" />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip formatter={(value) => [hidden ? '••••' : `${Number(value).toFixed(2)} CNY`, '金额']} />
            <Bar dataKey="valueCny" radius={[6, 6, 0, 0]} fill="#2563eb" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data.slice(0, 10)} dataKey="valueCny" nameKey="label" innerRadius={48} outerRadius={88} paddingAngle={2}>
            {data.map((_, index) => <Cell key={index} fill={chartPalette[index % chartPalette.length]} />)}
          </Pie>
          <Tooltip formatter={(value) => [hidden ? '••••' : `${Number(value).toFixed(2)} CNY`, '金额']} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FinancePage() {
  const [hasVault, setHasVault] = useState(() => financeVaultExists());
  const [passphrase, setPassphrase] = useState(() => getRememberedFinancePassphrase());
  const [activePassphrase, setActivePassphrase] = useState('');
  const [data, setData] = useState<FinanceData | null>(null);
  const [toast, setToast] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [financeView, setFinanceView] = useState<FinanceView>('dashboard');
  const [assetDraft, setAssetDraft] = useState<AssetDraft>(() => emptyAssetDraft());
  const [transactionDraft, setTransactionDraft] = useState<TransactionDraft>(() => emptyTransactionDraft());
  const [planDraft, setPlanDraft] = useState<PlanDraft>(() => emptyPlanDraft());
  const [quickTradeDrafts, setQuickTradeDrafts] = useState<Record<string, QuickTradeDraft>>({});
  const [balanceSnapshotDrafts, setBalanceSnapshotDrafts] = useState<Record<string, BalanceSnapshotDraft>>({});
  const [assetLookupLoading, setAssetLookupLoading] = useState(false);
  const [assetFilter, setAssetFilter] = useState('all');
  const [transactionFrom, setTransactionFrom] = useState('');
  const [transactionTo, setTransactionTo] = useState('');
  const [manualQuoteAssetId, setManualQuoteAssetId] = useState('');
  const [manualQuotePrice, setManualQuotePrice] = useState('');
  const [manualQuoteDate, setManualQuoteDate] = useState(todayDateISO());
  const [manualRatePair, setManualRatePair] = useState<FinanceExchangeRate['pair']>('USD/CNY');
  const [manualRate, setManualRate] = useState('');
  const [manualRateDate, setManualRateDate] = useState(todayDateISO());
  const [quoteUpdating, setQuoteUpdating] = useState(false);
  const [quoteProgress, setQuoteProgress] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [cloudMeta, setCloudMeta] = useState<FinanceCloudVaultMeta | null>(null);
  const [syncError, setSyncError] = useState('');
  const [rememberedPassphraseSaved, setRememberedPassphraseSaved] = useState(() => Boolean(getRememberedFinancePassphrase()));
  const autoUpdateAttempted = useRef(false);
  const autoUnlockAttempted = useRef(false);
  const [reportKind, setReportKind] = useState<FinanceReportKind>('daily');
  const [reportOptions, setReportOptions] = useState<FinanceReportOptions>(() => defaultReportOptions('daily'));
  const [cashflowFrom, setCashflowFrom] = useState(() => `${todayDateISO().slice(0, 7)}-01`);
  const [cashflowTo, setCashflowTo] = useState(() => todayDateISO());
  const [bankImportResult, setBankImportResult] = useState<BankImportResult | null>(null);
  const [bankImportLoading, setBankImportLoading] = useState(false);

  const snapshot = useMemo(() => (data ? buildPortfolioSnapshot(data) : null), [data]);
  const cashflowAnalysis = useMemo(() => (data ? buildCashflowAnalysis(data, { from: cashflowFrom, to: cashflowTo }) : null), [cashflowFrom, cashflowTo, data]);
  const hidden = Boolean(data?.settings.amountHidden);
  const reportText = useMemo(() => (data && snapshot ? generateFinanceMarkdownReport(data, snapshot, reportOptions) : ''), [data, reportOptions, snapshot]);
  const activeAssets = data?.assets.filter((asset) => asset.status !== 'archived') ?? [];
  const cashAssets = activeAssets.filter((asset) => asset.assetType === 'CASH_CNY' || asset.assetType === 'CASH_USD');
  const encryptedVault = getEncryptedFinanceVault();
  const hasDirtyDraft = Boolean(
    data && (
      assetDraft.id || assetDraft.name.trim() || transactionDraft.id || transactionDraft.assetId || transactionDraft.amount || planDraft.id || planDraft.name.trim()
    ),
  );

  useUnsavedChangesPrompt(hasDirtyDraft, '理财页面有未保存的资产、交易或计划草稿，确认离开吗？');

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  };

  const rememberPassphrase = (value: string) => {
    if (!value.trim()) return;
    setRememberedFinancePassphrase(value);
    setRememberedPassphraseSaved(true);
  };

  const clearLocalRememberedPassphrase = () => {
    clearRememberedFinancePassphrase();
    setRememberedPassphraseSaved(false);
    setPassphrase('');
    if (!data) setActivePassphrase('');
    showToast('已清除本机记住的理财口令');
  };

  const persist = async (next: FinanceData) => {
    if (!activePassphrase) return;
    const normalized = { ...ensureTrackingStartBaselines(next), updatedAt: nowISO() };
    setData(normalized);
    await saveFinanceVault(normalized, activePassphrase);
  };

  const createVault = async () => {
    const nextPassphrase = passphrase;
    if (nextPassphrase.trim().length < 8) {
      setUnlockError('请设置至少 8 位的本地加密口令。');
      return;
    }
    const empty = ensureTrackingStartBaselines(createEmptyFinanceData());
    await saveFinanceVault(empty, nextPassphrase);
    rememberPassphrase(nextPassphrase);
    setActivePassphrase(nextPassphrase);
    setData(empty);
    setHasVault(true);
    setUnlockError('');
    showToast('本地加密理财保险箱已创建');
  };

  const unlockVault = async (overridePassphrase = passphrase) => {
    const nextPassphrase = overridePassphrase;
    setSyncing(true);
    setSyncError('');
    setUnlockError('');
    try {
      const localVault = getEncryptedFinanceVault();
      if (!localVault) {
        setUnlockError('本地没有理财密文。请点击“从服务器同步”，或创建新的本地保险箱。');
        return;
      }
      const localData = ensureTrackingStartBaselines(await decryptFinanceVault(localVault, nextPassphrase));
      const cloud = await getCloudFinanceVault();
      setCloudMeta(cloud.meta);
      if (cloud.vault && cloud.vault.updatedAt > localVault.updatedAt) {
        const cloudData = ensureTrackingStartBaselines(await decryptFinanceVault(cloud.vault, nextPassphrase));
        setEncryptedFinanceVault(cloud.vault);
        rememberPassphrase(nextPassphrase);
        setPassphrase(nextPassphrase);
        setActivePassphrase(nextPassphrase);
        setData(cloudData);
        setHasVault(true);
        showToast('云端理财数据较新，已先同步再打开');
        return;
      }
      rememberPassphrase(nextPassphrase);
      setPassphrase(nextPassphrase);
      setActivePassphrase(nextPassphrase);
      setData(localData);
      setHasVault(true);
      setUnlockError('');
      showToast(cloud.vault ? '已确认云端无更新，打开本地理财数据' : '云端暂无密文，打开本地理财数据');
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
      setUnlockError('解锁失败：无法确认云端最新数据，或理财加密口令不正确。');
    } finally {
      setSyncing(false);
    }
  };

  const importFinanceFile = async (file?: File) => {
    if (!file || !data) return;
    try {
      const imported = normalizeImportedFinanceData(JSON.parse(await file.text()));
      const confirmed = data.assets.length || data.transactions.length ? confirm('导入会替换当前理财数据。继续吗？') : true;
      if (!confirmed) return;
      await persist(imported);
      showToast('理财数据已导入本地密文保险箱');
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    }
  };

  const importIcbcStatementPdf = async (file?: File) => {
    if (!file || !data) return;
    setBankImportLoading(true);
    try {
      const text = await extractPdfTextFromFile(file);
      const result = parseIcbcStatementText(text);
      setBankImportResult(result);
      const importedTransactions = bankRowsToFinanceTransactions(result.transactions, data.transactions);
      if (!importedTransactions.length) {
        alert(result.transactions.length ? '没有发现新的可导入流水，可能已经导入过。' : '没有从 PDF 中识别到工行流水。');
        return;
      }
      const confirmed = confirm(`识别到 ${result.transactions.length} 条工行流水，将导入 ${importedTransactions.length} 条新流水。继续吗？`);
      if (!confirmed) return;
      await persist({ ...data, transactions: [...data.transactions, ...importedTransactions] });
      setFinanceView('cashflow');
      showToast(`已导入 ${importedTransactions.length} 条工行流水`);
    } catch (error) {
      alert(error instanceof Error ? error.message : String(error));
    } finally {
      setBankImportLoading(false);
    }
  };

  const saveAsset = async () => {
    if (!data || !assetDraft.name.trim()) return alert('请填写资产名称。');
    const timestamp = nowISO();
    const existingAsset = data.assets.find((asset) => asset.id === assetDraft.id);
    const currentAmount = numberOrNull(assetDraft.currentAmount);
    const latestPrice = numberOrNull(assetDraft.latestPrice);
    const units = numberOrNull(assetDraft.units);
    const assetType = assetDraft.assetType;
    const balanceIncomeAsset = isBalanceIncomeAssetType(assetType);
    const effectiveLatestPrice = latestPrice ?? (balanceIncomeAsset && currentAmount !== null ? 1 : null);
    const effectiveUnits = units ?? (balanceIncomeAsset && currentAmount !== null ? currentAmount : null);
    const draftRuleFallback = defaultTradeRuleForAsset({ assetType, quoteProvider: assetDraft.quoteProvider });
    const tradeRule: FinanceTradeRule = {
      priceDateLagBusinessDays: Math.max(0, Math.trunc(numberOrZero(assetDraft.priceDateLagBusinessDays || String(draftRuleFallback.priceDateLagBusinessDays)))),
      buyConfirmBusinessDays: Math.max(0, Math.trunc(numberOrZero(assetDraft.buyConfirmBusinessDays || String(draftRuleFallback.buyConfirmBusinessDays)))),
      sellConfirmBusinessDays: Math.max(0, Math.trunc(numberOrZero(assetDraft.sellConfirmBusinessDays || String(draftRuleFallback.sellConfirmBusinessDays)))),
      sellSettlementBusinessDays: Math.max(0, Math.trunc(numberOrZero(assetDraft.sellSettlementBusinessDays || String(draftRuleFallback.sellSettlementBusinessDays)))),
      cutoffTime: draftRuleFallback.cutoffTime,
      description: draftRuleFallback.description,
    };
    const trackingBaselineAmount = existingAsset?.trackingBaselineAmount ?? currentAmount;
    const trackingBaselineUnits =
      existingAsset?.trackingBaselineUnits ??
      effectiveUnits ??
      (typeof trackingBaselineAmount === 'number' && typeof effectiveLatestPrice === 'number' && effectiveLatestPrice > 0 ? roundMoney(trackingBaselineAmount / effectiveLatestPrice, 6) : null);
    const nextAsset: FinanceAsset = {
      id: assetDraft.id ?? newFinanceId('asset'),
      name: assetDraft.name.trim(),
      symbol: assetDraft.symbol.trim() || undefined,
      platform: assetDraft.platform.trim() || undefined,
      assetType,
      groupId: assetDraft.groupId,
      riskBucket: assetDraft.riskBucket,
      marketExposure: assetDraft.marketExposure,
      currency: assetDraft.currency,
      quoteProvider: assetDraft.quoteProvider,
      quoteSymbol: assetDraft.quoteSymbol.trim() || assetDraft.symbol.trim() || undefined,
      status: assetDraft.status,
      continueInvesting: assetDraft.continueInvesting,
      tags: assetDraft.tags.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
      referenceAnnualYield: numberOrNull(assetDraft.referenceAnnualYield),
      units: effectiveUnits,
      currentAmount,
      totalCost: existingAsset?.totalCost ?? null,
      trackingStartDate: existingAsset?.trackingStartDate ?? data.settings.performanceStartDate ?? todayDateISO(),
      trackingBaselineAmount,
      trackingBaselineUnits,
      tradeRule,
      latestPrice: effectiveLatestPrice,
      priceDate: assetDraft.priceDate || undefined,
      dataSource: assetDraft.dataSource.trim() || undefined,
      isManualData: assetDraft.isManualData,
      costStatus: existingAsset?.costStatus ?? 'complete',
      notes: assetDraft.notes.trim() || undefined,
      createdAt: existingAsset?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await persist({ ...data, assets: [...data.assets.filter((asset) => asset.id !== nextAsset.id), nextAsset] });
    setAssetDraft(emptyAssetDraft());
    showToast('资产已保存');
  };

  const archiveAsset = async (asset: FinanceAsset) => {
    if (!data) return;
    await persist({ ...data, assets: data.assets.map((item) => (item.id === asset.id ? { ...item, status: 'archived', updatedAt: nowISO() } : item)) });
    showToast('资产已归档');
  };

  const removeAsset = async (asset: FinanceAsset) => {
    if (!data || !confirm(`确认删除资产「${asset.name}」？相关交易不会自动删除。`)) return;
    await persist({ ...data, assets: data.assets.filter((item) => item.id !== asset.id) });
    showToast('资产已删除');
  };

  const saveTransaction = async () => {
    if (!data) return;
    if (transactionDraft.type !== 'FX_CONVERSION' && !transactionDraft.assetId) return alert('请选择资产。');
    const timestamp = nowISO();
    const existingTransaction = data.transactions.find((transaction) => transaction.id === transactionDraft.id);
    const nextTransaction: FinanceTransaction = {
      ...existingTransaction,
      id: transactionDraft.id ?? newFinanceId('txn'),
      dateTime: new Date(transactionDraft.dateTime).toISOString(),
      assetId: transactionDraft.assetId || undefined,
      platform: transactionDraft.platform.trim() || undefined,
      type: transactionDraft.type,
      units: numberOrNull(transactionDraft.units),
      price: numberOrNull(transactionDraft.price),
      amount: numberOrNull(transactionDraft.amount),
      costAmount: numberOrNull(transactionDraft.costAmount),
      currency: transactionDraft.currency,
      fxRate: numberOrNull(transactionDraft.fxRate),
      fee: numberOrNull(transactionDraft.fee),
      feeCurrency: transactionDraft.feeCurrency,
      fromAssetId: transactionDraft.fromAssetId || undefined,
      toAssetId: transactionDraft.toAssetId || undefined,
      fromCurrency: transactionDraft.fromCurrency,
      toCurrency: transactionDraft.toCurrency,
      toAmount: numberOrNull(transactionDraft.toAmount),
      sourceCashAssetId: transactionDraft.sourceCashAssetId || undefined,
      relatedTransactionIds: transactionDraft.relatedTransactionIds.split(',').map((item) => item.trim()).filter(Boolean),
      cashflowKind: transactionDraft.cashflowKind || undefined,
      cashflowCategory: transactionDraft.cashflowCategory || undefined,
      merchant: transactionDraft.merchant.trim() || undefined,
      counterparty: transactionDraft.counterparty.trim() || undefined,
      tags: transactionDraft.tags.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
      note: transactionDraft.note.trim() || undefined,
      status: transactionDraft.status,
      createdAt: existingTransaction?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await persist({ ...data, transactions: [...data.transactions.filter((transaction) => transaction.id !== nextTransaction.id), nextTransaction] });
    setTransactionDraft(emptyTransactionDraft());
    showToast('交易已保存');
  };

  const updateQuickTradeDraft = (assetId: string, patch: Partial<QuickTradeDraft>) => {
    setQuickTradeDrafts((previous) => ({
      ...previous,
      [assetId]: { ...(previous[assetId] ?? emptyQuickTradeDraft()), ...patch },
    }));
  };

  const updateBalanceSnapshotDraft = (assetId: string, patch: Partial<BalanceSnapshotDraft>) => {
    setBalanceSnapshotDrafts((previous) => ({
      ...previous,
      [assetId]: { ...(previous[assetId] ?? emptyBalanceSnapshotDraft()), ...patch },
    }));
  };

  const lookupAssetByCode = async () => {
    const code = assetDraft.symbol.trim() || assetDraft.quoteSymbol.trim();
    const keyword = [code, assetDraft.name, assetDraft.notes].filter(Boolean).join(' ');
    const template = manualIncomeAssetTemplate(keyword);
    const applyTemplate = (patch: Partial<AssetDraft>, message: string) => {
      const assetType = patch.assetType ?? assetDraft.assetType;
      const quoteProvider = patch.quoteProvider ?? assetDraft.quoteProvider;
      const rule = defaultTradeRuleForAsset({ assetType, quoteProvider });
      setAssetDraft({
        ...assetDraft,
        ...patch,
        priceDateLagBusinessDays: String(rule.priceDateLagBusinessDays),
        buyConfirmBusinessDays: String(rule.buyConfirmBusinessDays),
        sellConfirmBusinessDays: String(rule.sellConfirmBusinessDays),
        sellSettlementBusinessDays: String(rule.sellSettlementBusinessDays),
      });
      showToast(message);
    };
    if (template && (/230713|高盛|工银|盛景/i.test(keyword) || !/^\d{6}$/.test(code))) {
      applyTemplate(template, '已按手动理财/生息资产模板补齐');
      return;
    }
    if (!/^\d{6}$/.test(code)) return alert('请输入 6 位基金代码；高盛工银、USDT/USDC 活期等非公募产品会按手动余额模板补齐。');
    setAssetLookupLoading(true);
    try {
      const quote = await fetchPublicFundQuoteByCode(code, undefined, true);
      const inferred = inferAssetDraftFromFundName(quote.name || assetDraft.name);
      const rule = defaultTradeRuleForAsset({ assetType: inferred.assetType, quoteProvider: 'eastmoney-fund' });
      const source = [quote.source, quote.fundType, quote.fundCompany].filter(Boolean).join('；');
      setAssetDraft({
        ...assetDraft,
        ...inferred,
        name: quote.name || assetDraft.name || `基金 ${code}`,
        symbol: code,
        quoteSymbol: code,
        quoteProvider: 'eastmoney-fund',
        latestPrice: String(quote.price),
        priceDate: quote.priceDate,
        dataSource: source || quote.source,
        isManualData: false,
        priceDateLagBusinessDays: String(rule.priceDateLagBusinessDays),
        buyConfirmBusinessDays: String(rule.buyConfirmBusinessDays),
        sellConfirmBusinessDays: String(rule.sellConfirmBusinessDays),
        sellSettlementBusinessDays: String(rule.sellSettlementBusinessDays),
      });
      showToast(quote.name ? '已按基金代码补齐名称、类型和最新净值' : '已按基金代码补齐最新净值，名称仍需手动确认');
    } catch (error) {
      if (template) {
        applyTemplate(template, '公开基金查询失败，已改用手动理财/生息资产模板');
        return;
      }
      alert(`自动补齐失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAssetLookupLoading(false);
    }
  };

  const resolveTradePrice = async (holding: FinanceHoldingSnapshot, priceDate: string, manualPrice: number | null) => {
    if (manualPrice !== null && manualPrice > 0) return { price: manualPrice, priceDate, source: '手动输入价格' };
    const { asset } = holding;
    const code = asset.quoteSymbol || asset.symbol;
    if (asset.quoteProvider === 'eastmoney-fund' && code) {
      try {
        const quote = await fetchPublicFundQuoteByCode(code, priceDate);
        if (quote.price > 0) return { price: quote.price, priceDate: quote.priceDate, source: quote.source };
      } catch {
        // Fall back to the latest visible quote below and keep the estimate explicitly noted.
      }
    }
    const fallbackPrice = quotePriceForHolding(holding);
    if (fallbackPrice === null) return null;
    return { price: fallbackPrice, priceDate: holding.quote?.priceDate ?? asset.priceDate ?? priceDate, source: '当前可用净值/价格估算' };
  };

  const recordQuickTrade = async (holding: FinanceHoldingSnapshot) => {
    if (!data) return;
    const draft = quickTradeDrafts[holding.asset.id] ?? emptyQuickTradeDraft();
    const amount = numberOrNull(draft.amount);
    if (amount === null || amount <= 0) return alert('请填写有效的买入/卖出金额。');
    const tradeDate = draft.tradeDate || todayDateISO();
    const tradeDates = tradeDatesFor(holding.asset, draft.type, tradeDate);
    const resolvedPrice = await resolveTradePrice(holding, tradeDates.priceDate, numberOrNull(draft.price));
    if (!resolvedPrice || resolvedPrice.price <= 0) return alert('缺少可用于估算份额的净值/价格，请先更新行情或手动输入价格。');
    const price = resolvedPrice.price;
    const fee = numberOrNull(draft.fee) ?? 0;
    const units = roundMoney(amount / price, 6);
    const timestamp = nowISO();
    const isConfirmed = tradeDates.confirmDate <= todayDateISO();
    const transaction: FinanceTransaction = {
      id: newFinanceId('txn'),
      dateTime: new Date(`${tradeDate}T15:00`).toISOString(),
      assetId: holding.asset.id,
      platform: holding.asset.platform,
      type: draft.type,
      units,
      price,
      amount,
      costAmount: null,
      currency: holding.asset.currency,
      fee,
      feeCurrency: holding.asset.currency,
      sourceCashAssetId: draft.type === 'BUY' ? draft.sourceCashAssetId || undefined : draft.sourceCashAssetId || undefined,
      relatedTransactionIds: [],
      tradeDate,
      priceDate: resolvedPrice.priceDate,
      confirmDate: tradeDates.confirmDate,
      settlementDate: tradeDates.settlementDate,
      estimatedByRule: true,
      note: `${draft.note.trim() ? `${draft.note.trim()}；` : ''}交易日 ${tradeDate}，按 ${resolvedPrice.source} ${price}（净值日期 ${resolvedPrice.priceDate}）估算份额 ${units}；规则：${tradeDates.rule.description ?? ''}，预计确认日 ${tradeDates.confirmDate}${tradeDates.settlementDate ? `，预计到账日 ${tradeDates.settlementDate}` : ''}。`,
      status: isConfirmed ? 'confirmed' : 'pending',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await persist({ ...data, transactions: [...data.transactions, transaction] });
    setQuickTradeDrafts((previous) => ({ ...previous, [holding.asset.id]: emptyQuickTradeDraft() }));
    showToast(`${draft.type === 'BUY' ? '买入' : '卖出'}已记录，份额已按规则估算${isConfirmed ? '' : '，等待确认日'}`);
  };

  const recordBalanceSnapshot = async (holding: FinanceHoldingSnapshot) => {
    if (!data) return;
    const draft = balanceSnapshotDrafts[holding.asset.id] ?? emptyBalanceSnapshotDraft();
    const beforeBalance = numberOrNull(draft.beforeBalance);
    const afterBalance = numberOrNull(draft.afterBalance);
    if (beforeBalance === null || afterBalance === null) return alert('请填写前后余额。');
    const diff = roundMoney(afterBalance - beforeBalance, 6);
    const timestamp = nowISO();
    const balanceIncomeAsset = isBalanceIncomeAssetType(holding.asset.assetType);
    const transaction: FinanceTransaction = {
      id: newFinanceId('txn'),
      dateTime: new Date(`${draft.date || todayDateISO()}T20:00`).toISOString(),
      assetId: holding.asset.id,
      platform: holding.asset.platform,
      type: diff >= 0 ? 'INTEREST' : 'FEE',
      units: balanceIncomeAsset ? diff : null,
      price: balanceIncomeAsset ? 1 : null,
      amount: Math.abs(diff),
      costAmount: null,
      currency: holding.asset.currency,
      fee: diff < 0 ? Math.abs(diff) : null,
      feeCurrency: holding.asset.currency,
      relatedTransactionIds: [],
      tradeDate: draft.date || todayDateISO(),
      note: `${draft.note.trim() ? `${draft.note.trim()}；` : ''}余额快照对比：${beforeBalance} -> ${afterBalance} ${holding.asset.currency}，差额 ${diff}。适用于无本金变动时的真实收益/扣费记录。`,
      status: 'confirmed',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const nextAsset: FinanceAsset = {
      ...holding.asset,
      currentAmount: afterBalance,
      units: balanceIncomeAsset ? afterBalance : holding.asset.units,
      latestPrice: balanceIncomeAsset ? 1 : holding.asset.latestPrice,
      priceDate: draft.date || todayDateISO(),
      dataSource: '手动余额快照对比',
      isManualData: true,
      updatedAt: timestamp,
    };
    await persist({
      ...data,
      assets: data.assets.map((asset) => (asset.id === nextAsset.id ? nextAsset : asset)),
      transactions: diff === 0 ? data.transactions : [...data.transactions, transaction],
    });
    setBalanceSnapshotDrafts((previous) => ({ ...previous, [holding.asset.id]: emptyBalanceSnapshotDraft() }));
    showToast(diff === 0 ? '余额已更新，未产生收益差额' : '余额快照已记录为真实收益/扣费');
  };

  const recordYieldIncome = async (holding: FinanceHoldingSnapshot) => {
    if (!data) return;
    const draft = balanceSnapshotDrafts[holding.asset.id] ?? emptyBalanceSnapshotDraft();
    const incomeAmount = numberOrNull(draft.incomeAmount);
    if (incomeAmount === null || incomeAmount <= 0) return alert('请填写实际到账的利息/奖励金额。');
    const afterBalance = numberOrNull(draft.afterBalance);
    const currentBalance = holding.nativeMarketValue ?? holding.asset.currentAmount ?? holding.units ?? 0;
    const nextBalance = afterBalance ?? roundMoney(currentBalance + incomeAmount, 6);
    const timestamp = nowISO();
    const transactionType: FinanceTransaction['type'] = holding.asset.assetType === 'CRYPTO_STABLECOIN_EARN' ? 'REWARD' : 'INTEREST';
    const transaction: FinanceTransaction = {
      id: newFinanceId('txn'),
      dateTime: new Date(`${draft.date || todayDateISO()}T20:00`).toISOString(),
      assetId: holding.asset.id,
      platform: holding.asset.platform,
      type: transactionType,
      units: isBalanceIncomeAssetType(holding.asset.assetType) ? incomeAmount : null,
      price: isBalanceIncomeAssetType(holding.asset.assetType) ? 1 : null,
      amount: incomeAmount,
      costAmount: null,
      currency: holding.asset.currency,
      fee: null,
      feeCurrency: holding.asset.currency,
      relatedTransactionIds: [],
      tradeDate: draft.date || todayDateISO(),
      note: `${draft.note.trim() ? `${draft.note.trim()}；` : ''}实际到账${transactionType === 'REWARD' ? '奖励' : '利息'} ${incomeAmount} ${holding.asset.currency}，录入后余额 ${nextBalance}。参考年化只展示，不参与收益计算。`,
      status: 'confirmed',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const nextAsset: FinanceAsset = {
      ...holding.asset,
      currentAmount: nextBalance,
      units: isBalanceIncomeAssetType(holding.asset.assetType) ? nextBalance : holding.asset.units,
      latestPrice: isBalanceIncomeAssetType(holding.asset.assetType) ? 1 : holding.asset.latestPrice,
      priceDate: draft.date || todayDateISO(),
      dataSource: '手动生息/余额录入',
      isManualData: true,
      updatedAt: timestamp,
    };
    await persist({
      ...data,
      assets: data.assets.map((asset) => (asset.id === nextAsset.id ? nextAsset : asset)),
      transactions: [...data.transactions, transaction],
    });
    setBalanceSnapshotDrafts((previous) => ({ ...previous, [holding.asset.id]: emptyBalanceSnapshotDraft() }));
    showToast('实际利息/奖励已记录，余额已更新');
  };

  const cancelTransaction = async (transaction: FinanceTransaction) => {
    if (!data) return;
    await persist({ ...data, transactions: data.transactions.map((item) => (item.id === transaction.id ? { ...item, status: 'cancelled', updatedAt: nowISO() } : item)) });
    showToast('交易已撤销');
  };

  const deleteTransaction = async (transaction: FinanceTransaction) => {
    if (!data || !confirm('确认永久删除这条交易吗？')) return;
    await persist({ ...data, transactions: data.transactions.filter((item) => item.id !== transaction.id) });
    showToast('交易已删除');
  };

  const savePlan = async () => {
    if (!data || !planDraft.name.trim()) return alert('请填写计划名称。');
    const timestamp = nowISO();
    const nextPlan: FinancePlan = {
      id: planDraft.id ?? newFinanceId('plan'),
      assetId: planDraft.assetId || undefined,
      name: planDraft.name.trim(),
      amount: numberOrZero(planDraft.amount),
      currency: planDraft.currency,
      frequency: planDraft.frequency.trim() || '每月',
      status: planDraft.status,
      startDate: planDraft.startDate || undefined,
      endDate: planDraft.endDate || undefined,
      expectedMonthlyAmount: numberOrNull(planDraft.expectedMonthlyAmount),
      note: planDraft.note.trim() || undefined,
      createdAt: data.plans.find((plan) => plan.id === planDraft.id)?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await persist({ ...data, plans: [...data.plans.filter((plan) => plan.id !== nextPlan.id), nextPlan] });
    setPlanDraft(emptyPlanDraft());
    showToast('计划已保存');
  };

  const saveTarget = async (target: FinanceAllocationTarget) => {
    if (!data) return;
    await persist({ ...data, targets: data.targets.map((item) => (item.id === target.id ? target : item)) });
    showToast('目标配置已保存');
  };

  const updateManualQuote = async () => {
    if (!data) return;
    const asset = data.assets.find((item) => item.id === manualQuoteAssetId);
    const price = numberOrNull(manualQuotePrice);
    if (!asset || price === null || price <= 0) return alert('请选择资产并填写有效价格/净值。');
    await persist({ ...data, quotes: { ...data.quotes, [asset.id]: manualAssetQuote(asset, price, manualQuoteDate, '手动录入', data.quotes[asset.id]) } });
    setManualQuotePrice('');
    showToast('手动价格已保存');
  };

  const updateManualRate = async () => {
    if (!data) return;
    const rate = numberOrNull(manualRate);
    if (rate === null || rate <= 0) return alert('请填写有效汇率。');
    await persist({ ...data, exchangeRates: { ...data.exchangeRates, [manualRatePair]: manualExchangeRate(manualRatePair, rate, manualRateDate, data.exchangeRates[manualRatePair]) } });
    setManualRate('');
    showToast('手动汇率已保存');
  };

  const updateQuotes = async (silent = false) => {
    if (!data) return;
    setQuoteUpdating(true);
    setQuoteProgress('准备更新公开行情');
    try {
      const next = await updatePublicFinanceQuotes(data, (progress) => {
        setQuoteProgress(`${progress.label}（${progress.current}/${progress.total}）`);
      });
      next.settings = { ...next.settings, lastAutoQuoteUpdateDate: todayDateISO() };
      setQuoteProgress('正在保存加密数据');
      await persist(next);
      if (!silent) showToast('公开行情更新完成');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(`行情更新中断：${message}`);
    } finally {
      setQuoteUpdating(false);
      setQuoteProgress('');
    }
  };

  const downloadCloudToLocal = async (overridePassphrase = passphrase) => {
    const nextPassphrase = overridePassphrase;
    if (nextPassphrase.trim().length < 1) {
      setUnlockError('请输入理财加密口令后再从服务器同步。');
      return;
    }
    setSyncing(true);
    setSyncError('');
    setUnlockError('');
    try {
      const cloud = await getCloudFinanceVault();
      setCloudMeta(cloud.meta);
      if (!cloud.vault) {
        setUnlockError('服务器上还没有理财密文。请先在已有数据的设备上上传一次。');
        return;
      }
      const decrypted = ensureTrackingStartBaselines(await decryptFinanceVault(cloud.vault, nextPassphrase));
      setEncryptedFinanceVault(cloud.vault);
      rememberPassphrase(nextPassphrase);
      setPassphrase(nextPassphrase);
      setActivePassphrase(nextPassphrase);
      setData(decrypted);
      setHasVault(true);
      showToast('已从服务器下载密文并在本地解密');
    } catch (error) {
      setUnlockError('从服务器同步失败：请确认已登录网站写入权限账号，并检查理财加密口令。');
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  };

  const refreshCloudStatus = async () => {
    setSyncing(true);
    setSyncError('');
    try {
      const cloud = await getCloudFinanceVault();
      setCloudMeta(cloud.meta);
      showToast(cloud.meta ? '已读取云端密文状态' : '云端还没有理财密文');
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  };

  const uploadEncryptedVault = async () => {
    const localVault = getEncryptedFinanceVault();
    if (!localVault) return alert('本地还没有可上传的加密数据。');
    if (cloudMeta?.clientUpdatedAt && cloudMeta.clientUpdatedAt > localVault.updatedAt) {
      const overwrite = confirm('云端密文看起来比本地更新，仍要用本地密文覆盖云端吗？');
      if (!overwrite) return;
    }
    setSyncing(true);
    setSyncError('');
    try {
      const vaultToUpload = data && activePassphrase ? await saveFinanceVault(data, activePassphrase) : localVault;
      const result = await uploadCloudFinanceVault(vaultToUpload, getFinanceDeviceId());
      setCloudMeta(result.meta);
      showToast('本地加密数据已上传到服务器');
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  };

  const downloadEncryptedVault = async () => {
    setSyncing(true);
    setSyncError('');
    try {
      const cloud = await getCloudFinanceVault();
      setCloudMeta(cloud.meta);
      if (!cloud.vault) {
        alert('云端还没有可下载的理财密文。');
        return;
      }
      const localVault = getEncryptedFinanceVault();
      if (localVault?.updatedAt && localVault.updatedAt > cloud.vault.updatedAt) {
        const overwrite = confirm('本地密文看起来比云端更新，仍要用云端密文覆盖本地吗？');
        if (!overwrite) return;
      }
      const decrypted = ensureTrackingStartBaselines(await decryptFinanceVault(cloud.vault, activePassphrase));
      setEncryptedFinanceVault(cloud.vault);
      setData(decrypted);
      showToast('已下载云端密文并在本地解密');
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  };

  const deleteAllFinanceData = async () => {
    const firstConfirm = confirm('这会彻底删除当前浏览器中的理财保险箱，并删除服务器上的云端密文。删除后只能靠你此前导出的 JSON 备份恢复。继续吗？');
    if (!firstConfirm) return;
    const typedPassphrase = prompt('请输入当前理财加密口令，确认彻底删除本地和云端理财数据：');
    if (typedPassphrase === null) return;
    if (typedPassphrase !== activePassphrase) {
      alert('口令不正确，已取消删除。');
      return;
    }
    setSyncing(true);
    setSyncError('');
    try {
      const result = await deleteCloudFinanceVault();
      setCloudMeta(result.meta);
      deleteFinanceVault();
      clearRememberedFinancePassphrase();
      setData(null);
      setActivePassphrase('');
      setHasVault(false);
      setRememberedPassphraseSaved(false);
      setPassphrase('');
      setQuickTradeDrafts({});
      setBalanceSnapshotDrafts({});
      showToast('本地与云端理财密文已彻底删除');
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : String(error));
      alert('云端删除失败，本地数据未删除。请确认已在部署站点登录写入权限后重试。');
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (data || autoUnlockAttempted.current) return;
    const savedPassphrase = getRememberedFinancePassphrase();
    if (!savedPassphrase) return;
    autoUnlockAttempted.current = true;
    const timeoutId = window.setTimeout(() => {
      if (financeVaultExists()) {
        void unlockVault(savedPassphrase);
      } else {
        void downloadCloudToLocal(savedPassphrase);
      }
    }, 0);
    return () => window.clearTimeout(timeoutId);
    // The remembered local key should only attempt one auto verification per page entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, hasVault]);

  useEffect(() => {
    if (!data || autoUpdateAttempted.current || !data.settings.dailyAutoUpdate) return;
    if (data.settings.lastAutoQuoteUpdateDate === todayDateISO()) return;
    autoUpdateAttempted.current = true;
    const timeoutId = window.setTimeout(() => void updateQuotes(true), 0);
    return () => window.clearTimeout(timeoutId);
    // The auto update should run once for the unlocked data snapshot of the day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const filteredHoldings = (snapshot?.holdings ?? []).filter((holding) => assetFilter === 'all' || holding.asset.groupId === assetFilter);
  const filteredTransactions = (data?.transactions ?? [])
    .filter((transaction) => !transactionFrom || transaction.dateTime.slice(0, 10) >= transactionFrom)
    .filter((transaction) => !transactionTo || transaction.dateTime.slice(0, 10) <= transactionTo)
    .sort((a, b) => b.dateTime.localeCompare(a.dateTime));
  const stablecoinRateFor = (currency: FinanceCurrency) => {
    if (currency === 'USDT') return data?.exchangeRates['USDT/CNY'] ?? null;
    if (currency === 'USDC') return data?.exchangeRates['USDC/CNY'] ?? null;
    return null;
  };

  const updateReportKind = (kind: FinanceReportKind) => {
    setReportKind(kind);
    setReportOptions(defaultReportOptions(kind));
  };

  if (!data) {
    return (
      <Page title="理财" subtitle="本地加密的个人资产记录与分析工具">
        <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
          <section className="card p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-1 text-blue-700" size={22} />
              <div>
                <h2 className="text-lg font-semibold text-slate-950">隐私模式</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  理财数据先在当前浏览器本地加密；需要多设备使用时，只把 AES-GCM 密文同步到服务器，不上传明文资产。行情更新只请求公开净值、汇率和价格。
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto]">
              <label>
                <span className="label">本地加密口令</span>
                <input className="field" type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void (hasVault ? unlockVault() : createVault()); }} />
              </label>
              <div className="flex flex-wrap items-end gap-2">
                <button className="btn btn-primary w-full md:w-auto" onClick={() => void (hasVault ? unlockVault() : createVault())}>
                  <LockKeyhole size={16} />{hasVault ? '解锁' : '创建'}
                </button>
                <button className="btn btn-soft w-full md:w-auto" disabled={syncing} onClick={() => void downloadCloudToLocal()}>
                  <Download size={16} />从服务器同步
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <span>{rememberedPassphraseSaved ? '本机已记住理财口令，进入页面会自动验证并先检查云端是否有更新。' : '解锁或从服务器同步成功后，会在当前浏览器本地记住口令。'}</span>
              {rememberedPassphraseSaved ? (
                <button className="btn btn-soft" type="button" onClick={clearLocalRememberedPassphrase}>
                  <Trash2 size={16} />清除本机口令
                </button>
              ) : null}
            </div>
            {unlockError ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{unlockError}</p> : null}
            {syncError ? <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">接口返回：{syncError}</p> : null}
          </section>
          <section className="card p-5">
            <h2 className="text-base font-semibold text-slate-950">安全边界</h2>
            <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
              <p>不保存银行、支付宝、基金平台、交易所登录密码，不保存验证码、私钥、助记词或交易权限 API Key。</p>
              <p>美元理财和稳定币平台收益只接受手动录入的余额、利息或奖励交易，不用展示 APR 伪造收益。</p>
              <p>第一次有数据的设备需要创建保险箱并上传密文；之后其他设备打开网站，输入同一个理财口令，点击“从服务器同步”即可。</p>
            </div>
          </section>
        </div>
        <Toast message={toast} />
      </Page>
    );
  }

  return (
    <Page title="理财" subtitle="个人资产记录与分析工具；不是交易系统，不提供自动下单能力。">
      <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800">
        这不是实时账户余额，仅基于公开行情和手动录入数据估算。页面不再追溯历史成本价，默认从今日起算；份额、净值、汇率或费率不足时会标记为待补充。
      </div>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1">
          {financeViews.map((view) => (
            <button
              key={view.id}
              className={`whitespace-nowrap rounded-md px-3 py-2 text-sm font-semibold transition ${financeView === view.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
              onClick={() => setFinanceView(view.id)}
            >
              {view.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-soft" onClick={() => void persist({ ...data, settings: { ...data.settings, amountHidden: !hidden } })}>
            {hidden ? <Eye size={16} /> : <EyeOff size={16} />}{hidden ? '显示金额' : '隐藏金额'}
          </button>
          <button className="btn btn-soft" disabled={quoteUpdating} onClick={() => void updateQuotes(false)}>
            <RefreshCw size={16} className={quoteUpdating ? 'animate-spin' : ''} />立即更新行情
          </button>
        </div>
      </div>

      {quoteProgress ? (
        <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-800">
          {quoteProgress}
        </div>
      ) : null}

      {bankImportLoading || bankImportResult ? (
        <div className="mb-5 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {bankImportLoading
            ? '正在解析工行流水 PDF...'
            : `最近一次 PDF 解析：识别 ${bankImportResult?.transactions.length ?? 0} 条流水，跳过 ${bankImportResult?.skippedLines.length ?? 0} 行。`}
        </div>
      ) : null}

      {financeView === 'sync' ? (
      <section className="mb-5 card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">服务器加密同步</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              上传到服务器的只有 AES-GCM 密文、salt、iv 和 KDF 参数；服务器不保存口令，也看不到资产明细。下载时会先用当前口令在本地解密，成功后才覆盖本地数据。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="btn btn-soft cursor-pointer"><UploadCloud size={16} />导入初始化/备份 JSON<input className="hidden" type="file" accept="application/json" onChange={(event) => void importFinanceFile(event.target.files?.[0])} /></label>
            <label className="btn btn-soft cursor-pointer"><FileText size={16} />导入工行流水 PDF<input className="hidden" type="file" accept="application/pdf" onChange={(event) => void importIcbcStatementPdf(event.target.files?.[0])} /></label>
            <button className="btn btn-soft" onClick={() => downloadBlob(`finance-backup-${todayDateISO()}.json`, exportFinanceJson(data), 'application/json')}>
              <FileJson size={16} />导出 JSON
            </button>
            <button className="btn btn-soft" onClick={() => downloadBlob(`finance-transactions-${todayDateISO()}.csv`, exportTransactionsCsv(data), 'text/csv;charset=utf-8')}>
              <Download size={16} />交易 CSV
            </button>
            <button className="btn btn-soft" disabled={syncing} onClick={() => void refreshCloudStatus()}><RefreshCw size={16} />刷新云端状态</button>
            <button className="btn btn-primary" disabled={syncing} onClick={() => void uploadEncryptedVault()}><UploadCloud size={16} />上传本地密文</button>
            <button className="btn btn-soft" disabled={syncing} onClick={() => void downloadEncryptedVault()}><Download size={16} />下载并解密</button>
            {rememberedPassphraseSaved ? (
              <button className="btn btn-soft" onClick={clearLocalRememberedPassphrase}>
                <Trash2 size={16} />清除本机口令
              </button>
            ) : null}
            <button className="btn btn-danger" onClick={() => { if (confirm('确认删除当前浏览器中的理财加密保险箱？')) { deleteFinanceVault(); setData(null); setActivePassphrase(''); setHasVault(false); setRememberedPassphraseSaved(false); setPassphrase(''); } }}>
              <Trash2 size={16} />删除本地保险箱
            </button>
            <button className="btn btn-danger" disabled={syncing} onClick={() => void deleteAllFinanceData()}>
              <Trash2 size={16} />彻底删除本地+云端
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-500">本地密文时间</p>
            <p className="mt-1 font-semibold text-slate-800">{encryptedVault?.updatedAt ? new Date(encryptedVault.updatedAt).toLocaleString() : '暂无'}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-500">云端密文时间</p>
            <p className="mt-1 font-semibold text-slate-800">{cloudMeta?.clientUpdatedAt ? new Date(cloudMeta.clientUpdatedAt).toLocaleString() : '未读取'}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-semibold text-slate-500">云端大小 / 设备</p>
            <p className="mt-1 font-semibold text-slate-800">{cloudMeta ? `${formatBytes(cloudMeta.byteSize)} / ${cloudMeta.deviceId || '未知设备'}` : '未读取'}</p>
          </div>
        </div>
        {syncError ? <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">同步失败：{syncError}。请确认当前是部署服务器登录后的同源页面；本地 Vite 预览需要后端服务可访问 `/api/finance-vault`。</p> : null}
      </section>
      ) : null}

      {snapshot && financeView === 'dashboard' ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="总资产估值" value={formatMoney(snapshot.totalAssetsCny, 'CNY', hidden)} hint="人民币基准估值" />
            <MetricCard label="已投资资产总额" value={formatMoney(snapshot.investedAssetsCny, 'CNY', hidden)} hint="不含现金资产" />
            <MetricCard label="可用现金" value={formatMoney(snapshot.availableCashCny, 'CNY', hidden)} hint="含人民币和美元现金折算" />
            <MetricCard label="今日盈亏" value={formatMoney(snapshot.todayPnlCny, 'CNY', hidden)} hint="缺少前值时暂无法计算" />
            <MetricCard label="起算后盈亏" value={formatMoney(snapshot.cumulativePnlCny, 'CNY', hidden)} hint={`从 ${data.settings.performanceStartDate ?? todayDateISO()} 起算`} />
            <MetricCard label="起算后收益率" value={formatPercent(snapshot.cumulativeReturnRate)} hint="不追溯历史成本价" />
            <MetricCard label="美元相关资产占比" value={formatPercent(snapshot.usdRelatedPercent)} hint="USD、USDT、USDC 和美元类资产" />
            <MetricCard label="权益类资产占比" value={formatPercent(snapshot.equityPercent)} hint="核心权益和卫星权益" />
            <MetricCard label="低波动资产占比" value={formatPercent(snapshot.lowVolatilityPercent)} hint="不含平台探索稳定币" />
            <MetricCard label="稳定币/平台探索占比" value={formatPercent(snapshot.stablecoinPlatformPercent)} hint="单独风险类别" />
            <MetricCard label="行情更新时间" value={<span className="text-base">{snapshot.latestQuoteFetchedAt === '尚未更新' ? '尚未更新' : new Date(snapshot.latestQuoteFetchedAt).toLocaleString()}</span>} hint="显示公开行情获取时间" />
            <MetricCard label="数据状态" value={<span className={snapshot.alerts.length ? 'text-amber-600' : 'text-emerald-600'}>{snapshot.alerts.length ? `${snapshot.alerts.length} 项提醒` : '正常'}</span>} hint="过期、待确认、缺失会在下方列出" />
          </div>

          {snapshot.alerts.length ? (
            <section className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-800"><AlertTriangle size={16} />数据异常与待补充</h2>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {snapshot.alerts.slice(0, 10).map((alert) => <p key={alert} className="rounded-lg bg-white/70 px-3 py-2 text-sm text-amber-800">{alert}</p>)}
              </div>
            </section>
          ) : null}

          <section className="mt-6 grid gap-4 xl:grid-cols-2">
            <div className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900">资产配置图表</h2>
                <select className="field w-auto" value={data.settings.displayCurrency} onChange={(event) => void persist({ ...data, settings: { ...data.settings, displayCurrency: event.target.value as FinanceCurrency } })}>
                  {financeCurrencyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <MiniChart mode="pie" data={snapshot.byGroup} hidden={hidden} />
                <MiniChart mode="bar" data={snapshot.byCurrency} hidden={hidden} />
              </div>
            </div>
            <div className="card p-5">
              <h2 className="text-base font-semibold text-slate-900">配置表格</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="text-left text-xs text-slate-500"><tr><th className="py-2">维度</th><th>金额</th><th>占比</th><th>目标</th><th>偏离</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {snapshot.targetRows.map((row) => (
                      <tr key={row.key}>
                        <td className="py-2 font-medium text-slate-800">{row.label}</td>
                        <td>{formatMoney(row.valueCny, 'CNY', hidden)}</td>
                        <td>{formatPercent(row.percent)}</td>
                        <td>{formatPercent(row.targetPercent)}</td>
                        <td className={Math.abs(row.driftPercent ?? 0) > 0 ? 'font-semibold text-amber-700' : ''}>{formatPercent(row.driftPercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="mt-6 card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">持仓列表</h2>
              <select className="field w-full md:w-64" value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}>
                <option value="all">全部分组</option>
                {financeGroupOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[1120px] text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr><th className="py-2">产品</th><th>分类</th><th>币种</th><th>份额/本金</th><th>净值/价格</th><th>市值</th><th>起算基准</th><th>起算后盈亏</th><th>收益率</th><th>今日盈亏</th><th>来源/日期</th><th>状态</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredHoldings.map((holding) => (
                    <tr key={holding.asset.id} className="align-top">
                      <td className="py-3"><p className="font-semibold text-slate-900">{holding.asset.name}</p><p className="text-xs text-slate-500">{holding.asset.symbol || holding.asset.platform || holding.asset.id}</p></td>
                      <td>{financeGroupLabels[holding.asset.groupId] ?? holding.asset.groupId}</td>
                      <td>{holding.asset.currency}</td>
                      <td>{hidden ? '••••' : holding.units ?? '待补充'}</td>
                      <td>
                        <p>{holding.quote?.price ?? holding.asset.latestPrice ?? '待补充'}</p>
                        {holding.asset.quoteProvider === 'coingecko-stablecoin' ? (
                          <div className="mt-1 space-y-1 text-xs text-slate-500">
                            <p>{stablecoinRateFor(holding.asset.currency)?.rate ? `≈ ${formatMoney(stablecoinRateFor(holding.asset.currency)?.rate ?? null, 'CNY', hidden)} / 枚` : '稳定币兑人民币价格待更新'}</p>
                            {holding.asset.referenceAnnualYield ? <p>参考年化 {formatPercent(holding.asset.referenceAnnualYield)}，不计入收益</p> : null}
                          </div>
                        ) : null}
                      </td>
                      <td>{formatMoney(holding.nativeMarketValue, holding.asset.currency, hidden)}<br /><span className="text-xs text-slate-500">{formatMoney(holding.cnyMarketValue, 'CNY', hidden)}</span></td>
                      <td>{holding.costNative === null ? '待建立' : formatMoney(holding.costNative, holding.asset.currency, hidden)}</td>
                      <td>{holding.cumulativePnlNative === null ? '数据不足' : formatMoney(holding.cumulativePnlNative, holding.asset.currency, hidden)}</td>
                      <td>{formatPercent(holding.returnRate)}</td>
                      <td>{formatMoney(holding.todayPnlNative, holding.asset.currency, hidden)}</td>
                      <td><p>{holding.quote?.source ?? holding.asset.dataSource ?? '手动/待补充'}</p><p className="text-xs text-slate-500">{holding.quote?.priceDate ?? holding.asset.priceDate ?? '待补充'}{holding.isManual ? ' · 手动' : ''}</p></td>
                      <td><span className={`rounded-lg px-2 py-1 text-xs font-semibold ${holding.issues.length ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{holding.issues.length ? '需补充' : '正常'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {financeView === 'assets' ? (
      <>
      <section className="mt-6 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">{assetDraft.id ? '编辑资产' : '新增资产'}</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label><span className="label">产品名称</span><input className="field" value={assetDraft.name} onChange={(event) => setAssetDraft({ ...assetDraft, name: event.target.value })} /></label>
            <label>
              <span className="label">代码/识别符</span>
              <div className="flex gap-2">
                <input className="field" value={assetDraft.symbol} onChange={(event) => setAssetDraft({ ...assetDraft, symbol: event.target.value, quoteSymbol: event.target.value })} onBlur={() => { if (!assetDraft.id && /^\d{6}$/.test(assetDraft.symbol.trim())) void lookupAssetByCode(); }} />
                <button className="btn btn-soft whitespace-nowrap" disabled={assetLookupLoading} type="button" onClick={() => void lookupAssetByCode()}>{assetLookupLoading ? '查询中' : '补齐'}</button>
              </div>
            </label>
            <label><span className="label">分类</span><select className="field" value={assetDraft.assetType} onChange={(event) => setAssetDraft({ ...assetDraft, assetType: event.target.value as FinanceAsset['assetType'] })}>{financeAssetTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span className="label">资产层级</span><select className="field" value={assetDraft.groupId} onChange={(event) => setAssetDraft({ ...assetDraft, groupId: event.target.value })}>{financeGroupOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
            <label><span className="label">风险类别</span><select className="field" value={assetDraft.riskBucket} onChange={(event) => setAssetDraft({ ...assetDraft, riskBucket: event.target.value as FinanceAsset['riskBucket'] })}>{financeRiskBucketOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span className="label">市场暴露</span><select className="field" value={assetDraft.marketExposure} onChange={(event) => setAssetDraft({ ...assetDraft, marketExposure: event.target.value as FinanceAsset['marketExposure'] })}>{financeMarketExposureOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span className="label">币种</span><select className="field" value={assetDraft.currency} onChange={(event) => setAssetDraft({ ...assetDraft, currency: event.target.value as FinanceCurrency })}>{financeCurrencyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span className="label">行情来源</span><select className="field" value={assetDraft.quoteProvider} onChange={(event) => setAssetDraft({ ...assetDraft, quoteProvider: event.target.value as FinanceQuoteProvider, isManualData: event.target.value === 'manual' })}><option value="manual">手动录入</option><option value="eastmoney-fund">天天基金公开净值</option><option value="coingecko-stablecoin">CoinGecko 稳定币</option></select></label>
            <label><span className="label">平台/渠道</span><input className="field" placeholder="如 Binance、Bitget、工银理财" value={assetDraft.platform} onChange={(event) => setAssetDraft({ ...assetDraft, platform: event.target.value })} /></label>
            <label><span className="label">参考年化（仅展示）</span><input className="field" inputMode="decimal" placeholder="如 6.55，不自动计收益" value={assetDraft.referenceAnnualYield} onChange={(event) => setAssetDraft({ ...assetDraft, referenceAnnualYield: event.target.value })} /></label>
            <label><span className="label">今日起算市值/余额</span><input className="field" inputMode="decimal" value={assetDraft.currentAmount} onChange={(event) => setAssetDraft({ ...assetDraft, currentAmount: event.target.value })} /></label>
            <label><span className="label">份额/本金（可留空自动估算）</span><input className="field" inputMode="decimal" value={assetDraft.units} onChange={(event) => setAssetDraft({ ...assetDraft, units: event.target.value })} /></label>
            <label><span className="label">{isBalanceIncomeAssetType(assetDraft.assetType) ? '单位价格（余额型默认 1）' : '最新净值/价格'}</span><input className="field" inputMode="decimal" placeholder={isBalanceIncomeAssetType(assetDraft.assetType) ? '可留空，保存时按 1' : ''} value={assetDraft.latestPrice} onChange={(event) => setAssetDraft({ ...assetDraft, latestPrice: event.target.value })} /></label>
            <label><span className="label">价格日期</span><input className="field" type="date" value={assetDraft.priceDate} onChange={(event) => setAssetDraft({ ...assetDraft, priceDate: event.target.value })} /></label>
            <label><span className="label">数据来源说明</span><input className="field" placeholder="如手动余额更新" value={assetDraft.dataSource} onChange={(event) => setAssetDraft({ ...assetDraft, dataSource: event.target.value })} /></label>
            <label><span className="label">净值日偏移</span><input className="field" inputMode="numeric" value={assetDraft.priceDateLagBusinessDays} onChange={(event) => setAssetDraft({ ...assetDraft, priceDateLagBusinessDays: event.target.value })} /></label>
            <label><span className="label">买入确认 T+</span><input className="field" inputMode="numeric" value={assetDraft.buyConfirmBusinessDays} onChange={(event) => setAssetDraft({ ...assetDraft, buyConfirmBusinessDays: event.target.value })} /></label>
            <label><span className="label">卖出确认 T+</span><input className="field" inputMode="numeric" value={assetDraft.sellConfirmBusinessDays} onChange={(event) => setAssetDraft({ ...assetDraft, sellConfirmBusinessDays: event.target.value })} /></label>
            <label><span className="label">卖出到账 T+</span><input className="field" inputMode="numeric" value={assetDraft.sellSettlementBusinessDays} onChange={(event) => setAssetDraft({ ...assetDraft, sellSettlementBusinessDays: event.target.value })} /></label>
          </div>
          <label className="mt-3 block"><span className="label">备注/标签</span><input className="field" value={assetDraft.notes} onChange={(event) => setAssetDraft({ ...assetDraft, notes: event.target.value })} /></label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => void saveAsset()}><Plus size={16} />保存资产</button>
            <button className="btn btn-soft" onClick={() => setAssetDraft(emptyAssetDraft())}>清空</button>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">行情与手动更新</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label><span className="label">资产</span><select className="field" value={manualQuoteAssetId} onChange={(event) => setManualQuoteAssetId(event.target.value)}><option value="">选择资产</option>{activeAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
            <label><span className="label">价格/净值</span><input className="field" inputMode="decimal" value={manualQuotePrice} onChange={(event) => setManualQuotePrice(event.target.value)} /></label>
            <label><span className="label">价格日期</span><input className="field" type="date" value={manualQuoteDate} onChange={(event) => setManualQuoteDate(event.target.value)} /></label>
            <div className="flex items-end"><button className="btn btn-primary" onClick={() => void updateManualQuote()}>保存手动价格</button></div>
            <label><span className="label">汇率</span><select className="field" value={manualRatePair} onChange={(event) => setManualRatePair(event.target.value as FinanceExchangeRate['pair'])}><option value="USD/CNY">USD/CNY</option><option value="USDT/CNY">USDT/CNY</option><option value="USDC/CNY">USDC/CNY</option></select></label>
            <label><span className="label">汇率值</span><input className="field" inputMode="decimal" value={manualRate} onChange={(event) => setManualRate(event.target.value)} /></label>
            <label><span className="label">汇率日期</span><input className="field" type="date" value={manualRateDate} onChange={(event) => setManualRateDate(event.target.value)} /></label>
            <div className="flex items-end"><button className="btn btn-primary" onClick={() => void updateManualRate()}>保存手动汇率</button></div>
          </div>
          <div className="mt-5 grid gap-2 text-sm">
            {Object.values(data.exchangeRates).map((rate) => rate ? <div key={rate.pair} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><span className="font-semibold">{rate.pair}</span>：{rate.rate ?? '失败'}，{rate.source}，{rate.asOfDate}{rate.failed ? `，失败：${rate.error}` : ''}</div> : null)}
          </div>
        </div>
      </section>
      <section className="mt-6 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">资产卡片</h2>
            <p className="mt-1 text-sm text-slate-500">这里不再录入历史成本。系统以今日记录市值作为起算基准，买入/卖出时按当前可用净值或你输入的价格估算份额。</p>
          </div>
          <select className="field w-full md:w-64" value={assetFilter} onChange={(event) => setAssetFilter(event.target.value)}>
            <option value="all">全部分组</option>
            {financeGroupOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {filteredHoldings.map((holding) => {
            const asset = holding.asset;
            const draft = quickTradeDrafts[asset.id] ?? emptyQuickTradeDraft();
            const snapshotDraft = balanceSnapshotDrafts[asset.id] ?? emptyBalanceSnapshotDraft();
            const defaultPrice = quotePriceForHolding(holding);
            const enteredAmount = numberOrNull(draft.amount);
            const enteredPrice = numberOrNull(draft.price) ?? defaultPrice;
            const estimatedUnits = enteredAmount !== null && enteredPrice !== null && enteredPrice > 0 ? roundMoney(enteredAmount / enteredPrice, 6) : null;
            const isCash = asset.assetType === 'CASH_CNY' || asset.assetType === 'CASH_USD';
            const tradeDates = tradeDatesFor(asset, draft.type, draft.tradeDate || todayDateISO());
            const supportsBalanceSnapshot = isBalanceIncomeAssetType(asset.assetType);
            const snapshotIncome = numberOrNull(snapshotDraft.incomeAmount);
            const snapshotBefore = numberOrNull(snapshotDraft.beforeBalance);
            const snapshotAfter = numberOrNull(snapshotDraft.afterBalance);
            const snapshotDiff = snapshotBefore !== null && snapshotAfter !== null ? roundMoney(snapshotAfter - snapshotBefore, 6) : null;
            return (
              <div key={asset.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-950">{asset.name}</h3>
                    <p className="mt-1 text-xs text-slate-500">{asset.symbol || asset.platform || asset.id} · {financeGroupLabels[asset.groupId] ?? asset.groupId}</p>
                  </div>
                  <div className="flex gap-1">
                    <button className="rounded p-1 text-blue-700 hover:bg-blue-50" title="编辑资产资料" onClick={() => setAssetDraft(assetToDraft(asset))}><Pencil size={15} /></button>
                    <button className="rounded p-1 text-slate-600 hover:bg-slate-100" title="归档资产" onClick={() => void archiveAsset(asset)}><Archive size={15} /></button>
                    <button className="rounded p-1 text-rose-600 hover:bg-rose-50" title="删除资产" onClick={() => void removeAsset(asset)}><Trash2 size={15} /></button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">当前市值</p>
                    <p className="font-semibold text-slate-900">{formatMoney(holding.nativeMarketValue, asset.currency, hidden)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">起算后盈亏</p>
                    <p className="font-semibold text-slate-900">{holding.cumulativePnlNative === null ? '待建立' : formatMoney(holding.cumulativePnlNative, asset.currency, hidden)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">份额/本金</p>
                    <p className="font-semibold text-slate-900">{hidden ? '••••' : holding.units ?? '待估算'}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2">
                    <p className="text-xs text-slate-500">净值/价格</p>
                    <p className="font-semibold text-slate-900">{defaultPrice ?? '待补充'}</p>
                  </div>
                </div>
                {isCash ? (
                  <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">现金账户暂只参与扣款、回款和换汇，不在资产卡片里估算买卖份额。</p>
                ) : (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="mb-3 flex gap-2">
                      <button className={`rounded-md px-3 py-1.5 text-sm font-semibold ${draft.type === 'BUY' ? 'bg-red-600 text-white' : 'bg-white text-slate-600'}`} onClick={() => updateQuickTradeDraft(asset.id, { type: 'BUY' })}>买入</button>
                      <button className={`rounded-md px-3 py-1.5 text-sm font-semibold ${draft.type === 'SELL' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-600'}`} onClick={() => updateQuickTradeDraft(asset.id, { type: 'SELL' })}>卖出</button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label><span className="label">交易日期</span><input className="field" type="date" value={draft.tradeDate} onChange={(event) => updateQuickTradeDraft(asset.id, { tradeDate: event.target.value })} /></label>
                      <label><span className="label">金额（{asset.currency}）</span><input className="field" inputMode="decimal" value={draft.amount} onChange={(event) => updateQuickTradeDraft(asset.id, { amount: event.target.value })} /></label>
                      <label><span className="label">净值/价格</span><input className="field" inputMode="decimal" placeholder={defaultPrice ? String(defaultPrice) : '手动输入'} value={draft.price} onChange={(event) => updateQuickTradeDraft(asset.id, { price: event.target.value })} /></label>
                      <label><span className="label">手续费</span><input className="field" inputMode="decimal" value={draft.fee} onChange={(event) => updateQuickTradeDraft(asset.id, { fee: event.target.value })} /></label>
                      <label><span className="label">{draft.type === 'BUY' ? '扣款/回款现金账户' : '回款现金账户'}</span><select className="field" value={draft.sourceCashAssetId} onChange={(event) => updateQuickTradeDraft(asset.id, { sourceCashAssetId: event.target.value })}><option value="">不关联现金</option>{cashAssets.filter((cash) => cash.currency === asset.currency).map((cash) => <option key={cash.id} value={cash.id}>{cash.name}</option>)}</select></label>
                    </div>
                    <label className="mt-3 block"><span className="label">备注</span><input className="field" value={draft.note} onChange={(event) => updateQuickTradeDraft(asset.id, { note: event.target.value })} /></label>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-slate-500">预计份额：{estimatedUnits === null || hidden ? '待计算' : estimatedUnits}；净值日 {tradeDates.priceDate}，确认日 {tradeDates.confirmDate}{tradeDates.settlementDate ? `，到账日 ${tradeDates.settlementDate}` : ''}</span>
                      <button className="btn btn-primary" onClick={() => void recordQuickTrade(holding)}><Plus size={16} />记录{draft.type === 'BUY' ? '买入' : '卖出'}</button>
                    </div>
                  </div>
                )}
                {supportsBalanceSnapshot ? (
                  <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                    <h4 className="text-sm font-semibold text-emerald-900">利率/生息录入</h4>
                    <p className="mt-1 text-xs leading-5 text-emerald-800">适合美元理财、稳定币活期等余额型资产。可以直接录入实际到账利息/奖励；参考年化只做备注，不会自动计入收益。</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label><span className="label">记录日期</span><input className="field" type="date" value={snapshotDraft.date} onChange={(event) => updateBalanceSnapshotDraft(asset.id, { date: event.target.value })} /></label>
                      <label><span className="label">实际到账利息/奖励</span><input className="field" inputMode="decimal" placeholder="可只填这一项" value={snapshotDraft.incomeAmount} onChange={(event) => updateBalanceSnapshotDraft(asset.id, { incomeAmount: event.target.value })} /></label>
                      <label><span className="label">录入后余额（可选）</span><input className="field" inputMode="decimal" placeholder={holding.nativeMarketValue == null ? '' : String(holding.nativeMarketValue)} value={snapshotDraft.afterBalance} onChange={(event) => updateBalanceSnapshotDraft(asset.id, { afterBalance: event.target.value })} /></label>
                      <label><span className="label">期初余额（用于快照差额）</span><input className="field" inputMode="decimal" value={snapshotDraft.beforeBalance} onChange={(event) => updateBalanceSnapshotDraft(asset.id, { beforeBalance: event.target.value })} /></label>
                      <label><span className="label">备注</span><input className="field" value={snapshotDraft.note} onChange={(event) => updateBalanceSnapshotDraft(asset.id, { note: event.target.value })} /></label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-emerald-800">到账：{snapshotIncome === null || hidden ? '待填写' : `${snapshotIncome} ${asset.currency}`}；快照差额：{snapshotDiff === null || hidden ? '待计算' : `${snapshotDiff} ${asset.currency}`}</span>
                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-primary" onClick={() => void recordYieldIncome(holding)}><Plus size={16} />记录利息</button>
                        <button className="btn btn-soft" onClick={() => void recordBalanceSnapshot(holding)}>按快照差额</button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-6 card p-5">
        <h2 className="text-base font-semibold text-slate-900">交易流水</h2>
        {transactionDraft.id ? (
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3">
        <h3 className="text-sm font-semibold text-blue-900">编辑已记录交易</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
          <label><span className="label">日期时间</span><input className="field" type="datetime-local" value={transactionDraft.dateTime} onChange={(event) => setTransactionDraft({ ...transactionDraft, dateTime: event.target.value })} /></label>
          <label><span className="label">交易类型</span><select className="field" value={transactionDraft.type} onChange={(event) => setTransactionDraft({ ...transactionDraft, type: event.target.value as FinanceTransaction['type'] })}>{financeTransactionTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span className="label">资产</span><select className="field" value={transactionDraft.assetId} onChange={(event) => setTransactionDraft({ ...transactionDraft, assetId: event.target.value })}><option value="">无/换汇</option>{activeAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
          <label><span className="label">状态</span><select className="field" value={transactionDraft.status} onChange={(event) => setTransactionDraft({ ...transactionDraft, status: event.target.value as FinanceTransaction['status'] })}>{financeTransactionStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span className="label">金额</span><input className="field" inputMode="decimal" value={transactionDraft.amount} onChange={(event) => setTransactionDraft({ ...transactionDraft, amount: event.target.value })} /></label>
          <label><span className="label">币种</span><select className="field" value={transactionDraft.currency} onChange={(event) => setTransactionDraft({ ...transactionDraft, currency: event.target.value as FinanceCurrency })}>{financeCurrencyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span className="label">份额</span><input className="field" inputMode="decimal" value={transactionDraft.units} onChange={(event) => setTransactionDraft({ ...transactionDraft, units: event.target.value })} /></label>
          <label><span className="label">成交价格/净值</span><input className="field" inputMode="decimal" value={transactionDraft.price} onChange={(event) => setTransactionDraft({ ...transactionDraft, price: event.target.value })} /></label>
          <label><span className="label">手续费</span><input className="field" inputMode="decimal" value={transactionDraft.fee} onChange={(event) => setTransactionDraft({ ...transactionDraft, fee: event.target.value })} /></label>
          <label><span className="label">扣款现金账户</span><select className="field" value={transactionDraft.sourceCashAssetId} onChange={(event) => setTransactionDraft({ ...transactionDraft, sourceCashAssetId: event.target.value })}><option value="">不关联</option>{cashAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
          <label><span className="label">换汇来源账户</span><select className="field" value={transactionDraft.fromAssetId} onChange={(event) => setTransactionDraft({ ...transactionDraft, fromAssetId: event.target.value })}><option value="">选择</option>{cashAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
          <label><span className="label">换汇目标账户</span><select className="field" value={transactionDraft.toAssetId} onChange={(event) => setTransactionDraft({ ...transactionDraft, toAssetId: event.target.value })}><option value="">选择</option>{cashAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
          <label><span className="label">目标金额</span><input className="field" inputMode="decimal" value={transactionDraft.toAmount} onChange={(event) => setTransactionDraft({ ...transactionDraft, toAmount: event.target.value })} /></label>
          <label><span className="label">汇率</span><input className="field" inputMode="decimal" value={transactionDraft.fxRate} onChange={(event) => setTransactionDraft({ ...transactionDraft, fxRate: event.target.value })} /></label>
          <label><span className="label">流水性质</span><select className="field" value={transactionDraft.cashflowKind} onChange={(event) => setTransactionDraft({ ...transactionDraft, cashflowKind: event.target.value as TransactionDraft['cashflowKind'] })}><option value="">自动识别</option>{cashflowKindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span className="label">流水分类</span><select className="field" value={transactionDraft.cashflowCategory} onChange={(event) => setTransactionDraft({ ...transactionDraft, cashflowCategory: event.target.value as TransactionDraft['cashflowCategory'] })}><option value="">自动识别</option>{cashflowCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label><span className="label">商户/渠道</span><input className="field" value={transactionDraft.merchant} onChange={(event) => setTransactionDraft({ ...transactionDraft, merchant: event.target.value })} /></label>
          <label><span className="label">对手方</span><input className="field" value={transactionDraft.counterparty} onChange={(event) => setTransactionDraft({ ...transactionDraft, counterparty: event.target.value })} /></label>
          <label><span className="label">标签</span><input className="field" placeholder="逗号分隔" value={transactionDraft.tags} onChange={(event) => setTransactionDraft({ ...transactionDraft, tags: event.target.value })} /></label>
        </div>
        <label className="mt-3 block"><span className="label">备注 / 关联交易 ID（逗号分隔）</span><input className="field" value={transactionDraft.note} onChange={(event) => setTransactionDraft({ ...transactionDraft, note: event.target.value })} /></label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-primary" onClick={() => void saveTransaction()}><Plus size={16} />保存交易</button>
          <button className="btn btn-soft" onClick={() => setTransactionDraft(emptyTransactionDraft())}>取消编辑</button>
        </div>
        </div>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <input className="field w-full md:w-48" type="date" value={transactionFrom} onChange={(event) => setTransactionFrom(event.target.value)} />
          <input className="field w-full md:w-48" type="date" value={transactionTo} onChange={(event) => setTransactionTo(event.target.value)} />
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="text-left text-xs text-slate-500"><tr><th className="py-2">交易日</th><th>确认/到账</th><th>资产</th><th>类型</th><th>金额</th><th>份额</th><th>汇率/价格</th><th>状态</th><th>备注</th><th>操作</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.map((transaction) => {
                const asset = data.assets.find((item) => item.id === transaction.assetId);
                return (
                  <tr key={transaction.id}>
                    <td className="py-2">{transaction.tradeDate ?? transaction.dateTime.slice(0, 10)}{transaction.priceDate ? <p className="text-xs text-slate-500">净值 {transaction.priceDate}</p> : null}</td>
                    <td>{transaction.confirmDate ?? ''}{transaction.settlementDate ? <p className="text-xs text-slate-500">到账 {transaction.settlementDate}</p> : null}</td>
                    <td>{asset?.name ?? transaction.platform ?? '换汇/现金'}</td>
                    <td>{financeTransactionTypeLabels[transaction.type]}</td>
                    <td>{hidden ? '••••' : `${transaction.amount ?? transaction.toAmount ?? ''} ${transaction.currency}`}</td>
                    <td>{hidden ? '••••' : transaction.units ?? ''}</td>
                    <td>{transaction.fxRate ?? transaction.price ?? ''}</td>
                    <td>{financeTransactionStatusLabels[transaction.status]}</td>
                    <td className="max-w-64 truncate">{transaction.note}</td>
                    <td><div className="flex gap-1"><button className="rounded p-1 text-blue-700 hover:bg-blue-50" onClick={() => setTransactionDraft(transactionToDraft(transaction))}><Pencil size={15} /></button><button className="rounded p-1 text-amber-700 hover:bg-amber-50" onClick={() => void cancelTransaction(transaction)}><RotateCcw size={15} /></button><button className="rounded p-1 text-rose-600 hover:bg-rose-50" onClick={() => void deleteTransaction(transaction)}><Trash2 size={15} /></button></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      </>
      ) : null}

      {financeView === 'cashflow' && cashflowAnalysis ? (
        <CashflowPanel
          analysis={cashflowAnalysis}
          hidden={hidden}
          from={cashflowFrom}
          to={cashflowTo}
          onFromChange={setCashflowFrom}
          onToChange={setCashflowTo}
          onResetPeriod={() => {
            const today = todayDateISO();
            setCashflowFrom(`${today.slice(0, 7)}-01`);
            setCashflowTo(today);
          }}
          onExportCsv={() => downloadBlob(`finance-cashflow-${cashflowFrom || 'all'}-${cashflowTo || 'today'}.csv`, exportCashflowCsv(cashflowAnalysis), 'text/csv;charset=utf-8')}
          onEditTransaction={(transactionId) => {
            const transaction = data.transactions.find((item) => item.id === transactionId);
            if (transaction) {
              setTransactionDraft(transactionToDraft(transaction));
              setFinanceView('assets');
            }
          }}
        />
      ) : null}

      {financeView === 'plans' ? (
      <section className="mt-6 grid gap-4 xl:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">投资计划</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label><span className="label">计划名称</span><input className="field" value={planDraft.name} onChange={(event) => setPlanDraft({ ...planDraft, name: event.target.value })} /></label>
            <label><span className="label">关联资产</span><select className="field" value={planDraft.assetId} onChange={(event) => setPlanDraft({ ...planDraft, assetId: event.target.value })}><option value="">草稿/不关联</option>{activeAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
            <label><span className="label">金额</span><input className="field" inputMode="decimal" value={planDraft.amount} onChange={(event) => setPlanDraft({ ...planDraft, amount: event.target.value })} /></label>
            <label><span className="label">频率</span><input className="field" value={planDraft.frequency} onChange={(event) => setPlanDraft({ ...planDraft, frequency: event.target.value })} /></label>
            <label><span className="label">状态</span><select className="field" value={planDraft.status} onChange={(event) => setPlanDraft({ ...planDraft, status: event.target.value as FinancePlanStatus })}><option value="active">正在执行</option><option value="paused">已暂停</option><option value="draft">草稿计划</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
            <label><span className="label">月预计投入</span><input className="field" inputMode="decimal" value={planDraft.expectedMonthlyAmount} onChange={(event) => setPlanDraft({ ...planDraft, expectedMonthlyAmount: event.target.value })} /></label>
          </div>
          <label className="mt-3 block"><span className="label">备注</span><input className="field" value={planDraft.note} onChange={(event) => setPlanDraft({ ...planDraft, note: event.target.value })} /></label>
          <div className="mt-4 flex flex-wrap gap-2"><button className="btn btn-primary" onClick={() => void savePlan()}>保存计划</button><button className="btn btn-soft" onClick={() => setPlanDraft(emptyPlanDraft())}>清空</button></div>
          <div className="mt-4 space-y-2">
            {data.plans.map((plan) => <div key={plan.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"><span className="font-semibold">{plan.name}</span><span>{plan.frequency} {formatMoney(plan.amount, plan.currency, hidden)}</span><span>{plan.status}</span><button className="rounded p-1 text-blue-700 hover:bg-blue-50" onClick={() => setPlanDraft(planToDraft(plan))}><Pencil size={15} /></button></div>)}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">资产目标配置</h2>
          <div className="mt-4 space-y-3">
            {data.targets.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((target) => (
              <div key={target.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="grid gap-2 md:grid-cols-[1fr_90px_90px_130px_auto]">
                  <input className="field" value={target.name} onChange={(event) => saveTarget({ ...target, name: event.target.value })} />
                  <input className="field" type="number" value={target.targetPercent} onChange={(event) => saveTarget({ ...target, targetPercent: Number(event.target.value) })} />
                  <input className="field" type="number" value={target.tolerancePercent} onChange={(event) => saveTarget({ ...target, tolerancePercent: Number(event.target.value) })} />
                  <select className="field" value={target.actionStatus} onChange={(event) => saveTarget({ ...target, actionStatus: event.target.value as FinanceAllocationTarget['actionStatus'] })}>{Object.entries(financeActionStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                  <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={target.continueInvesting} onChange={(event) => saveTarget({ ...target, continueInvesting: event.target.checked })} />继续新增</label>
                </div>
                <input className="field mt-2" value={target.riskNote} onChange={(event) => saveTarget({ ...target, riskNote: event.target.value })} />
              </div>
            ))}
          </div>
        </div>
      </section>

      ) : null}

      {financeView === 'reports' ? (
      <section className="mt-6 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900">报告导出</h2>
          <div className="flex flex-wrap gap-2">
            <select className="field w-auto" value={reportKind} onChange={(event) => updateReportKind(event.target.value as FinanceReportKind)}><option value="daily">每日报告</option><option value="weekly">每周报告</option><option value="monthly">每月报告</option><option value="custom">自定义</option></select>
            <input className="field w-auto" type="date" value={reportOptions.periodStart} onChange={(event) => setReportOptions({ ...reportOptions, kind: reportKind, periodStart: event.target.value })} />
            <input className="field w-auto" type="date" value={reportOptions.periodEnd} onChange={(event) => setReportOptions({ ...reportOptions, kind: reportKind, periodEnd: event.target.value })} />
            <button className="btn btn-soft" onClick={() => void navigator.clipboard.writeText(reportText).then(() => showToast('Markdown 报告已复制'))}><Copy size={16} />复制 Markdown</button>
            <button className="btn btn-soft" onClick={() => snapshot && downloadBlob(`finance-holdings-${todayDateISO()}.csv`, exportHoldingsCsv(snapshot), 'text/csv;charset=utf-8')}><Download size={16} />持仓 CSV</button>
          </div>
        </div>
        <textarea className="field mt-4 min-h-96 font-mono text-xs leading-5" value={reportText} readOnly />
      </section>
      ) : null}

      <Toast message={toast} />
    </Page>
  );
}
