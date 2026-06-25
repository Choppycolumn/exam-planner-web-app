import { sqlString, sqlValue } from './sqlite-repository.mjs';
import {
  DEFAULT_INSTRUMENTS,
  MARKET_WATCHLIST,
  calculateDayOrderPlan,
  calculateLedger,
  marketSessionForDate,
  riskTagsForReport,
  roundNumber,
} from './market-copilot-calculations.mjs';

const ACTIONS = new Set(['买入', '卖出', '转入', '转出', '换汇', '锁定', '解锁']);
const ORDER_TYPES = new Set(['市价', '限价', 'Day 限价', '其他']);

function nowISO() {
  return new Date().toISOString();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function rowToCamel(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()), value]));
}

function latestMap(rows) {
  const map = {};
  for (const row of rows) {
    if (map[row.symbol] === undefined && row.value !== null && row.value !== undefined) map[row.symbol] = Number(row.value);
  }
  return map;
}

function validateTransaction(input) {
  const symbol = String(input.instrumentSymbol || input.instrument_symbol || '').trim();
  if (!symbol) throw new Error('缺少标的');
  const action = ACTIONS.has(input.action) ? input.action : '买入';
  const orderType = ORDER_TYPES.has(input.orderType || input.order_type) ? (input.orderType || input.order_type) : '其他';
  const quantity = Math.max(0, Number(input.quantity || 0));
  if (!quantity && !['换汇'].includes(action)) throw new Error('数量必须大于 0');
  const price = Math.max(0, Number(input.price || 0));
  const grossAmount = Number(input.grossAmount ?? input.gross_amount ?? price * quantity);
  return {
    tradedAt: input.tradedAt || input.traded_at || nowISO(),
    instrumentSymbol: symbol,
    accountId: input.accountId || input.account_id || null,
    accountNameSnapshot: input.accountNameSnapshot || input.account_name_snapshot || '',
    action,
    price,
    quantity,
    grossAmount,
    feeAmount: Math.max(0, Number(input.feeAmount ?? input.fee_amount ?? 0)),
    feeCurrency: String(input.feeCurrency || input.fee_currency || 'USDT').trim().toUpperCase(),
    orderType,
    note: String(input.note || ''),
    confirmed: input.confirmed !== false && Number(input.confirmed ?? 1) !== 0,
  };
}

