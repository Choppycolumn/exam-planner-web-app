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

export function roundNumber(value, digits = 6) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round((number + Number.EPSILON) * factor) / factor;
}

export function nowInTimezones(date = new Date()) {
  const format = (timeZone) =>
    new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  return {
    shanghai: format('Asia/Shanghai'),
    tokyo: format('Asia/Tokyo'),
    newYork: format('America/New_York'),
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
  return { date: iso, timezone, isTradingDay: true, sessionType: halfDays.has(iso) ? 'half_day' : 'regular', openTime: '09:30', closeTime: halfDays.has(iso) ? '13:00' : '16:00' };
}

function ensureAsset(map, key, seed = {}) {
  if (!map.has(key)) {
    map.set(key, {
      key,
      accountId: seed.accountId ?? null,
      accountName: seed.accountName || '',
      symbol: seed.symbol || key,
      quantity: 0,
      costBasis: 0,
      averageCost: 0,
      realizedPnl: 0,
      cumulativeFees: {},
      costReviewRequired: false,
      locked: Boolean(seed.locked),
      highRisk: Boolean(seed.highRisk),
    });
  }
  return map.get(key);
}

function addFee(position, currency, amount) {
  const fee = Number(amount || 0);
  if (!currency || fee <= 0) return;
  position.cumulativeFees[currency] = roundNumber((position.cumulativeFees[currency] || 0) + fee, 8);
}

function addBalance(map, key, delta, meta = {}) {
  if (!map.has(key)) {
    map.set(key, {
      key,
      accountId: meta.accountId ?? null,
      accountName: meta.accountName || '',
      symbol: meta.symbol || key,
      quantity: 0,
      locked: Boolean(meta.locked),
      highRisk: Boolean(meta.highRisk),
    });
  }
  const row = map.get(key);
  row.quantity = roundNumber(row.quantity + Number(delta || 0), 8);
  row.locked = row.locked || Boolean(meta.locked);
  row.highRisk = row.highRisk || Boolean(meta.highRisk);
}

function quoteDeltaForTransaction(type, leg) {
  const nominal = Number(leg.nominalAmount ?? leg.nominal_amount ?? 0);
  const fee = Number(leg.feeAmount ?? leg.fee_amount ?? 0);
  const quote = leg.quoteCurrency || leg.quote_currency || 'USDT';
  const feeCurrency = leg.feeCurrency || leg.fee_currency || quote;
  if (type === 'buy') return { currency: quote, amount: -(nominal + (feeCurrency === quote ? fee : 0)) };
  if (type === 'sell') return { currency: quote, amount: nominal - (feeCurrency === quote ? fee : 0) };
  return null;
}

export function calculateLedger({ transactions = [], manualPrices = {}, accounts = [], instruments = [] } = {}) {
  const accountMap = new Map(accounts.map((account) => [Number(account.id), account]));
  const instrumentMap = new Map(instruments.map((instrument) => [instrument.symbol, instrument]));
  const positions = new Map();
  const balances = new Map();
  const issues = [];

  const sorted = [...transactions]
    .filter((tx) => !tx.isDeleted && !tx.isVoid && !tx.isVoided && !['deleted', 'voided'].includes(tx.status))
    .filter((tx) => tx.migrationState !== 'example_pending' && tx.migrationState !== 'archived')
    .sort((a, b) => String(a.occurredAt || a.occurred_at).localeCompare(String(b.occurredAt || b.occurred_at)) || Number(a.id || 0) - Number(b.id || 0));

  for (const tx of sorted) {
    const type = tx.transactionType || tx.transaction_type || 'other';
    const txAccount = accountMap.get(Number(tx.accountId ?? tx.account_id));
    for (const rawLeg of tx.legs || []) {
      const symbol = rawLeg.instrumentSymbol || rawLeg.instrument_symbol;
      if (!symbol) continue;
      const accountId = Number(rawLeg.accountId ?? rawLeg.account_id ?? tx.accountId ?? tx.account_id ?? 0) || null;
      const account = accountMap.get(Number(accountId)) || txAccount || {};
      const instrument = instrumentMap.get(symbol) || {};
      const locked = rawLeg.lockState === 'locked' || rawLeg.lock_state === 'locked' || account.isLockedDefault || account.is_locked_default || instrument.isLockedDefault || instrument.is_locked_default;
      const highRisk = instrument.isHighRiskDefault || instrument.is_high_risk_default || ['USDGO', 'rSPCX'].includes(symbol);
      const quantity = Number(rawLeg.quantity || 0);
      const quote = rawLeg.quoteCurrency || rawLeg.quote_currency || instrument.quoteCurrency || instrument.quote_currency || 'USDT';
      const nominal = Number(rawLeg.nominalAmount ?? rawLeg.nominal_amount ?? Math.abs(quantity) * Number(rawLeg.unitPrice ?? rawLeg.unit_price ?? 0));
      const fee = Number(rawLeg.feeAmount ?? rawLeg.fee_amount ?? 0);
      const feeCurrency = rawLeg.feeCurrency || rawLeg.fee_currency || quote;
      const positionKey = `${accountId || 'manual'}:${symbol}`;

      if (['buy', 'sell'].includes(type) && !['USDT', 'USDC', 'USD', 'CNY'].includes(symbol)) {
        const position = ensureAsset(positions, positionKey, { accountId, accountName: account.name, symbol, locked, highRisk });
        addFee(position, feeCurrency, fee);
        if (fee > 0 && feeCurrency !== quote) {
          position.costReviewRequired = true;
          issues.push({ level: 'warning', code: 'FEE_CURRENCY_REVIEW', message: `${symbol} 手续费币种 ${feeCurrency} 与计价币种 ${quote} 不同，成本待核对。`, transactionId: tx.id });
        }
        if (type === 'buy') {
          const feeInQuote = feeCurrency === quote ? fee : 0;
          position.quantity += Math.abs(quantity);
          position.costBasis += nominal + feeInQuote;
        } else {
          const sellQuantity = Math.min(Math.abs(quantity), Math.max(0, position.quantity));
          const avg = position.quantity > EPSILON ? position.costBasis / position.quantity : 0;
          const feeInQuote = feeCurrency === quote ? fee : 0;
          position.realizedPnl += (nominal - feeInQuote) - avg * sellQuantity;
          position.quantity -= sellQuantity;
          position.costBasis -= avg * sellQuantity;
        }
        if (position.quantity <= EPSILON) {
          position.quantity = 0;
          position.costBasis = 0;
        }
        position.averageCost = position.quantity > EPSILON ? position.costBasis / position.quantity : 0;
      } else {
        addBalance(balances, positionKey, quantity, { accountId, accountName: account.name, symbol, locked, highRisk });
      }

      const quoteDelta = quoteDeltaForTransaction(type, { ...rawLeg, quoteCurrency: quote, nominalAmount: nominal, feeAmount: fee, feeCurrency });
      if (quoteDelta) {
        addBalance(balances, `${accountId || 'manual'}:${quoteDelta.currency}`, quoteDelta.amount, {
          accountId,
          accountName: account.name,
          symbol: quoteDelta.currency,
          locked,
          highRisk: false,
        });
      }
      if (fee > 0 && feeCurrency !== quote) {
        addBalance(balances, `${accountId || 'manual'}:${feeCurrency}`, -fee, { accountId, accountName: account.name, symbol: feeCurrency, locked, highRisk: false });
      }
    }
  }

  const positionList = [...positions.values()].map((position) => {
    const referencePrice = Number(manualPrices[position.symbol] || 0);
    const marketValue = referencePrice > 0 ? position.quantity * referencePrice : 0;
    return {
      ...position,
      quantity: roundNumber(position.quantity, 8),
      costBasis: roundNumber(position.costBasis, 6),
      averageCost: roundNumber(position.averageCost, 6),
      realizedPnl: roundNumber(position.realizedPnl, 6),
      referencePrice: referencePrice || null,
      marketValue: roundNumber(marketValue, 6),
      unrealizedPnl: referencePrice > 0 ? roundNumber(marketValue - position.costBasis, 6) : null,
    };
  });

  const balancesList = [...balances.values()].map((balance) => ({ ...balance, quantity: roundNumber(balance.quantity, 8) }));
  const freeCash = balancesList.filter((row) => !row.locked && ['USDT', 'USDC', 'USD', 'CNY'].includes(row.symbol));
  const lockedBalances = balancesList.filter((row) => row.locked || row.highRisk);
  const freeUsdt = freeCash.filter((row) => row.symbol === 'USDT').reduce((sum, row) => sum + row.quantity, 0);
  const freeUsdc = freeCash.filter((row) => row.symbol === 'USDC').reduce((sum, row) => sum + row.quantity, 0);
  const freeUsd = freeCash.filter((row) => row.symbol === 'USD').reduce((sum, row) => sum + row.quantity, 0);
  const qqqAmmoUsdt = Math.max(0, freeUsdt);
  const totalCostBasis = positionList.reduce((sum, row) => sum + Math.max(0, row.costBasis || 0), 0);

  return {
    positions: positionList,
    balances: balancesList,
    freeCash,
    lockedBalances,
    freeUsdt: roundNumber(freeUsdt, 6),
    freeUsdc: roundNumber(freeUsdc, 6),
    freeUsd: roundNumber(freeUsd, 6),
    qqqAmmoUsdt: roundNumber(qqqAmmoUsdt, 6),
    lockedValueUsdt: roundNumber(lockedBalances.filter((row) => row.symbol === 'USDT' || row.symbol === 'USDGO').reduce((sum, row) => sum + Math.max(0, row.quantity), 0), 6),
    assetAllocation: positionList.map((row) => ({
      symbol: row.symbol,
      value: row.costBasis,
      weight: totalCostBasis > 0 ? roundNumber((row.costBasis / totalCostBasis) * 100, 2) : 0,
    })),
    totals: {
      costBasis: roundNumber(totalCostBasis, 6),
      realizedPnl: roundNumber(positionList.reduce((sum, row) => sum + Number(row.realizedPnl || 0), 0), 6),
      unrealizedPnl: roundNumber(positionList.reduce((sum, row) => sum + Number(row.unrealizedPnl || 0), 0), 6),
    },
    issues,
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

export function safeFence(value) {
  return String(value ?? '').replace(/```/g, '` ` `');
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '').replace(/\r\n/g, '\n');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted && char === '"' && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && char === '\n') {
      row.push(cell);
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}
