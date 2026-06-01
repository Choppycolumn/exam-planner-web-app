import type { FinanceData, FinancePortfolioSnapshot, FinanceTransaction } from '../../types/finance';
import {
  financeActionStatusLabels,
  financeAssetTypeLabels,
  financeTransactionStatusLabels,
  financeTransactionTypeLabels,
} from './constants';
import { formatMoney, formatPercent, todayDateISO } from './calculations';
import { buildCashflowAnalysis } from './cashflow';

export type FinanceReportKind = 'daily' | 'weekly' | 'monthly' | 'custom';

export interface FinanceReportOptions {
  kind: FinanceReportKind;
  periodStart: string;
  periodEnd: string;
}

function escapeCell(value: unknown) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function quoteCsvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function inPeriod(transaction: FinanceTransaction, options: FinanceReportOptions) {
  const date = transaction.dateTime.slice(0, 10);
  return date >= options.periodStart && date <= options.periodEnd;
}

export function defaultReportOptions(kind: FinanceReportKind): FinanceReportOptions {
  const today = todayDateISO();
  if (kind === 'weekly') {
    const date = new Date(`${today}T00:00:00`);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    const start = todayDateISO(date);
    const end = new Date(date);
    end.setDate(end.getDate() + 6);
    return { kind, periodStart: start, periodEnd: todayDateISO(end) };
  }
  if (kind === 'monthly') return { kind, periodStart: `${today.slice(0, 7)}-01`, periodEnd: today };
  return { kind, periodStart: today, periodEnd: today };
}