export function createMarketCopilotRepository(sqlite, { externalApiClient = null, notifyEvent = null, log = () => {} } = {}) {
  const seedIfEmpty = () => {
    const instrumentCount = Number(sqlite.scalar('SELECT COUNT(*) FROM instruments;') || 0);
    if (!instrumentCount) {
      for (const item of DEFAULT_INSTRUMENTS) {
        sqlite.run(`INSERT OR IGNORE INTO instruments
(symbol, name, asset_class, currency, quote_currency, is_locked_default, is_high_risk_default, notes, created_at, updated_at)
VALUES (${sqlString(item.symbol)}, ${sqlString(item.name)}, ${sqlString(item.assetClass)}, ${sqlString(item.symbol)}, ${sqlString(item.quoteCurrency)},
${sqlValue(Boolean(item.locked))}, ${sqlValue(Boolean(item.highRisk))}, ${sqlString('默认观察标的，可编辑')}, datetime('now'), datetime('now'));`);
      }
    }
    sqlite.run(`INSERT OR IGNORE INTO accounts (id, name, platform, base_currency, note, created_at, updated_at)
VALUES (1, '待核对示例账户', '手动账本', 'USDT', '系统预置的待核对示例账户，可删除或修改', datetime('now'), datetime('now'));`);
    const exampleCount = Number(sqlite.scalar("SELECT COUNT(*) FROM transactions WHERE note LIKE '%待用户核对的初始示例数据%';") || 0);
    if (!exampleCount) {
      sqlite.run(`INSERT INTO transactions
(traded_at, instrument_symbol, account_id, account_name_snapshot, action, price, quantity, gross_amount, fee_amount, fee_currency, order_type, note, confirmed, created_at, updated_at)
VALUES
(${sqlString(nowISO())}, 'USDT', 1, '待核对示例账户', '转入', 1, 60, 60, 0, 'USDT', '其他', '待用户核对的初始示例数据：为 rQQQ 示例仓位配平的 USDT 转入', 1, datetime('now'), datetime('now')),
(${sqlString(nowISO())}, 'rQQQ', 1, '待核对示例账户', '买入', 710.29, ${sqlValue(60 / 710.29)}, 60, 0, 'USDT', '其他', '待用户核对的初始示例数据：rQQQ 约 60 USDT，参考加权成本约 710.29', 1, datetime('now'), datetime('now'));`);
    }
    const lockedCount = Number(sqlite.scalar("SELECT COUNT(*) FROM locked_positions WHERE note LIKE '%待用户核对的初始示例数据%';") || 0);
    if (!lockedCount) {
      sqlite.run(`INSERT INTO locked_positions
(instrument_symbol, account_id, quantity, reference_price, category, risk_level, include_in_ammo, note, updated_at)
VALUES ('USDGO', 1, 110, 1, 'PoolX / 锁定仓', 'high', 0, '待用户核对的初始示例数据：PoolX / USDGO 110，锁定、高风险、不可用于 QQQ 补仓', datetime('now'));`);
    }
  };

  const listInstruments = () => sqlite.json(`SELECT symbol, name, asset_class AS assetClass, currency, quote_currency AS quoteCurrency,
is_active AS isActive, is_locked_default AS isLockedDefault, is_high_risk_default AS isHighRiskDefault,
manual_price AS manualPrice, manual_price_time AS manualPriceTime, notes, created_at AS createdAt, updated_at AS updatedAt
FROM instruments ORDER BY CASE symbol WHEN 'rQQQ' THEN 0 WHEN 'QQQ' THEN 1 WHEN 'USDT' THEN 2 ELSE 10 END, symbol;`);

  const listAccounts = () => sqlite.json(`SELECT id, name, platform, base_currency AS baseCurrency, is_active AS isActive, note, created_at AS createdAt, updated_at AS updatedAt
FROM accounts ORDER BY is_active DESC, name;`);

  const listTransactions = (limit = 200) => sqlite.json(`SELECT id, traded_at AS tradedAt, instrument_symbol AS instrumentSymbol, account_id AS accountId,
account_name_snapshot AS accountNameSnapshot, action, price, quantity, gross_amount AS grossAmount, fee_amount AS feeAmount,
fee_currency AS feeCurrency, order_type AS orderType, note, confirmed, created_at AS createdAt, updated_at AS updatedAt
FROM transactions ORDER BY traded_at DESC, id DESC LIMIT ${sqlValue(Number(limit || 200))};`);

  const listAllTransactions = () => sqlite.json(`SELECT id, traded_at AS tradedAt, instrument_symbol AS instrumentSymbol, account_id AS accountId,
account_name_snapshot AS accountNameSnapshot, action, price, quantity, gross_amount AS grossAmount, fee_amount AS feeAmount,
fee_currency AS feeCurrency, order_type AS orderType, note, confirmed, created_at AS createdAt, updated_at AS updatedAt
FROM transactions ORDER BY traded_at ASC, id ASC;`);

  const listCashBalances = () => sqlite.json(`SELECT id, currency, account_id AS accountId, amount, locked_amount AS lockedAmount, note, updated_at AS updatedAt
FROM cash_balances ORDER BY currency;`);

  const listLockedPositions = () => sqlite.json(`SELECT id, instrument_symbol AS instrumentSymbol, account_id AS accountId, quantity, reference_price AS referencePrice,
category, risk_level AS riskLevel, include_in_ammo AS includeInAmmo, note, updated_at AS updatedAt
FROM locked_positions ORDER BY include_in_ammo ASC, instrument_symbol;`);

  const latestSnapshots = (limitPerSymbol = 2) => sqlite.json(`WITH ranked AS (
  SELECT symbol, value, change_amount AS changeAmount, change_percent AS changePercent, observed_at AS observedAt,
    source_name AS sourceName, source_key AS sourceKey, source_url AS sourceUrl, delay_status AS delayStatus,
    verification_status AS verificationStatus, payload_json AS payloadJson, created_at AS createdAt,
    ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY observed_at DESC, id DESC) AS rn
  FROM market_snapshots
)
SELECT * FROM ranked WHERE rn <= ${sqlValue(Number(limitPerSymbol || 2))} ORDER BY symbol, rn;`).map((row) => ({ ...row, payload: parseJson(row.payloadJson, {}) }));

  const quoteCurrencies = () => Object.fromEntries(listInstruments().map((item) => [item.symbol, item.quoteCurrency || 'USDT']));

  const latestPrices = () => {
    const prices = latestMap(latestSnapshots(1));
    for (const item of listInstruments()) {
      if (item.manualPrice && !prices[item.symbol]) prices[item.symbol] = Number(item.manualPrice);
    }
    return prices;
  };

  const portfolio = () => {
    seedIfEmpty();
    return calculateLedger({
      transactions: listAllTransactions(),
      cashBalances: listCashBalances(),
      lockedPositions: listLockedPositions(),
      prices: latestPrices(),
      quoteCurrencies: quoteCurrencies(),
    });
  };

  const saveTransaction = (input) => {
    const tx = validateTransaction(input);
    const account = tx.accountId ? sqlite.json(`SELECT name FROM accounts WHERE id = ${sqlValue(Number(tx.accountId))} LIMIT 1;`)[0] : null;
    const accountName = account?.name || tx.accountNameSnapshot || '';
    sqlite.run(`INSERT INTO transactions
(traded_at, instrument_symbol, account_id, account_name_snapshot, action, price, quantity, gross_amount, fee_amount, fee_currency, order_type, note, confirmed, created_at, updated_at)
VALUES (${sqlString(tx.tradedAt)}, ${sqlString(tx.instrumentSymbol)}, ${sqlValue(tx.accountId ? Number(tx.accountId) : null)}, ${sqlString(accountName)},
${sqlString(tx.action)}, ${sqlValue(tx.price)}, ${sqlValue(tx.quantity)}, ${sqlValue(tx.grossAmount)}, ${sqlValue(tx.feeAmount)}, ${sqlString(tx.feeCurrency)},
${sqlString(tx.orderType)}, ${sqlString(tx.note)}, ${sqlValue(tx.confirmed)}, datetime('now'), datetime('now'));`);
    return Number(sqlite.scalar('SELECT id FROM transactions ORDER BY id DESC LIMIT 1;'));
  };

  const saveManualPrice = (symbol, price) => {
    const timestamp = nowISO();
    sqlite.run(`UPDATE instruments SET manual_price = ${sqlValue(Number(price))}, manual_price_time = ${sqlString(timestamp)}, updated_at = datetime('now') WHERE symbol = ${sqlString(symbol)};`);
    sqlite.run(`INSERT INTO market_snapshots (symbol, value, observed_at, source_name, source_key, source_url, delay_status, verification_status, payload_json, created_at)
VALUES (${sqlString(symbol)}, ${sqlValue(Number(price))}, ${sqlString(timestamp)}, '手动录入', 'manual', '', 'manual', 'manual', '{}', datetime('now'));`);
    return { symbol, price: Number(price), observedAt: timestamp };
  };

  const saveMacroEvent = (input) => {
    sqlite.run(`INSERT INTO macro_events (name, event_time, timezone, importance, source_url, note, created_at, updated_at)
VALUES (${sqlString(input.name || '')}, ${sqlString(input.eventTime || input.event_time || nowISO())}, ${sqlString(input.timezone || 'America/New_York')},
${sqlString(input.importance || 'medium')}, ${sqlString(input.sourceUrl || input.source_url || '')}, ${sqlString(input.note || '')}, datetime('now'), datetime('now'));`);
    return Number(sqlite.scalar('SELECT id FROM macro_events ORDER BY id DESC LIMIT 1;'));
  };

  const macroEvents = ({ from = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(), to = new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString() } = {}) =>
    sqlite.json(`SELECT id, name, event_time AS eventTime, timezone, importance, source_url AS sourceUrl, note, created_at AS createdAt, updated_at AS updatedAt
FROM macro_events WHERE event_time BETWEEN ${sqlString(from)} AND ${sqlString(to)} ORDER BY event_time ASC LIMIT 80;`);

  const newsItems = (limit = 40) => sqlite.json(`SELECT id, title, source_name AS sourceName, source_url AS sourceUrl, published_at AS publishedAt,
summary, tags, credibility, created_at AS createdAt FROM news_items ORDER BY published_at DESC LIMIT ${sqlValue(Number(limit || 40))};`)
    .map((row) => ({ ...row, tags: parseJson(row.tags, []) }));

  const listOrderPlans = () => sqlite.json(`SELECT p.id, p.plan_date AS planDate, p.instrument_symbol AS instrumentSymbol, p.account_id AS accountId,
p.available_usdt AS availableUsdt, p.estimated_fee_rate AS estimatedFeeRate, p.valid_until AS validUntil, p.status, p.note, p.created_at AS createdAt, p.updated_at AS updatedAt
FROM daily_order_plans p ORDER BY p.plan_date DESC, p.id DESC LIMIT 40;`).map((plan) => ({
    ...plan,
    legs: sqlite.json(`SELECT id, level_index AS levelIndex, limit_price AS limitPrice, amount_usdt AS amountUsdt, expected_quantity AS expectedQuantity,
expected_fee AS expectedFee, created_at AS createdAt FROM daily_order_plan_legs WHERE plan_id = ${sqlValue(plan.id)} ORDER BY level_index ASC;`),
  }));

  const saveOrderPlan = (input) => {
    const calc = calculateDayOrderPlan({ availableUsdt: input.availableUsdt ?? input.available_usdt ?? 0, feeRate: input.estimatedFeeRate ?? input.estimated_fee_rate ?? 0, legs: input.legs || [] });
    const planDate = input.planDate || input.plan_date || todayISO();
    sqlite.run(`INSERT INTO daily_order_plans
(plan_date, instrument_symbol, account_id, available_usdt, estimated_fee_rate, valid_until, status, note, created_at, updated_at)
VALUES (${sqlString(planDate)}, ${sqlString(input.instrumentSymbol || input.instrument_symbol || 'rQQQ')}, ${sqlValue(input.accountId || input.account_id || null)},
${sqlValue(Number(input.availableUsdt ?? input.available_usdt ?? 0))}, ${sqlValue(Number(input.estimatedFeeRate ?? input.estimated_fee_rate ?? 0))},
${sqlString(input.validUntil || input.valid_until || '')}, 'active', ${sqlString(input.note || '')}, datetime('now'), datetime('now'));`);
    const id = Number(sqlite.scalar('SELECT id FROM daily_order_plans ORDER BY id DESC LIMIT 1;'));
    for (const leg of calc.legs) {
      sqlite.run(`INSERT INTO daily_order_plan_legs (plan_id, level_index, limit_price, amount_usdt, expected_quantity, expected_fee, created_at)
VALUES (${sqlValue(id)}, ${sqlValue(leg.levelIndex)}, ${sqlValue(leg.limitPrice)}, ${sqlValue(leg.amountUsdt)}, ${sqlValue(leg.expectedQuantity)}, ${sqlValue(leg.expectedFee)}, datetime('now'));`);
    }
    return { id, calculation: calc };
  };

  const expireDayOrders = (date = todayISO()) => {
    sqlite.run(`UPDATE daily_order_plans SET status = 'expired', updated_at = datetime('now')
WHERE status = 'active' AND plan_date < ${sqlString(date)};`);
  };

  const setDataSourceStatus = ({ sourceKey, sourceName, status, error = '' }) => {
    const timestamp = nowISO();
    sqlite.run(`INSERT INTO data_source_status (source_key, source_name, status, last_success_at, last_error_at, last_error, updated_at)
VALUES (${sqlString(sourceKey)}, ${sqlString(sourceName)}, ${sqlString(status)}, ${status === 'ok' ? sqlString(timestamp) : 'NULL'}, ${status === 'ok' ? 'NULL' : sqlString(timestamp)}, ${sqlString(error)}, datetime('now'))
ON CONFLICT(source_key) DO UPDATE SET source_name = excluded.source_name, status = excluded.status,
last_success_at = COALESCE(excluded.last_success_at, data_source_status.last_success_at),
last_error_at = COALESCE(excluded.last_error_at, data_source_status.last_error_at),
last_error = excluded.last_error, updated_at = excluded.updated_at;`);
  };

  const listDataSourceStatus = () => sqlite.json(`SELECT source_key AS sourceKey, source_name AS sourceName, status, last_success_at AS lastSuccessAt,
last_error_at AS lastErrorAt, last_error AS lastError, updated_at AS updatedAt FROM data_source_status ORDER BY source_key;`);

  const addSnapshot = (snapshot) => {
    sqlite.run(`INSERT INTO market_snapshots
(symbol, value, change_amount, change_percent, observed_at, source_name, source_key, source_url, delay_status, verification_status, payload_json, created_at)
VALUES (${sqlString(snapshot.symbol)}, ${sqlValue(snapshot.value)}, ${sqlValue(snapshot.changeAmount ?? snapshot.change_amount ?? null)},
${sqlValue(snapshot.changePercent ?? snapshot.change_percent ?? null)}, ${sqlString(snapshot.observedAt || nowISO())}, ${sqlString(snapshot.sourceName || snapshot.source_name || '')},
${sqlString(snapshot.sourceKey || snapshot.source_key || '')}, ${sqlString(snapshot.sourceUrl || snapshot.source_url || '')},
${sqlString(snapshot.delayStatus || 'unknown')}, ${sqlString(snapshot.verificationStatus || 'single_source')}, ${sqlString(JSON.stringify(snapshot.payload || {}))}, datetime('now'));`);
  };

  const refreshMarketData = async () => {
    const timestamp = nowISO();
    const results = [];
    const stooqSymbols = {
      QQQ: 'qqq.us',
      SOXX: 'soxx.us',
      NVDA: 'nvda.us',
      MSTR: 'mstr.us',
      'BTC-USD': 'btcusd',
      'USD-CNY': 'usdcny',
    };
    if (!externalApiClient) {
      setDataSourceStatus({ sourceKey: 'market-adapter', sourceName: '市场数据适配层', status: 'degraded', error: 'external api client unavailable' });
      return { ok: false, results, status: 'degraded' };
    }
    try {
      const query = Object.values(stooqSymbols).join(',');
      const response = await externalApiClient.text(`https://stooq.com/q/l/?s=${encodeURIComponent(query)}&f=sd2t2c&h&e=csv`, {
        freshMs: 10 * 60 * 1000,
        staleMs: 6 * 60 * 60 * 1000,
        timeoutMs: 8000,
        retries: 1,
        cacheKey: 'stooq-market-watchlist',
      });
      const lines = String(response.value || '').trim().split(/\r?\n/).slice(1);
      const reverse = Object.fromEntries(Object.entries(stooqSymbols).map(([symbol, key]) => [key.toLowerCase(), symbol]));
      for (const line of lines) {
        const [symbolKey, date, time, close] = line.split(',');
        const symbol = reverse[String(symbolKey || '').toLowerCase()];
        const value = Number(close);
        if (!symbol || !Number.isFinite(value)) continue;
        const snapshot = {
          symbol,
          value,
          observedAt: date && time ? `${date}T${time}Z` : timestamp,
          sourceName: 'Stooq 延迟行情',
          sourceKey: 'stooq',
          sourceUrl: 'https://stooq.com/',
          delayStatus: response.cacheStatus?.startsWith('stale') ? 'stale' : 'delayed',
          verificationStatus: 'single_source',
          payload: { cacheStatus: response.cacheStatus },
        };
        addSnapshot(snapshot);
        results.push(snapshot);
      }
      setDataSourceStatus({ sourceKey: 'stooq', sourceName: 'Stooq 延迟行情', status: results.length ? 'ok' : 'degraded', error: results.length ? '' : 'no rows parsed' });
    } catch (error) {
      setDataSourceStatus({ sourceKey: 'stooq', sourceName: 'Stooq 延迟行情', status: 'failed', error: error.message || String(error) });
    }

    for (const item of MARKET_WATCHLIST) {
      if (!results.some((row) => row.symbol === item.symbol)) {
        addSnapshot({
          symbol: item.symbol,
          value: null,
          observedAt: timestamp,
          sourceName: '未配置实时数据源',
          sourceKey: 'fallback',
          sourceUrl: '',
          delayStatus: 'unavailable',
          verificationStatus: 'unverified',
          payload: { reason: '缺少可用公开数据或 API Key，页面降级展示' },
        });
      }
    }
    return { ok: true, results, status: results.length ? 'degraded' : 'failed' };
  };

  const verifySnapshots = () => {
    const snapshots = latestSnapshots(3);
    const grouped = new Map();
    for (const row of snapshots) {
      if (!grouped.has(row.symbol)) grouped.set(row.symbol, []);
      grouped.get(row.symbol).push(row);
    }
    return [...grouped.entries()].map(([symbol, rows]) => {
      const numeric = rows.filter((row) => Number.isFinite(Number(row.value)));
      if (numeric.length >= 2) {
        const [a, b] = numeric;
        const diffPct = Math.abs(Number(a.value) - Number(b.value)) / Math.max(1, Math.abs(Number(a.value))) * 100;
        return { symbol, status: diffPct <= 1 ? 'verified' : 'mismatch', diffPct: roundNumber(diffPct, 4), sources: numeric.slice(0, 2).map((row) => row.sourceName) };
      }
      return { symbol, status: numeric.length === 1 ? 'single_source' : 'unavailable', diffPct: null, sources: rows.map((row) => row.sourceName) };
    });
  };

  const buildReportMarkdown = ({ reportType = 'manual', marketStatus = '手动生成' } = {}) => {
    seedIfEmpty();
    expireDayOrders();
    const snapshots = latestSnapshots(1);
    const portfolioPayload = portfolio();
    const rq = portfolioPayload.positions.find((item) => item.symbol === 'rQQQ') || {};
    const events = macroEvents();
    const plans = listOrderPlans().filter((plan) => plan.status === 'active');
    const session = marketSessionForDate(todayISO());
    const verification = verifySnapshots();
    const tags = riskTagsForReport({ snapshots, macroEvents: events, orderPlans: plans, session });
    const snap = (symbol) => snapshots.find((item) => item.symbol === symbol) || {};
    const line = (symbol, label = symbol) => {
      const item = snap(symbol);
      return `- ${label}：${item.value ?? '暂无'}，涨跌幅 ${item.changePercent ?? '暂无'}，来源 ${item.sourceName || '无'}，时间 ${item.observedAt || '无'}，状态 ${item.verificationStatus || '未验证'}`;
    };
    const generatedAt = nowISO();
    const markdown = `# QQQ / rQQQ 市场情报包

生成时间：${generatedAt}
市场状态：${marketStatus}
数据新鲜度：${snapshots.some((item) => item.delayStatus === 'stale') ? '存在过期数据' : '延迟或手动数据，见逐项来源'}
数据交叉验证状态：${verification.map((item) => `${item.symbol}:${item.status}`).join('；') || '暂无可验证数据'}
风险标签：${tags.join('、') || '无'}

## 1. 账户与仓位
- rQQQ 持仓数量：${rq.quantity ?? 0}
- rQQQ 加权成本：${rq.averageCost ?? 0}
- rQQQ 当前参考价：${rq.referencePrice ?? '未录入'}
- 未实现盈亏：${rq.unrealizedPnl ?? 0}
- 可自由 USDT：${portfolioPayload.freeUsdt}
- 锁定资金：${portfolioPayload.lockedValueUsdt} USDT 估值
- 可用于 QQQ/rQQQ 的实际弹药：${portfolioPayload.qqqAmmoUsdt} USDT
- 提示：锁定仓与高风险仓不计入 QQQ 可用弹药。

## 2. 核心市场快照
${line('QQQ')}
${line('NQ', '纳指100期货')}
${line('SOXX')}
${line('NVDA')}
${line('VIX')}
${line('US10Y', '美国10年期收益率')}
${line('DXY')}
${line('BTC-USD', 'BTC')}
${line('MSTR')}
${line('USD-CNY', 'USD/CNY')}

## 3. 当日价格结构
- QQQ 前收、开盘、当前/收盘、日内高、日内低：当前数据源未提供完整 OHLC 时，显示为待补充。
- 是否高开/低开：待可用开盘价后计算。
- 距离日内高低点：待可用日内高低点后计算。
- 近几日关键价位：第一版不自动推断，避免伪结论。
- 数据来源与时间：见核心市场快照。

## 4. 宏观与事件风险
${events.length ? events.map((item) => `- ${item.name}：${item.eventTime} ${item.timezone}，重要性 ${item.importance}，来源 ${item.sourceUrl || '手动维护'}，可信度：${item.sourceUrl ? '有来源' : '手动待核对'}`).join('\n') : '- 未来 24 小时暂无已录入事件；自动源未配置时请手动维护。'}

## 5. 新闻与公告
${newsItems(10).length ? newsItems(10).map((item) => `- ${item.title}｜${item.sourceName}｜${item.publishedAt}｜${item.sourceUrl || '无链接'}｜可信度：${item.credibility}`).join('\n') : '- 暂无新闻源；第一版不生成无来源传闻。'}

## 6. Day 单检查
- 当前是否是美股交易日：${session.isTradingDay ? `是（${session.sessionType}）` : `否（${session.sessionType}）`}
- Day 限价单是否应重新挂单：系统不连接交易所，请用户按交易所实际状态手动确认。
- 距离美股收盘还有多久：第一版展示交易日历，不做实时倒计时强判断。
- 未成交 Day 单将在收盘后失效的提示：请在收盘前核对；系统标记失效不等于交易所撤单。

## 7. 给 ChatGPT 的分析请求
请基于以上已验证数据，结合我的仓位、可用弹药、宏观事件和市场结构，
明确判断：买入 / 持有 / 等待 / 不操作。
如建议买入，最多给两档限价与每档建议金额；
如建议不操作，说明原因；
所有建议必须有失效条件，不得建议梭哈或自动交易。`;
    return { markdown, payload: { generatedAt, reportType, marketStatus, portfolio: portfolioPayload, snapshots, events, plans, verification, riskTags: tags, session } };
  };

  const generateReport = ({ reportType = 'manual', marketStatus = '手动生成', reportKey = '' } = {}) => {
    const built = buildReportMarkdown({ reportType, marketStatus });
    const key = reportKey || `${todayISO()}-${reportType}-${Date.now()}`;
    sqlite.run(`INSERT INTO intelligence_reports (report_key, report_type, market_status, generated_at, markdown, payload_json, created_at)
VALUES (${sqlString(key)}, ${sqlString(reportType)}, ${sqlString(marketStatus)}, ${sqlString(built.payload.generatedAt)}, ${sqlString(built.markdown)}, ${sqlString(JSON.stringify(built.payload))}, datetime('now'))
ON CONFLICT(report_key) DO UPDATE SET generated_at = excluded.generated_at, markdown = excluded.markdown, payload_json = excluded.payload_json;`);
    if (process.env.MARKET_COPILOT_TELEGRAM_ENABLED === '1' && notifyEvent) {
      notifyEvent({
        eventKey: `market-copilot:${key}`,
        source: 'market-copilot',
        severity: 'info',
        title: `QQQ 情报包已生成：${marketStatus}`,
        content: `已生成 ${marketStatus} 情报包。请在理财情报台复制 Markdown 后进行人工分析。`,
        payload: { reportKey: key, reportType, marketStatus },
      });
    }
    return getReportByKey(key);
  };

  const listReports = (limit = 20) => sqlite.json(`SELECT id, report_key AS reportKey, report_type AS reportType, market_status AS marketStatus,
generated_at AS generatedAt, markdown, payload_json AS payloadJson, created_at AS createdAt
FROM intelligence_reports ORDER BY generated_at DESC LIMIT ${sqlValue(Number(limit || 20))};`).map((row) => ({ ...row, payload: parseJson(row.payloadJson, {}) }));

  const getReportByKey = (key) => {
    const row = sqlite.json(`SELECT id, report_key AS reportKey, report_type AS reportType, market_status AS marketStatus,
generated_at AS generatedAt, markdown, payload_json AS payloadJson, created_at AS createdAt
FROM intelligence_reports WHERE report_key = ${sqlString(key)} LIMIT 1;`)[0];
    return row ? { ...row, payload: parseJson(row.payloadJson, {}) } : null;
  };

  const dashboard = () => {
    seedIfEmpty();
    const reports = listReports(10);
    return {
      generatedAt: nowISO(),
      timezones: {
        shanghai: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date()),
        tokyo: new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date()),
        newYork: new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'medium' }).format(new Date()),
      },
      instruments: listInstruments(),
      accounts: listAccounts(),
      transactions: listTransactions(),
      cashBalances: listCashBalances(),
      lockedPositions: listLockedPositions(),
      portfolio: portfolio(),
      snapshots: latestSnapshots(1),
      sourceStatus: listDataSourceStatus(),
      macroEvents: macroEvents(),
      newsItems: newsItems(20),
      orderPlans: listOrderPlans(),
      reports,
      latestReport: reports[0] || null,
      verification: verifySnapshots(),
      marketSession: marketSessionForDate(todayISO()),
      schedule: [
        { label: '开盘前', time: '09:05 ET' },
        { label: '开盘后 5 分钟', time: '09:35 ET' },
        { label: '开盘后 15 分钟', time: '09:45 ET' },
        { label: '开盘后 30 分钟', time: '10:00 ET' },
        { label: '收盘后', time: '16:10-16:20 ET' },
      ],
      warnings: ['锁定仓与高风险仓不计入 QQQ 可用弹药。', '本系统不连接下单接口，Day 单状态需用户手动核对交易所。'],
    };
  };

  return {
    seedIfEmpty,
    dashboard,
    listInstruments,
    listAccounts,
    listTransactions,
    listCashBalances,
    listLockedPositions,
    latestSnapshots,
    portfolio,
    saveTransaction,
    saveManualPrice,
    saveMacroEvent,
    macroEvents,
    listOrderPlans,
    saveOrderPlan,
    expireDayOrders,
    refreshMarketData,
    generateReport,
    listReports,
    getReportByKey,
    calculateDayOrderPlan,
    marketSessionForDate,
  };
}
