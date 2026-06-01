import type { FinanceAsset, FinanceData, FinanceExchangeRate, FinanceQuote } from '../../types/finance';
import { newFinanceId, nowISO, todayDateISO } from './calculations';

type PublicFundQuoteResponse = {
  code: string;
  name?: string;
  fundCompany?: string;
  fundType?: string;
  minSubscription?: number | null;
  isBuy?: string | null;
  price: number;
  priceDate: string;
  source: string;
  provider: 'eastmoney-fund';
  raw?: unknown;
};

export type FinanceQuoteProgress = {
  current: number;
  total: number;
  label: string;
};

async function fetchJson<T>(url: string, timeoutMs = 8_000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function normalizeDateKey(value?: string | null) {
  return String(value || '').slice(0, 10);
}

function historicalBaselineDate(previousDate?: string | null, currentDate?: string | null) {
  const previous = normalizeDateKey(previousDate);
  const current = normalizeDateKey(currentDate);
  return previous && current && previous < current ? previous : '';
}

function quoteBaseline(
  previous: FinanceQuote | undefined,
  nextPriceDate: string,
  fallbackPrice: number | null = null,
  fallbackDate = '',
) {
  const currentDate = normalizeDateKey(nextPriceDate);
  const directPrice = typeof previous?.price === 'number' && Number.isFinite(previous.price) ? previous.price : fallbackPrice;
  const directDate = normalizeDateKey(previous?.priceDate || fallbackDate);
  const preservedPrice = typeof previous?.previousPrice === 'number' && Number.isFinite(previous.previousPrice) ? previous.previousPrice : null;
  const preservedDate = normalizeDateKey(previous?.previousPriceDate);
  const directHistoricalDate = historicalBaselineDate(directDate, currentDate);
  if (directHistoricalDate) return { previousPrice: directPrice, previousPriceDate: directHistoricalDate };
  const preservedHistoricalDate = historicalBaselineDate(preservedDate, currentDate);
  if (preservedHistoricalDate) return { previousPrice: preservedPrice, previousPriceDate: preservedHistoricalDate };
  return { previousPrice: null, previousPriceDate: '' };
}

function rateBaseline(previous: FinanceExchangeRate | undefined, nextAsOfDate: string) {
  const currentDate = normalizeDateKey(nextAsOfDate);
  const directRate = typeof previous?.rate === 'number' && Number.isFinite(previous.rate) ? previous.rate : null;
  const directDate = normalizeDateKey(previous?.asOfDate);
  const preservedRate = typeof previous?.previousRate === 'number' && Number.isFinite(previous.previousRate) ? previous.previousRate : null;
  const preservedDate = normalizeDateKey(previous?.previousAsOfDate);
  const directHistoricalDate = historicalBaselineDate(directDate, currentDate);
  if (directHistoricalDate) return { previousRate: directRate, previousAsOfDate: directHistoricalDate };
  const preservedHistoricalDate = historicalBaselineDate(preservedDate, currentDate);
  if (preservedHistoricalDate) return { previousRate: preservedRate, previousAsOfDate: preservedHistoricalDate };
  return { previousRate: null, previousAsOfDate: '' };
}

function failedQuote(asset: FinanceAsset, previous: FinanceQuote | undefined, error: unknown): FinanceQuote {
  const timestamp = nowISO();
  return {
    id: newFinanceId('quote'),
    targetId: asset.id,
    targetType: 'asset',
    price: previous?.price ?? asset.latestPrice ?? null,
    currency: asset.currency,
    priceDate: previous?.priceDate ?? asset.priceDate ?? todayDateISO(),
    fetchedAt: timestamp,
    source: previous?.source ?? asset.dataSource ?? asset.quoteProvider,
    provider: asset.quoteProvider,
    isManual: asset.quoteProvider === 'manual',
    failed: true,
    error: error instanceof Error ? error.message : String(error),
    previousPrice: previous?.previousPrice ?? null,
    previousPriceDate: previous?.previousPriceDate,
  };
}

function failedRate(pair: FinanceExchangeRate['pair'], previous: FinanceExchangeRate | undefined, error: unknown): FinanceExchangeRate {
  return {
    pair,
    rate: previous?.rate ?? null,
    source: previous?.source ?? '公开行情',
    provider: previous?.provider ?? (pair === 'USD/CNY' ? 'frankfurter-fx' : 'coingecko-stablecoin'),
    asOfDate: previous?.asOfDate ?? todayDateISO(),
    fetchedAt: nowISO(),
    isManual: false,
    failed: true,
    error: error instanceof Error ? error.message : String(error),
    previousRate: previous?.previousRate ?? null,
    previousAsOfDate: previous?.previousAsOfDate,
  };
}

async function fetchEastMoneyFund(asset: FinanceAsset, previous: FinanceQuote | undefined): Promise<FinanceQuote> {
  const code = asset.quoteSymbol || asset.symbol;
  if (!code) throw new Error('缺少基金代码。');
  const payload = await fetchPublicFundQuoteByCode(code);
  const price = Number(payload.price || 0);
  if (!Number.isFinite(price) || price <= 0) throw new Error('基金净值为空。');
  const baseline = quoteBaseline(previous, payload.priceDate || todayDateISO(), asset.latestPrice ?? null, asset.priceDate);
  return {
    id: newFinanceId('quote'),
    targetId: asset.id,
    targetType: 'asset',
    price,
    currency: asset.currency,
    priceDate: payload.priceDate || todayDateISO(),
    fetchedAt: nowISO(),
    source: payload.source,
    provider: 'eastmoney-fund',
    isManual: false,
    failed: false,
    previousPrice: baseline.previousPrice,
    previousPriceDate: baseline.previousPriceDate,
    raw: payload.raw ?? payload,
  };
}

export async function fetchPublicFundQuoteByCode(code: string, priceDate?: string, includeProfile = false) {
  const params = new URLSearchParams({ code });
  if (priceDate) params.set('date', priceDate);
  if (includeProfile) params.set('profile', '1');
  return fetchJson<PublicFundQuoteResponse>(`/api/finance-public/fund?${params.toString()}`, 10_000);
}

async function fetchUsdCny(previous: FinanceExchangeRate | undefined): Promise<FinanceExchangeRate> {
  const data = await fetchJson<{ rate: number; asOfDate: string; source: string; provider: 'frankfurter-fx' }>('/api/finance-public/usd-cny', 10_000);
  const rate = Number(data.rate || 0);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('USD/CNY 汇率为空。');
  const baseline = rateBaseline(previous, data.asOfDate || todayDateISO());
  return {
    pair: 'USD/CNY',
    rate,
    source: data.source,
    provider: data.provider,
    asOfDate: data.asOfDate || todayDateISO(),
    fetchedAt: nowISO(),
    isManual: false,
    failed: false,
    previousRate: baseline.previousRate,
    previousAsOfDate: baseline.previousAsOfDate,
  };
}

async function fetchStablecoinRates(previous: Partial<Record<FinanceExchangeRate['pair'], FinanceExchangeRate>>) {
  const data = await fetchJson<{
    asOfDate: string;
    source: string;
    provider: 'coingecko-stablecoin';
    rates: { 'USDT/CNY': number; 'USDC/CNY': number };
  }>('/api/finance-public/stablecoin-rates', 10_000);
  const tetherCny = Number(data.rates['USDT/CNY'] || 0);
  const usdcCny = Number(data.rates['USDC/CNY'] || 0);
  if (!Number.isFinite(tetherCny) || tetherCny <= 0 || !Number.isFinite(usdcCny) || usdcCny <= 0) {
    throw new Error('稳定币价格为空。');
  }
  const timestamp = nowISO();
  const usdtBaseline = rateBaseline(previous['USDT/CNY'], data.asOfDate || todayDateISO());
  const usdcBaseline = rateBaseline(previous['USDC/CNY'], data.asOfDate || todayDateISO());
  return {
    'USDT/CNY': {
      pair: 'USDT/CNY',
      rate: tetherCny,
      source: data.source,
      provider: data.provider,
      asOfDate: data.asOfDate || todayDateISO(),
      fetchedAt: timestamp,
      isManual: false,
      failed: false,
      previousRate: usdtBaseline.previousRate,
      previousAsOfDate: usdtBaseline.previousAsOfDate,
    },
    'USDC/CNY': {
      pair: 'USDC/CNY',
      rate: usdcCny,
      source: data.source,
      provider: data.provider,
      asOfDate: data.asOfDate || todayDateISO(),
      fetchedAt: timestamp,
      isManual: false,
      failed: false,
      previousRate: usdcBaseline.previousRate,
      previousAsOfDate: usdcBaseline.previousAsOfDate,
    },
  } satisfies Pick<Record<FinanceExchangeRate['pair'], FinanceExchangeRate>, 'USDT/CNY' | 'USDC/CNY'>;
}

function stablecoinPairForCurrency(currency: FinanceAsset['currency']): FinanceExchangeRate['pair'] | null {
  if (currency === 'USDT') return 'USDT/CNY';
  if (currency === 'USDC') return 'USDC/CNY';
  return null;
}

function stablecoinAssetQuote(
  asset: FinanceAsset,
  previous: FinanceQuote | undefined,
  exchangeRates: Partial<Record<FinanceExchangeRate['pair'], FinanceExchangeRate>>,
): FinanceQuote {
  const pair = stablecoinPairForCurrency(asset.currency);
  const rate = pair ? exchangeRates[pair] : null;
  if (!pair || !rate?.rate || rate.failed) throw new Error(`${asset.currency} 公开价格缺失。`);
  const baseline = quoteBaseline(previous, rate.asOfDate, asset.latestPrice ?? 1, asset.priceDate);
  return {
    id: newFinanceId('quote'),
    targetId: asset.id,
    targetType: 'asset',
    price: 1,
    currency: asset.currency,
    priceDate: rate.asOfDate,
    fetchedAt: nowISO(),
    source: `${rate.source}（${pair} ${rate.rate}）`,
    provider: 'coingecko-stablecoin',
    isManual: false,
    failed: false,
    previousPrice: baseline.previousPrice,
    previousPriceDate: baseline.previousPriceDate,
    raw: { pair, rate: rate.rate, note: '稳定币价格仅用于估值，参考 APR 不计入实际收益。' },
  };
}

async function fetchAssetQuote(
  asset: FinanceAsset,
  previous: FinanceQuote | undefined,
  exchangeRates: Partial<Record<FinanceExchangeRate['pair'], FinanceExchangeRate>>,
): Promise<FinanceQuote | null> {
  if (asset.quoteProvider === 'manual') return null;
  if (asset.quoteProvider === 'eastmoney-fund') return fetchEastMoneyFund(asset, previous);
  if (asset.quoteProvider === 'coingecko-stablecoin') return stablecoinAssetQuote(asset, previous, exchangeRates);
  return null;
}

export async function updatePublicFinanceQuotes(
  data: FinanceData,
  onProgress?: (progress: FinanceQuoteProgress) => void,
): Promise<FinanceData> {
  const startedAt = nowISO();
  const quoteAssets = data.assets.filter((asset) => asset.quoteProvider !== 'manual');
  const totalSteps = 2 + quoteAssets.length;
  let currentStep = 0;
  const progress = (label: string) => {
    onProgress?.({ current: Math.min(currentStep, totalSteps), total: totalSteps, label });
  };
  const next: FinanceData = {
    ...data,
    quotes: { ...data.quotes },
    exchangeRates: { ...data.exchangeRates },
    quoteLogs: [...data.quoteLogs],
    updatedAt: nowISO(),
  };
  const messages: string[] = [];
  let ok = true;

  progress('更新 USD/CNY 汇率');
  try {
    next.exchangeRates['USD/CNY'] = await fetchUsdCny(data.exchangeRates['USD/CNY']);
    messages.push('USD/CNY 汇率已更新。');
  } catch (error) {
    ok = false;
    next.exchangeRates['USD/CNY'] = failedRate('USD/CNY', data.exchangeRates['USD/CNY'], error);
    messages.push(`USD/CNY 汇率更新失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    currentStep += 1;
  }

  progress('更新 USDT/USDC 价格');
  try {
    const stableRates = await fetchStablecoinRates(data.exchangeRates);
    next.exchangeRates['USDT/CNY'] = stableRates['USDT/CNY'];
    next.exchangeRates['USDC/CNY'] = stableRates['USDC/CNY'];
    messages.push('USDT/USDC 价格已更新。');
  } catch (error) {
    ok = false;
    next.exchangeRates['USDT/CNY'] = failedRate('USDT/CNY', data.exchangeRates['USDT/CNY'], error);
    next.exchangeRates['USDC/CNY'] = failedRate('USDC/CNY', data.exchangeRates['USDC/CNY'], error);
    messages.push(`稳定币估值更新失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    currentStep += 1;
  }

  for (const asset of next.assets) {
    if (asset.quoteProvider === 'manual') continue;
    progress(`更新 ${asset.name}`);
    const previous = data.quotes[asset.id];
    try {
      const quote = await fetchAssetQuote(asset, previous, next.exchangeRates);
      if (quote) {
        next.quotes[asset.id] = quote;
        messages.push(`${asset.name} 价格/净值已更新。`);
      }
    } catch (error) {
      ok = false;
      next.quotes[asset.id] = failedQuote(asset, previous, error);
      messages.push(`${asset.name} 行情更新失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      currentStep += 1;
    }
  }
  progress('保存行情结果');

  next.quoteLogs.unshift({
    id: newFinanceId('quote-log'),
    startedAt,
    finishedAt: nowISO(),
    ok,
    source: '公开行情适配器',
    message: messages.join(' '),
  });
  next.quoteLogs = next.quoteLogs.slice(0, 40);
  return next;
}

export function manualAssetQuote(asset: FinanceAsset, price: number, priceDate: string, source = '手动录入', previous?: FinanceQuote): FinanceQuote {
  const baseline = quoteBaseline(previous, priceDate, asset.latestPrice ?? null, asset.priceDate);
  return {
    id: newFinanceId('quote'),
    targetId: asset.id,
    targetType: 'asset',
    price,
    currency: asset.currency,
    priceDate,
    fetchedAt: nowISO(),
    source,
    provider: 'manual',
    isManual: true,
    failed: false,
    previousPrice: baseline.previousPrice,
    previousPriceDate: baseline.previousPriceDate,
  };
}

export function manualExchangeRate(pair: FinanceExchangeRate['pair'], rate: number, asOfDate: string, previous?: FinanceExchangeRate): FinanceExchangeRate {
  const baseline = rateBaseline(previous, asOfDate);
  return {
    pair,
    rate,
    source: '手动录入',
    provider: 'manual',
    asOfDate,
    fetchedAt: nowISO(),
    isManual: true,
    failed: false,
    previousRate: baseline.previousRate,
    previousAsOfDate: baseline.previousAsOfDate,
  };
}

export async function fetchEastMoneyFundTextForDebug(code: string) {
  return fetchPublicFundQuoteByCode(code);
}
