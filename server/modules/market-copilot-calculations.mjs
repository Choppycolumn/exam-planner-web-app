const EPSILON = 1e-9;

export const DEFAULT_INSTRUMENTS = [
  { symbol: 'rQQQ', name: 'rQQQ 代币化代理', assetClass: 'tokenized_equity', quoteCurrency: 'USDT' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', assetClass: 'etf', quoteCurrency: 'USD' },
  { symbol: 'MSTR', name: 'MicroStrategy', assetClass: 'equity', quoteCurrency: 'USD' },
  { symbol: 'BTC', name: 'Bitcoin', assetClass: 'crypto', quoteCurrency: 'USD' },
  { symbol: 'USDGO', name: 'USDGO', assetClass: 'stable_asset', quoteCurrency: 'USDT', locked: true, highRisk: true },
  { symbol: 'rSPCX', name: 'rSPCX', assetClass: 'tokenized_equity', quoteCurrency: 'USDT', locked: true, highRisk: true },
  { symbol: 'USDT', name: 'Tether USD', assetClass: 'cash', quoteCurrency: 'USDT' },
  { symbol: 'USDC', name: 'USD Coin', assetClass: 'cash', quoteCurrency: 'USD' },
  { symbol: 'CNY', name: '人民币', assetClass: 'cash', quoteCurrency: 'CNY' },
];

export const MARKET_WATCHLIST = [
  { symbol: 'QQQ', name: 'QQQ' },
  { symbol: 'NQ', name: 'Nasdaq 100 Futures / NQ' },
  { symbol: 'SOXX', name: 'SOXX' },
  { symbol: 'NVDA', name: 'NVDA' },
  { symbol: 'VIX', name: 'VIX' },
  { symbol: 'US10Y', name: '美国十年期国债收益率' },
  { symbol: 'DXY', name: '美元指数 DXY' },
  { symbol: 'BTC-USD', name: 'BTC-USD' },
  { symbol: 'MSTR', name: 'MSTR' },
  { symbol: 'USD-CNY', name: 'USD/CNY 参考汇率' },
];

export function roundNumber(value, digits = 6) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

function transactionGross(tx) {
  const gross = Number(tx.grossAmount ?? tx.gross_amount ?? 0);
  if (gross > 0) return gross;
  return Number(tx.price || 0) * Number(tx.quantity || 0);
}

function normalizeAction(action = '') {
  const value = String(action).trim();
  if (['买入', 'buy'].includes(value)) return 'buy';
  if (['卖出', 'sell'].includes(value)) return 'sell';
  if (['转入', 'transfer_in'].includes(value)) return 'transfer_in';
  if (['转出', 'transfer_out'].includes(value)) return 'transfer_out';
  if (['换汇', 'exchange'].includes(value)) return 'exchange';
  if (['锁定', 'lock'].includes(value)) return 'lock';
  if (['解锁', 'unlock'].includes(value)) return 'unlock';
  return value || 'other';
}

function ensurePosition(map, symbol) {
  if (!map.has(symbol)) {
    map.set(symbol, {
      symbol,
      quantity: 0,
      costBasis: 0,
      averageCost: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      marketValue: 0,
      cumulativeFees: {},
      confirmedTransactions: 0,
    });
  }
  return map.get(symbol);
}

function addFee(position, currency, amount) {
  const fee = Number(amount || 0);
  if (!currency || fee <= 0) return;
  position.cumulativeFees[currency] = roundNumber((position.cumulativeFees[currency] || 0) + fee, 8);
}

function addCash(cash, currency, delta) {
  if (!currency) return;
  cash[currency] = roundNumber((cash[currency] || 0) + Number(delta || 0), 8);
}

export function calculateLedger({
  transactions = [],
  cashBalances = [],
  lockedPositions = [],
  prices = {},
  quoteCurrencies = {},
} = {}) {
  const positions = new Map();
  const cash = {};
  const lockedCash = {};

  for (const balance of cashBalances) {
    addCash(cash, balance.currency, Number(balance.amount || 0));
    addCash(lockedCash, balance.currency, Number(balance.lockedAmount ?? balance.locked_amount ?? 0));
  }

  const sorted = [...transactions]
    .filter((tx) => tx.confirmed !== false && Number(tx.confirmed ?? 1) !== 0)
    .sort((a, b) => String(a.tradedAt || a.traded_at).localeCompare(String(b.tradedAt || b.traded_at)) || Number(a.id || 0) - Number(b.id || 0));

  for (const tx of sorted) {
    const symbol = tx.instrumentSymbol || tx.instrument_symbol;
    const action = normalizeAction(tx.action);
    const quantity = Math.max(0, Number(tx.quantity || 0));
    const gross = transactionGross(tx);
    const quote = quoteCurrencies[symbol] || tx.quoteCurrency || tx.quote_currency || 'USDT';
    const feeCurrency = tx.feeCurrency || tx.fee_currency || quote;
    const fee = Number(tx.feeAmount ?? tx.fee_amount ?? 0);
    const position = ensurePosition(positions, symbol);
    position.confirmedTransactions += 1;
    addFee(position, feeCurrency, fee);

    if (action === 'buy') {
      const feeInQuote = feeCurrency === quote ? fee : 0;
      position.quantity += quantity;
      position.costBasis += gross + feeInQuote;
      addCash(cash, quote, -(gross + feeInQuote));
      if (fee > 0 && feeCurrency !== quote) addCash(cash, feeCurrency, -fee);
    } else if (action === 'sell') {
      const sellQuantity = Math.min(quantity, Math.max(0, position.quantity));
      const averageCost = position.quantity > EPSILON ? position.costBasis / position.quantity : 0;
      const feeInQuote = feeCurrency === quote ? fee : 0;
      const proceeds = gross - feeInQuote;
      position.realizedPnl += proceeds - averageCost * sellQuantity;
      position.quantity -= sellQuantity;
      position.costBasis -= averageCost * sellQuantity;
      addCash(cash, quote, proceeds);
      if (fee > 0 && feeCurrency !== quote) addCash(cash, feeCurrency, -fee);
    } else if (action === 'transfer_in') {
      position.quantity += quantity;
      position.costBasis += gross;
      if (symbol === quote) addCash(cash, symbol, quantity);
    } else if (action === 'transfer_out') {
      const outQuantity = Math.min(quantity, Math.max(0, position.quantity));
      const averageCost = position.quantity > EPSILON ? position.costBasis / position.quantity : 0;
      position.quantity -= outQuantity;
      position.costBasis -= averageCost * outQuantity;
      if (symbol === quote) addCash(cash, symbol, -quantity);
    } else if (action === 'lock') {
      addCash(lockedCash, symbol, quantity);
      addCash(cash, symbol, -quantity);
    } else if (action === 'unlock') {
      addCash(lockedCash, symbol, -quantity);
      addCash(cash, symbol, quantity);
    }

    if (position.quantity <= EPSILON) {
      position.quantity = 0;
      position.costBasis = 0;
    }
    position.averageCost = position.quantity > EPSILON ? position.costBasis / position.quantity : 0;
  }

  const locked = lockedPositions.map((item) => {
    const symbol = item.instrumentSymbol || item.instrument_symbol;
    const quantity = Number(item.quantity || 0);
    const referencePrice = Number(item.referencePrice ?? item.reference_price ?? prices[symbol] ?? 0);
    return {
      id: item.id,
      symbol,
      quantity: roundNumber(quantity, 8),
      referencePrice: roundNumber(referencePrice, 8),
      valueUsdt: roundNumber(quantity * referencePrice, 4),
      category: item.category || '锁定仓',
      riskLevel: item.riskLevel || item.risk_level || 'high',
      includeInAmmo: Boolean(item.includeInAmmo ?? item.include_in_ammo ?? false),
      note: item.note || '',
    };
  });

  const positionList = [...positions.values()].map((position) => {
    const price = Number(prices[position.symbol] || 0);
    const marketValue = price > 0 ? position.quantity * price : 0;
    const unrealizedPnl = price > 0 ? marketValue - position.costBasis : 0;
    return {
      ...position,
      quantity: roundNumber(position.quantity, 8),
      costBasis: roundNumber(position.costBasis, 6),
      averageCost: roundNumber(position.averageCost, 6),
      realizedPnl: roundNumber(position.realizedPnl, 6),
      unrealizedPnl: roundNumber(unrealizedPnl, 6),
      marketValue: roundNumber(marketValue, 6),
      referencePrice: price || null,
    };
  });

  const totalMarketValue = positionList.reduce((sum, item) => sum + Math.max(0, item.marketValue || 0), 0);
  const assetAllocation = positionList.map((item) => ({
    symbol: item.symbol,
    value: item.marketValue,
    weight: totalMarketValue > 0 ? roundNumber((item.marketValue / totalMarketValue) * 100, 2) : 0,
  }));
  const lockedValueUsdt = locked.filter((item) => !item.includeInAmmo).reduce((sum, item) => sum + item.valueUsdt, 0);
  const freeUsdt = roundNumber((cash.USDT || 0) - (lockedCash.USDT || 0), 6);

  return {
    positions: positionList,
    cash,
    lockedCash,
    lockedPositions: locked,
    freeUsdt,
    lockedValueUsdt: roundNumber(lockedValueUsdt, 6),
    qqqAmmoUsdt: roundNumber(Math.max(0, freeUsdt), 6),
    assetAllocation,
    totals: {
      marketValue: roundNumber(totalMarketValue, 6),
      realizedPnl: roundNumber(positionList.reduce((sum, item) => sum + item.realizedPnl, 0), 6),
      unrealizedPnl: roundNumber(positionList.reduce((sum, item) => sum + item.unrealizedPnl, 0), 6),
    },
  };
}

export function calculateDayOrderPlan({ availableUsdt = 0, feeRate = 0, legs = [] } = {}) {
  const normalizedLegs = legs.map((leg, index) => {
    const amount = Math.max(0, Number(leg.amountUsdt ?? leg.amount_usdt ?? 0));
    const price = Math.max(0, Number(leg.limitPrice ?? leg.limit_price ?? 0));
    const expectedFee = roundNumber(amount * Math.max(0, Number(feeRate || 0)), 6);
    const spendable = Math.max(0, amount - expectedFee);
    const expectedQuantity = price > 0 ? Math.floor((spendable / price) * 1e8) / 1e8 : 0;
    return {
      levelIndex: Number(leg.levelIndex ?? leg.level_index ?? index + 1),
      limitPrice: roundNumber(price, 6),
      amountUsdt: roundNumber(amount, 6),
      expectedFee,
      expectedQuantity: roundNumber(expectedQuantity, 8),
      expectedGross: roundNumber(expectedQuantity * price, 6),
    };
  });
  const totalAmount = normalizedLegs.reduce((sum, item) => sum + item.amountUsdt, 0);
  const totalFee = normalizedLegs.reduce((sum, item) => sum + item.expectedFee, 0);
  return {
    legs: normalizedLegs,
    totalAmount: roundNumber(totalAmount, 6),
    totalFee: roundNumber(totalFee, 6),
    remainingUsdt: roundNumber(Number(availableUsdt || 0) - totalAmount, 6),
    exceedsAvailable: totalAmount - Number(availableUsdt || 0) > EPSILON,
  };
}

export function marketSessionForDate(date, { timezone = 'America/New_York' } = {}) {
  const iso = typeof date === 'string' ? date.slice(0, 10) : new Date(date).toISOString().slice(0, 10);
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  const holidays = new Set([
    '2026-01-01',
    '2026-01-19',
    '2026-02-16',
    '2026-04-03',
    '2026-05-25',
    '2026-06-19',
    '2026-07-03',
    '2026-09-07',
    '2026-11-26',
    '2026-12-25',
  ]);
  const halfDays = new Set(['2026-11-27', '2026-12-24']);
  if (day === 0 || day === 6) return { date: iso, timezone, isTradingDay: false, sessionType: 'weekend', openTime: null, closeTime: null };
  if (holidays.has(iso)) return { date: iso, timezone, isTradingDay: false, sessionType: 'holiday', openTime: null, closeTime: null };
  const close = halfDays.has(iso) ? '13:00' : '16:00';
  return { date: iso, timezone, isTradingDay: true, sessionType: halfDays.has(iso) ? 'half_day' : 'regular', openTime: '09:30', closeTime: close };
}

export function riskTagsForReport({ snapshots = [], macroEvents = [], orderPlans = [], session } = {}) {
  const tags = new Set();
  const nowMs = Date.now();
  if (snapshots.some((item) => item.delayStatus === 'stale' || (item.observedAt && nowMs - Date.parse(item.observedAt) > 60 * 60 * 1000))) tags.add('DATA_STALE');
  if (snapshots.some((item) => item.verificationStatus === 'mismatch')) tags.add('DATA_MISMATCH');
  if (macroEvents.length) tags.add('EVENT_RISK');
  if (orderPlans.some((plan) => plan.status === 'active')) tags.add('DAY_ORDER_EXPIRY');
  tags.add('LOCKED_FUNDS_EXCLUDED');
  if (session?.sessionType === 'half_day') tags.add('HALF_DAY_SESSION');
  return [...tags];
}