export function generateFinanceMarkdownReport(data: FinanceData, snapshot: FinancePortfolioSnapshot, options: FinanceReportOptions) {
  const periodTransactions = data.transactions.filter((transaction) => inPeriod(transaction, options));
  const cashflow = buildCashflowAnalysis(data, { from: options.periodStart, to: options.periodEnd });
  const missingBaselineAssets = snapshot.holdings.filter((holding) => holding.costNative === null).map((holding) => holding.asset.name);
  const failedQuoteAssets = snapshot.holdings.filter((holding) => holding.quote?.failed).map((holding) => holding.asset.name);
  const pendingFx = data.transactions.filter((transaction) => transaction.type === 'FX_CONVERSION' && transaction.status === 'pending');
  const manualAssets = snapshot.holdings.filter((holding) => holding.isManual).map((holding) => holding.asset.name);
  const usdRate = data.exchangeRates['USD/CNY']?.rate ? `${data.exchangeRates['USD/CNY']?.rate} (${data.exchangeRates['USD/CNY']?.asOfDate})` : '缺失';

  const lines = [
    '# 个人理财组合报告',
    '',
    '## 1. 报告基础信息',
    `- 报告周期：${options.periodStart} 至 ${options.periodEnd}`,
    `- 生成时间：${snapshot.generatedAt}`,
    '- 基准币种：人民币 CNY',
    `- 最新 USD/CNY 汇率：${usdRate}`,
    `- 行情更新时间：${snapshot.latestQuoteFetchedAt}`,
    `- 数据缺失或过期提示：${snapshot.alerts.length ? snapshot.alerts.join('；') : '暂无'}`,
    '',
    '## 2. 总体资产概览',
    '| 指标 | 金额/比例 |',
    '|---|---:|',
    `| 总资产估值 | ${formatMoney(snapshot.totalAssetsCny, 'CNY')} |`,
    `| 可用现金 | ${formatMoney(snapshot.availableCashCny, 'CNY')} |`,
    `| 本期投入金额 | ${formatMoney(periodTransactions.filter((item) => item.type === 'BUY' || item.type === 'CASH_DEPOSIT').reduce((sum, item) => sum + (item.amount ?? 0), 0), 'CNY')}（原币混合，需看交易表） |`,
    `| 本期总盈亏 | ${snapshot.todayPnlCny === null ? '暂无法准确计算' : formatMoney(snapshot.todayPnlCny, 'CNY')} |`,
    `| 起算后盈亏 | ${snapshot.cumulativePnlCny === null ? '暂无法准确计算' : formatMoney(snapshot.cumulativePnlCny, 'CNY')} |`,
    `| 权益资产占比 | ${formatPercent(snapshot.equityPercent)} |`,
    `| 美元及美元相关资产占比 | ${formatPercent(snapshot.usdRelatedPercent)} |`,
    `| 稳定币平台资产占比 | ${formatPercent(snapshot.stablecoinPlatformPercent)} |`,
    `| 本期收入 | ${formatMoney(cashflow.summary.totalIncomeCny, 'CNY')} |`,
    `| 本期支出 | ${formatMoney(cashflow.summary.totalExpenseCny, 'CNY')} |`,
    `| 本期净现金流 | ${formatMoney(cashflow.summary.netCashflowCny, 'CNY')} |`,
    `| 本期投资净流出 | ${formatMoney(cashflow.summary.netInvestmentOutflowCny, 'CNY')} |`,
    '',
    '## 3. 当前持仓明细',
    '| 资产名称 | 分类 | 币种 | 当前市值 | 折合人民币 | 起算基准 | 起算后盈亏 | 今日盈亏 | 最新价格日期 | 数据来源 |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|---|',
    ...snapshot.holdings.map((holding) => {
      const cost = holding.costNative === null ? '待建立' : formatMoney(holding.costNative, holding.asset.currency);
      const pnl = holding.cumulativePnlNative === null ? '数据不足，暂无法准确计算' : formatMoney(holding.cumulativePnlNative, holding.asset.currency);
      return `| ${escapeCell(holding.asset.name)} | ${escapeCell(financeAssetTypeLabels[holding.asset.assetType])} | ${holding.asset.currency} | ${formatMoney(holding.nativeMarketValue, holding.asset.currency)} | ${formatMoney(holding.cnyMarketValue, 'CNY')} | ${cost} | ${pnl} | ${formatMoney(holding.todayPnlNative, holding.asset.currency)} | ${holding.quote?.priceDate ?? holding.asset.priceDate ?? '手动/待补充'} | ${escapeCell(holding.quote?.source ?? holding.asset.dataSource ?? '手动/待补充')} |`;
    }),
    '',
    '## 4. 资产分层',
    '| 资产层级 | 当前金额 | 当前占比 | 目标占比 | 偏离 | 当前处理状态 |',
    '|---|---:|---:|---:|---:|---|',
    ...snapshot.targetRows.map((row) => `| ${escapeCell(row.label)} | ${formatMoney(row.valueCny, 'CNY')} | ${formatPercent(row.percent)} | ${formatPercent(row.targetPercent)} | ${formatPercent(row.driftPercent)} | ${row.status ? financeActionStatusLabels[row.status] : ''} |`),
    '',
    '## 5. 本期交易记录',
    '| 日期 | 资产 | 交易类型 | 金额 | 币种 | 汇率/价格 | 手续费 | 备注 |',
    '|---|---|---|---:|---|---:|---:|---|',
    ...periodTransactions.map((transaction) => {
      const asset = data.assets.find((item) => item.id === transaction.assetId);
      const rateOrPrice = transaction.type === 'FX_CONVERSION' ? transaction.fxRate : transaction.price;
      return `| ${transaction.dateTime.slice(0, 10)} | ${escapeCell(asset?.name ?? transaction.platform ?? '')} | ${financeTransactionTypeLabels[transaction.type]} / ${financeTransactionStatusLabels[transaction.status]} | ${transaction.amount ?? transaction.toAmount ?? ''} | ${transaction.currency} | ${rateOrPrice ?? ''} | ${transaction.fee ?? ''} | ${escapeCell(transaction.note ?? '')} |`;
    }),
    periodTransactions.length ? '' : '| 暂无 |  |  |  |  |  |  |  |',
    '',
    '## 6. 定投与计划执行情况',
    '| 计划 | 本期预计投入 | 本期实际投入 | 状态 | 备注 |',
    '|---|---:|---:|---|---|',
    ...data.plans.map((plan) => {
      const actual = periodTransactions
        .filter((transaction) => transaction.assetId === plan.assetId && transaction.type === 'BUY' && transaction.status === 'confirmed')
        .reduce((sum, transaction) => sum + (transaction.amount ?? 0), 0);
      return `| ${escapeCell(plan.name)} | ${formatMoney(plan.expectedMonthlyAmount ?? plan.amount, plan.currency)} | ${formatMoney(actual, plan.currency)} | ${plan.status} | ${escapeCell(plan.note ?? '')} |`;
    }),
    data.plans.length ? '' : '| 暂无 |  |  |  |  |',
    '',
    '## 7. 流水与现金流分析',
    '| 指标 | 金额/比例 |',
    '|---|---:|',
    `| 收入 | ${formatMoney(cashflow.summary.totalIncomeCny, 'CNY')} |`,
    `| 支出 | ${formatMoney(cashflow.summary.totalExpenseCny, 'CNY')} |`,
    `| 净现金流 | ${formatMoney(cashflow.summary.netCashflowCny, 'CNY')} |`,
    `| 储蓄率 | ${cashflow.summary.savingsRate === null ? '暂无' : `${cashflow.summary.savingsRate}%`} |`,
    `| 投资买入流出 | ${formatMoney(cashflow.summary.investmentOutflowCny, 'CNY')} |`,
    `| 投资卖出回款 | ${formatMoney(cashflow.summary.investmentInflowCny, 'CNY')} |`,
    `| 手续费 | ${formatMoney(cashflow.summary.feeCny, 'CNY')} |`,
    '',
    '| 分类 | 金额 | 占比 | 笔数 |',
    '|---|---:|---:|---:|',
    ...cashflow.categories.slice(0, 10).map((row) => `| ${escapeCell(row.label)} | ${formatMoney(row.amountCny, 'CNY')} | ${formatPercent(row.percent, 1)} | ${row.count} |`),
    cashflow.categories.length ? '' : '| 暂无 |  |  |  |',
    '',
    '## 8. 数据异常与待补充信息',
    `- 起算基准缺失的资产：${missingBaselineAssets.length ? missingBaselineAssets.join('、') : '无'}`,
    `- 净值更新失败的资产：${failedQuoteAssets.length ? failedQuoteAssets.join('、') : '无'}`,
    `- 待确认换汇交易：${pendingFx.length ? pendingFx.map((item) => `${item.fromCurrency ?? ''}->${item.toAmount ?? ''} ${item.toCurrency ?? ''}`).join('；') : '无'}`,
    `- 手动录入资产：${manualAssets.length ? manualAssets.join('、') : '无'}`,
    '- 费率或产品规则待核验内容：请核对基金申赎费、美元理财产品规则、平台生息规则与实际到账利息。',
    '',
    '## 9. 需要 ChatGPT 帮助分析的问题',
    '- 当前资产结构是否偏离我的目标？',
    '- 本期新增投入是否合理？',
    '- 是否需要调整下一期投入计划？',
    '- 是否存在风险过度集中或平台风险过高的问题？',
  ];

  return lines.join('\n');
}

