import type {
  FinanceAllocationRow,
  FinanceAsset,
  FinanceCurrency,
  FinanceData,
  FinanceExchangeRate,
  FinanceHoldingSnapshot,
  FinancePortfolioSnapshot,
  FinanceQuote,
  FinanceTransaction,
} from '../../types/finance';
import {
  financeGroupLabels,
  financeMarketExposureLabels,
  financeRiskBucketLabels,
} from './constants';

const stalePriceDays = 4;

type LedgerRow = {
  units: number | null;
  cashBalance: number;
  cost: number;
  hasCost: boolean;
  invested: number;
  realizedPnl: number;
  income: number;
  fees: number;
  issues: string[];
};

export function roundMoney(value: number, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function todayDateISO(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function nowISO() {
  return new Date().toISOString();
}

export function newFinanceId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function isCashAsset(asset: FinanceAsset) {
  return asset.assetType === 'CASH_CNY' || asset.assetType === 'CASH_USD';
}

export function formatPercent(value: number | null | undefined, digits = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '暂无法计算';
  return `${roundMoney(value, digits).toFixed(digits)}%`;
}

export function formatMoney(value: number | null | undefined, currency: FinanceCurrency | 'CNY' = 'CNY', hidden = false) {
  if (hidden) return '••••';
  if (typeof value !== 'number' || !Number.isFinite(value)) return '待补充';
  return `${roundMoney(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function isQuoteStale(quote: FinanceQuote | null, baseDate = new Date()) {
  if (!quote || quote.failed) return true;
  const dateText = quote.priceDate || quote.fetchedAt.slice(0, 10);
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return true;
  const ageMs = baseDate.getTime() - date.getTime();
  return ageMs > stalePriceDays * 24 * 60 * 60 * 1000;
}

export function getCurrencyRateToCny(currency: FinanceCurrency, data: FinanceData) {
  if (currency === 'CNY') return { rate: 1, warning: '' };
  const pair = `${currency}/CNY` as FinanceExchangeRate['pair'];
  const quote = data.exchangeRates[pair];
  if (quote?.rate && Number.isFinite(quote.rate) && quote.rate > 0) {
    return { rate: quote.rate, warning: '' };
  }
  return { rate: null, warning: `${currency}/CNY 汇率缺失，无法准确折算人民币。` };
}

export function convertToCny(value: number | null | undefined, currency: FinanceCurrency, data: FinanceData) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return { value: null, warning: '' };
  const rate = getCurrencyRateToCny(currency, data);
  return { value: rate.rate === null ? null : roundMoney(value * rate.rate), warning: rate.warning };
}

function comparisonDate(previousDate?: string | null, currentDate?: string | null) {
  const previous = String(previousDate || '').slice(0, 10);
  const current = String(currentDate || '').slice(0, 10);
  return previous && current && previous < current ? previous : '';
}

function comparisonQuotePrice(asset: FinanceAsset, quote: FinanceQuote | null) {
  const currentPrice = quotePriceForAsset(asset, quote);
  if (typeof currentPrice !== 'number' || !Number.isFinite(currentPrice)) {
    return { currentPrice: null, previousPrice: null };
  }
  const previousPrice = typeof quote?.previousPrice === 'number' && Number.isFinite(quote.previousPrice) ? quote.previousPrice : null;
  const previousPriceDate = String(quote?.previousPriceDate || '').slice(0, 10);
  const currentPriceDate = String(quote?.priceDate || '').slice(0, 10);
  if (previousPrice === null) return { currentPrice, previousPrice: null };
  if (!previousPriceDate) return { currentPrice, previousPrice };
  return { currentPrice, previousPrice: comparisonDate(previousPriceDate, currentPriceDate) ? previousPrice : null };
}

function comparisonRateToCny(currency: FinanceCurrency, data: FinanceData) {
  if (currency === 'CNY') return { currentRate: 1, previousRate: 1 };
  const pair = `${currency}/CNY` as FinanceExchangeRate['pair'];
  const current = data.exchangeRates[pair];
  const currentRate = typeof current?.rate === 'number' && Number.isFinite(current.rate) ? current.rate : null;
  const previousRate = typeof current?.previousRate === 'number' && Number.isFinite(current.previousRate) ? current.previousRate : null;
  const previousAsOfDate = String(current?.previousAsOfDate || '').slice(0, 10);
  const currentAsOfDate = String(current?.asOfDate || '').slice(0, 10);
  if (previousRate === null) return { currentRate, previousRate: null };
  if (!previousAsOfDate) return { currentRate, previousRate };
  return { currentRate, previousRate: comparisonDate(previousAsOfDate, currentAsOfDate) ? previousRate : null };
}

function emptyLedger(): LedgerRow {
  return {
    units: null,
    cashBalance: 0,
    cost: 0,
    hasCost: false,
    invested: 0,
    realizedPnl: 0,
    income: 0,
    fees: 0,
    issues: [],
  };
}

function getLedger(ledgers: Map<string, LedgerRow>, assetId: string) {
  const existing = ledgers.get(assetId);
  if (existing) return existing;
  const next = emptyLedger();
  ledgers.set(assetId, next);
  return next;
}

function addUnits(row: LedgerRow, units: number | null | undefined) {
  if (typeof units !== 'number' || !Number.isFinite(units)) return;
  row.units = (row.units ?? 0) + units;
}

function addCost(row: LedgerRow, amount: number | null | undefined, fee = 0) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return;
  row.cost += amount + fee;
  row.invested += amount + fee;
  row.hasCost = true;
}

function pendingRelatedFx(transaction: FinanceTransaction, transactionsById: Map<string, FinanceTransaction>) {
  return transaction.relatedTransactionIds.some((id) => {
    const related = transactionsById.get(id);
    return related?.type === 'FX_CONVERSION' && related.status === 'pending';
  });
}

function quotePriceForAsset(asset: FinanceAsset, quote: FinanceQuote | null) {
  if (typeof quote?.price === 'number' && Number.isFinite(quote.price) && quote.price > 0) return quote.price;
  if (typeof asset.latestPrice === 'number' && Number.isFinite(asset.latestPrice) && asset.latestPrice > 0) return asset.latestPrice;
  if (asset.assetType === 'CRYPTO_STABLECOIN' || asset.assetType === 'CRYPTO_STABLECOIN_EARN') return 1;
  if (asset.quoteProvider === 'manual' && typeof asset.currentAmount === 'number') return 1;
  return null;
}

function applyOpeningPosition(transaction: FinanceTransaction, asset: FinanceAsset | undefined, row: LedgerRow, quote: FinanceQuote | null) {
  if (!asset) return;
  if (isCashAsset(asset)) {
    row.cashBalance += transaction.amount ?? 0;
    row.hasCost = true;
    row.cost += transaction.amount ?? 0;
    return;
  }

  const openingAmount = transaction.amount ?? asset.trackingBaselineAmount ?? asset.currentAmount ?? null;
  const openingPrice = transaction.price ?? quotePriceForAsset(asset, quote);
  const estimatedUnits =
    transaction.units ??
    asset.trackingBaselineUnits ??
    asset.units ??
    (typeof openingAmount === 'number' && typeof openingPrice === 'number' && openingPrice > 0 ? roundMoney(openingAmount / openingPrice, 6) : null);
  addUnits(row, estimatedUnits);
  const openingCost = transaction.costAmount ?? asset.trackingBaselineAmount ?? asset.totalCost ?? openingAmount;
  addCost(row, openingCost, 0);
}

function seedTrackingBaseline(asset: FinanceAsset, row: LedgerRow, quote: FinanceQuote | null) {
  const baselineAmount = asset.trackingBaselineAmount ?? asset.currentAmount ?? null;
  if (isCashAsset(asset)) {
    if (typeof baselineAmount !== 'number' || !Number.isFinite(baselineAmount)) return;
    row.cashBalance += baselineAmount;
    row.cost += baselineAmount;
    row.hasCost = true;
    return;
  }

  const baselinePrice = quotePriceForAsset(asset, quote);
  const baselineUnits =
    asset.trackingBaselineUnits ??
    asset.units ??
    (typeof baselineAmount === 'number' && typeof baselinePrice === 'number' && baselinePrice > 0 ? roundMoney(baselineAmount / baselinePrice, 6) : null);
  addUnits(row, baselineUnits);
  const baselineCost = asset.totalCost ?? baselineAmount;
  addCost(row, baselineCost, 0);
}

function applySell(transaction: FinanceTransaction, row: LedgerRow) {
  const amount = transaction.amount ?? 0;
  const fee = transaction.fee ?? 0;
  const units = transaction.units ?? null;
  if (typeof units === 'number' && Number.isFinite(units) && row.units && row.units > 0 && row.hasCost) {
    const costRemoved = row.cost * Math.min(1, Math.max(0, units / row.units));
    row.units -= units;
    row.cost -= costRemoved;
    row.realizedPnl += amount - fee - costRemoved;
  } else {
    row.realizedPnl += amount - fee;
    row.issues.push('卖出记录缺少份额或成本，已实现盈亏只能近似记录。');
  }
}

function applyConfirmedTransaction(
  transaction: FinanceTransaction,
  assetMap: Map<string, FinanceAsset>,
  ledgers: Map<string, LedgerRow>,
  transactionsById: Map<string, FinanceTransaction>,
  data: FinanceData,
) {
  if (transaction.status !== 'confirmed') return;

  if (transaction.type === 'FX_CONVERSION') {
    if (!transaction.fromAssetId || !transaction.toAssetId || !transaction.toAmount) return;
    const fromRow = getLedger(ledgers, transaction.fromAssetId);
    const toRow = getLedger(ledgers, transaction.toAssetId);
    const fee = transaction.fee ?? 0;
    const fromAmount = transaction.amount ?? (transaction.fxRate ? transaction.toAmount * transaction.fxRate + fee : null);
    if (typeof fromAmount !== 'number' || !Number.isFinite(fromAmount)) {
      fromRow.issues.push('换汇交易已确认但缺少成交汇率或扣款金额，现金余额暂无法精确计算。');
      return;
    }
    fromRow.cashBalance -= fromAmount;
    toRow.cashBalance += transaction.toAmount;
    return;
  }

  if (!transaction.assetId) return;
  const asset = assetMap.get(transaction.assetId);
  const row = getLedger(ledgers, transaction.assetId);
  const fee = transaction.fee ?? 0;

  if (transaction.type === 'OPENING_POSITION') {
    applyOpeningPosition(transaction, asset, row, asset ? data.quotes[asset.id] ?? null : null);
    return;
  }

  if (transaction.type === 'CASH_DEPOSIT' || transaction.type === 'TRANSFER_IN') {
    row.cashBalance += transaction.amount ?? 0;
    return;
  }

  if (transaction.type === 'CASH_WITHDRAWAL' || transaction.type === 'TRANSFER_OUT') {
    row.cashBalance -= transaction.amount ?? 0;
    return;
  }

  if (transaction.type === 'BUY') {
    addUnits(row, transaction.units);
    addCost(row, transaction.amount, fee);
    if (transaction.sourceCashAssetId && !pendingRelatedFx(transaction, transactionsById)) {
      getLedger(ledgers, transaction.sourceCashAssetId).cashBalance -= transaction.amount ?? 0;
    }
    return;
  }

  if (transaction.type === 'SELL') {
    applySell(transaction, row);
    if (transaction.sourceCashAssetId) {
      getLedger(ledgers, transaction.sourceCashAssetId).cashBalance += (transaction.amount ?? 0) - fee;
    }
    return;
  }

  if (transaction.type === 'INTEREST' || transaction.type === 'REWARD' || transaction.type === 'DIVIDEND') {
    const incomeAmount = transaction.amount ?? 0;
    row.income += incomeAmount;
    addUnits(row, transaction.units);
    if (typeof transaction.units !== 'number' || !Number.isFinite(transaction.units) || transaction.units === 0) {
      row.realizedPnl += incomeAmount;
    }
    return;
  }

  if (transaction.type === 'FEE') {
    const feeAmount = transaction.amount ?? fee;
    row.fees += feeAmount;
    addUnits(row, transaction.units);
    if (typeof transaction.units !== 'number' || !Number.isFinite(transaction.units) || transaction.units === 0) {
      row.realizedPnl -= feeAmount;
    }
    return;
  }

  if (transaction.type === 'ADJUSTMENT') {
    row.issues.push('存在手动校正交易，请核对其对成本和份额的影响。');
  }
}

function marketValueFromAsset(asset: FinanceAsset, row: LedgerRow, quote: FinanceQuote | null) {
  if (isCashAsset(asset)) return row.cashBalance || asset.currentAmount || 0;
  const units = row.units ?? asset.units ?? asset.trackingBaselineUnits ?? null;
  const price = quotePriceForAsset(asset, quote);
  if (typeof units === 'number' && Number.isFinite(units) && typeof price === 'number' && Number.isFinite(price)) {
    return roundMoney(units * price, 4);
  }
  if (typeof asset.currentAmount === 'number' && Number.isFinite(asset.currentAmount)) return asset.currentAmount;
  if (asset.assetType === 'CRYPTO_STABLECOIN' || asset.assetType === 'CRYPTO_STABLECOIN_EARN') {
    return units;
  }
  return null;
}

function unitsFromAsset(asset: FinanceAsset, row: LedgerRow) {
  if (row.units !== null) return row.units;
  if (typeof asset.units === 'number' && Number.isFinite(asset.units)) return asset.units;
  if (typeof asset.trackingBaselineUnits === 'number' && Number.isFinite(asset.trackingBaselineUnits)) return asset.trackingBaselineUnits;
  if (asset.assetType === 'CRYPTO_STABLECOIN' || asset.assetType === 'CRYPTO_STABLECOIN_EARN') return asset.currentAmount ?? null;
  return null;
}

function costFromAsset(asset: FinanceAsset, row: LedgerRow) {
  if (row.hasCost) return row.cost;
  if (typeof asset.trackingBaselineAmount === 'number' && Number.isFinite(asset.trackingBaselineAmount)) return asset.trackingBaselineAmount;
  if (typeof asset.totalCost === 'number' && Number.isFinite(asset.totalCost)) return asset.totalCost;
  if (typeof asset.currentAmount === 'number' && Number.isFinite(asset.currentAmount)) return asset.currentAmount;
  return null;
}

function buildHolding(asset: FinanceAsset, row: LedgerRow, data: FinanceData): FinanceHoldingSnapshot {
  const quote = data.quotes[asset.id] ?? null;
  const quoteComparison = comparisonQuotePrice(asset, quote);
  const units = unitsFromAsset(asset, row);
  const nativeMarketValue = marketValueFromAsset(asset, row, quote);
  const cny = convertToCny(nativeMarketValue, asset.currency, data);
  const costNative = costFromAsset(asset, row);
  const costCny = convertToCny(costNative, asset.currency, data);
  const issues = [...row.issues];
  if (cny.warning) issues.push(cny.warning);
  if (costCny.warning) issues.push(costCny.warning);
  if (costNative === null && nativeMarketValue !== null) issues.push('缺少起算基准，暂无法计算从起算日以来的收益。');
  if (nativeMarketValue === null) issues.push('缺少份额、当前市值或最新价格，暂无法估算市值。');
  if (!isCashAsset(asset) && !quote && typeof asset.latestPrice !== 'number' && typeof asset.currentAmount !== 'number') issues.push('缺少行情或手动估值。');
  if (quote?.failed) issues.push(`行情更新失败：${quote.error ?? '未知错误'}`);
  const stale = isQuoteStale(quote);
  if (quote && stale) issues.push('行情可能已过期。');

  const unrealizedPnlNative = costNative === null || nativeMarketValue === null ? null : roundMoney(nativeMarketValue - costNative);
  const cumulativePnlNative = unrealizedPnlNative === null ? null : roundMoney(unrealizedPnlNative + row.realizedPnl);
  const cumulativePnlCny = convertToCny(cumulativePnlNative, asset.currency, data);
  if (cumulativePnlCny.warning) issues.push(cumulativePnlCny.warning);
  const returnRate = costNative && cumulativePnlNative !== null ? roundMoney((cumulativePnlNative / costNative) * 100, 4) : null;
  const todayPnlNative =
    quoteComparison.previousPrice !== null
    && quoteComparison.currentPrice !== null
    && units !== null
    && !isCashAsset(asset)
      ? roundMoney((quoteComparison.currentPrice - quoteComparison.previousPrice) * units)
      : null;
  const rateComparison = comparisonRateToCny(asset.currency, data);
  const previousNativeMarketValue =
    isCashAsset(asset)
      ? nativeMarketValue
      : units !== null && quoteComparison.previousPrice !== null
        ? roundMoney(units * quoteComparison.previousPrice, 4)
        : typeof nativeMarketValue === 'number' && Number.isFinite(nativeMarketValue) && rateComparison.previousRate !== null
          ? nativeMarketValue
          : null;
  const previousCnyMarketValue =
    typeof previousNativeMarketValue === 'number'
    && Number.isFinite(previousNativeMarketValue)
    && rateComparison.previousRate !== null
      ? roundMoney(previousNativeMarketValue * rateComparison.previousRate)
      : null;
  const todayPnlCny = {
    value:
      typeof cny.value === 'number'
      && Number.isFinite(cny.value)
      && typeof previousCnyMarketValue === 'number'
      && Number.isFinite(previousCnyMarketValue)
        ? roundMoney(cny.value - previousCnyMarketValue)
        : convertToCny(todayPnlNative, asset.currency, data).value,
  };

  return {
    asset,
    units,
    nativeMarketValue,
    cnyMarketValue: cny.value,
    costNative,
    costCny: costCny.value,
    realizedPnlNative: row.realizedPnl,
    unrealizedPnlNative,
    cumulativePnlNative,
    cumulativePnlCny: cumulativePnlCny.value,
    returnRate,
    todayPnlNative,
    todayPnlCny: todayPnlCny.value,
    quote,
    issues: Array.from(new Set(issues)),
    isStale: stale,
    isManual: asset.isManualData || Boolean(quote?.isManual),
  };
}

function allocationRows(
  holdings: FinanceHoldingSnapshot[],
  total: number,
  getKey: (holding: FinanceHoldingSnapshot) => string,
  getLabel: (key: string) => string,
) {
  const rows = new Map<string, number>();
  holdings.forEach((holding) => {
    if (holding.cnyMarketValue === null) return;
    const key = getKey(holding);
    rows.set(key, (rows.get(key) ?? 0) + holding.cnyMarketValue);
  });
  return Array.from(rows.entries())
    .map(([key, valueCny]) => ({ key, label: getLabel(key), valueCny: roundMoney(valueCny), percent: total ? roundMoney((valueCny / total) * 100, 4) : 0 }))
    .sort((a, b) => b.valueCny - a.valueCny);
}

function targetRows(data: FinanceData, holdings: FinanceHoldingSnapshot[], total: number): FinanceAllocationRow[] {
  return data.targets
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((target) => {
      const valueCny = holdings
        .filter((holding) => target.assetGroupIds.includes(holding.asset.groupId))
        .reduce((sum, holding) => sum + (holding.cnyMarketValue ?? 0), 0);
      const percent = total ? roundMoney((valueCny / total) * 100, 4) : 0;
      return {
        key: target.id,
        label: target.name,
        valueCny: roundMoney(valueCny),
        percent,
        targetPercent: target.targetPercent,
        driftPercent: roundMoney(percent - target.targetPercent, 4),
        status: target.actionStatus,
      };
    });
}

function latestQuoteFetchedAt(data: FinanceData) {
  const times = [
    ...Object.values(data.quotes).map((quote) => quote.fetchedAt),
    ...Object.values(data.exchangeRates).map((rate) => rate?.fetchedAt ?? ''),
  ].filter(Boolean);
  return times.sort().at(-1) ?? '尚未更新';
}

export function buildPortfolioSnapshot(data: FinanceData): FinancePortfolioSnapshot {
  const activeAssets = data.assets.filter((asset) => asset.status !== 'archived');
  const assetMap = new Map(activeAssets.map((asset) => [asset.id, asset]));
  const transactionsById = new Map(data.transactions.map((transaction) => [transaction.id, transaction]));
  const ledgers = new Map<string, LedgerRow>();
  const assetsWithConfirmedOpening = new Set(
    data.transactions
      .filter((transaction) => transaction.status === 'confirmed' && transaction.type === 'OPENING_POSITION' && transaction.assetId)
      .map((transaction) => transaction.assetId as string),
  );
  activeAssets.forEach((asset) => {
    const row = getLedger(ledgers, asset.id);
    if (!assetsWithConfirmedOpening.has(asset.id)) seedTrackingBaseline(asset, row, data.quotes[asset.id] ?? null);
  });
  data.transactions.forEach((transaction) => applyConfirmedTransaction(transaction, assetMap, ledgers, transactionsById, data));

  const holdings = activeAssets.map((asset) => buildHolding(asset, getLedger(ledgers, asset.id), data));
  const totalAssetsCny = roundMoney(holdings.reduce((sum, holding) => sum + (holding.cnyMarketValue ?? 0), 0));
  const investedAssetsCny = roundMoney(holdings.reduce((sum, holding) => sum + (!isCashAsset(holding.asset) ? holding.cnyMarketValue ?? 0 : 0), 0));
  const availableCashCny = roundMoney(holdings.reduce((sum, holding) => sum + (isCashAsset(holding.asset) ? holding.cnyMarketValue ?? 0 : 0), 0));
  const todayPnlValues = holdings.map((holding) => holding.todayPnlCny).filter((value): value is number => typeof value === 'number');
  const cumulativeValues = holdings.map((holding) => holding.cumulativePnlCny).filter((value): value is number => typeof value === 'number');
  const costValues = holdings.map((holding) => holding.costCny).filter((value): value is number => typeof value === 'number');
  const todayPnlCny = todayPnlValues.length ? roundMoney(todayPnlValues.reduce((sum, value) => sum + value, 0)) : null;
  const cumulativePnlCny = cumulativeValues.length ? roundMoney(cumulativeValues.reduce((sum, value) => sum + value, 0)) : null;
  const totalKnownCost = costValues.reduce((sum, value) => sum + value, 0);
  const cumulativeReturnRate = cumulativePnlCny !== null && totalKnownCost > 0 ? roundMoney((cumulativePnlCny / totalKnownCost) * 100, 4) : null;

  const valueFor = (predicate: (asset: FinanceAsset) => boolean) =>
    holdings.reduce((sum, holding) => sum + (predicate(holding.asset) ? holding.cnyMarketValue ?? 0 : 0), 0);
  const percentFor = (predicate: (asset: FinanceAsset) => boolean) => (totalAssetsCny ? roundMoney((valueFor(predicate) / totalAssetsCny) * 100, 4) : 0);

  const pendingFx = data.transactions.filter((transaction) => transaction.type === 'FX_CONVERSION' && transaction.status === 'pending');
  const pendingTrades = data.transactions.filter((transaction) => transaction.type !== 'FX_CONVERSION' && transaction.status === 'pending');
  const staleHoldings = holdings.filter((holding) => holding.isStale && !isCashAsset(holding.asset));
  const alerts = new Set<string>();
  pendingFx.forEach((transaction) => alerts.add(`存在待确认换汇交易：${transaction.fromCurrency ?? ''} -> ${transaction.toAmount ?? ''} ${transaction.toCurrency ?? ''}。`));
  pendingTrades.forEach((transaction) => {
    const asset = transaction.assetId ? assetMap.get(transaction.assetId) : null;
    alerts.add(`存在待确认交易：${asset?.name ?? transaction.platform ?? transaction.type}，预计确认日 ${transaction.confirmDate ?? '待补充'}。`);
  });
  staleHoldings.forEach((holding) => alerts.add(`${holding.asset.name} 行情可能已过期或更新失败。`));
  holdings.filter((holding) => holding.costNative === null && !isCashAsset(holding.asset)).forEach((holding) => alerts.add(`${holding.asset.name} 缺少起算基准。`));
  holdings.flatMap((holding) => holding.issues).forEach((issue) => alerts.add(issue));

  return {
    generatedAt: nowISO(),
    holdings,
    totalAssetsCny,
    investedAssetsCny,
    availableCashCny,
    todayPnlCny,
    cumulativePnlCny,
    cumulativeReturnRate,
    usdRelatedPercent: percentFor((asset) => asset.currency === 'USD' || asset.currency === 'USDT' || asset.currency === 'USDC' || asset.marketExposure === 'USD_CashLike' || asset.marketExposure === 'Stablecoin'),
    equityPercent: percentFor((asset) => asset.riskBucket === 'core_equity' || asset.riskBucket === 'satellite_equity'),
    lowVolatilityPercent: percentFor((asset) => asset.riskBucket === 'low_volatility'),
    stablecoinPlatformPercent: percentFor((asset) => asset.riskBucket === 'platform_exploration' || asset.assetType === 'CRYPTO_STABLECOIN_EARN'),
    latestQuoteFetchedAt: latestQuoteFetchedAt(data),
    alerts: Array.from(alerts),
    byGroup: allocationRows(holdings, totalAssetsCny, (holding) => holding.asset.groupId, (key) => financeGroupLabels[key] ?? key),
    byCurrency: allocationRows(holdings, totalAssetsCny, (holding) => holding.asset.currency, (key) => key),
    byMarket: allocationRows(holdings, totalAssetsCny, (holding) => holding.asset.marketExposure, (key) => financeMarketExposureLabels[key as keyof typeof financeMarketExposureLabels] ?? key),
    byRisk: allocationRows(holdings, totalAssetsCny, (holding) => holding.asset.riskBucket, (key) => financeRiskBucketLabels[key as keyof typeof financeRiskBucketLabels] ?? key),
    targetRows: targetRows(data, holdings, totalAssetsCny),
  };
}