export function exportFinanceJson(data: FinanceData) {
  return JSON.stringify({ exportedAt: new Date().toISOString(), financeData: data }, null, 2);
}

export function exportTransactionsCsv(data: FinanceData) {
  const headers = ['id', 'dateTime', 'asset', 'platform', 'type', 'status', 'amount', 'currency', 'units', 'price', 'fxRate', 'fee', 'feeCurrency', 'note'];
  const rows = data.transactions.map((transaction) => {
    const asset = data.assets.find((item) => item.id === transaction.assetId);
    return [
      transaction.id,
      transaction.dateTime,
      asset?.name ?? '',
      transaction.platform ?? '',
      transaction.type,
      transaction.status,
      transaction.amount ?? '',
      transaction.currency,
      transaction.units ?? '',
      transaction.price ?? '',
      transaction.fxRate ?? '',
      transaction.fee ?? '',
      transaction.feeCurrency ?? '',
      transaction.note ?? '',
    ].map(quoteCsvCell).join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

export function exportHoldingsCsv(snapshot: FinancePortfolioSnapshot) {
  const headers = ['asset', 'type', 'currency', 'nativeMarketValue', 'cnyMarketValue', 'costNative', 'cumulativePnlNative', 'returnRate', 'priceDate', 'source', 'issues'];
  const rows = snapshot.holdings.map((holding) => [
    holding.asset.name,
    holding.asset.assetType,
    holding.asset.currency,
    holding.nativeMarketValue ?? '',
    holding.cnyMarketValue ?? '',
    holding.costNative ?? '',
    holding.cumulativePnlNative ?? '',
    holding.returnRate ?? '',
    holding.quote?.priceDate ?? holding.asset.priceDate ?? '',
    holding.quote?.source ?? holding.asset.dataSource ?? '',
    holding.issues.join('; '),
  ].map(quoteCsvCell).join(','));
  return [headers.join(','), ...rows].join('\n');
}
