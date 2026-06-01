import type {
  FinanceCashflowCategory,
  FinanceCashflowKind,
  FinanceCurrency,
  FinanceData,
  FinanceTransaction,
} from '../../types/finance';
import { convertToCny, roundMoney, todayDateISO } from './calculations';
import { financeTransactionTypeLabels } from './constants';

export const cashflowKindLabels: Record<FinanceCashflowKind, string> = {
  income: '收入',
  expense: '支出',
  investment: '投资',
  transfer: '转账',
  fee: '费用',
  adjustment: '校正',
};

export const cashflowCategoryLabels: Record<FinanceCashflowCategory, string> = {
  salary: '工资',
  bonus: '奖金',
  living: '日常',
  food: '餐饮',
  housing: '居住',
  transport: '交通',
  health: '医疗健康',
  education: '学习教育',
  subscription: '订阅',
  entertainment: '娱乐',
  tax: '税费',
  cash_deposit: '现金流入',
  cash_withdrawal: '现金流出',
  investment_buy: '买入投资',
  investment_sell: '卖出回款',
  dividend: '分红',
  interest: '利息',
  reward: '奖励',
  fx: '换汇',
  transfer: '内部转账',
  fee: '手续费',
  adjustment: '手动校正',
  other: '其他',
};

export const cashflowKindOptions = Object.entries(cashflowKindLabels).map(([value, label]) => ({
  value: value as FinanceCashflowKind,
  label,
}));

export const cashflowCategoryOptions = Object.entries(cashflowCategoryLabels).map(([value, label]) => ({
  value: value as FinanceCashflowCategory,
  label,
}));

export type CashflowDirection = 'in' | 'out' | 'neutral';

export interface CashflowAnalysisOptions {
  from?: string;
  to?: string;
}

export interface CashflowNormalizedTransaction {
  id: string;
  date: string;
  assetName: string;
  platform: string;
  typeLabel: string;
  kind: FinanceCashflowKind;
  category: FinanceCashflowCategory;
  categoryLabel: string;
  direction: CashflowDirection;
  amountNative: number;
  amountCny: number | null;
  currency: FinanceCurrency;
  merchant: string;
  counterparty: string;
  tags: string[];
  note: string;
  warning: string;
}

export interface CashflowBucketRow {
  key: string;
  label: string;
  kind: FinanceCashflowKind;
  count: number;
  amountCny: number;
  percent: number;
}

export interface CashflowMonthlyRow {
  month: string;
  incomeCny: number;
  expenseCny: number;
  netCashflowCny: number;
  investmentInflowCny: number;
  investmentOutflowCny: number;
  feeCny: number;
  transferCny: number;
  count: number;
}

export interface CashflowAnalysis {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  summary: {
    transactionCount: number;
    confirmedCount: number;
    pendingCount: number;
    ignoredCount: number;
    totalIncomeCny: number;
    totalExpenseCny: number;
    netCashflowCny: number;
    investmentInflowCny: number;
    investmentOutflowCny: number;
    netInvestmentOutflowCny: number;
    feeCny: number;
    transferCny: number;
    savingsRate: number | null;
    largestExpense: CashflowNormalizedTransaction | null;
    largestIncome: CashflowNormalizedTransaction | null;
  };
  monthly: CashflowMonthlyRow[];
  categories: CashflowBucketRow[];
  expenseCategories: CashflowBucketRow[];
  incomeCategories: CashflowBucketRow[];
  investmentCategories: CashflowBucketRow[];
  recentTransactions: CashflowNormalizedTransaction[];
  warnings: string[];
}

function dateInRange(date: string, options: CashflowAnalysisOptions) {
  return (!options.from || date >= options.from) && (!options.to || date <= options.to);
}

function defaultKind(transaction: FinanceTransaction): FinanceCashflowKind {
  if (transaction.cashflowKind) return transaction.cashflowKind;
  if (transaction.type === 'CASH_DEPOSIT' || transaction.type === 'DIVIDEND' || transaction.type === 'INTEREST' || transaction.type === 'REWARD') return 'income';
  if (transaction.type === 'CASH_WITHDRAWAL') return 'expense';
  if (transaction.type === 'BUY' || transaction.type === 'SELL') return 'investment';
  if (transaction.type === 'TRANSFER_IN' || transaction.type === 'TRANSFER_OUT' || transaction.type === 'FX_CONVERSION') return 'transfer';
  if (transaction.type === 'FEE') return 'fee';
  return 'adjustment';
}

function defaultCategory(transaction: FinanceTransaction, kind: FinanceCashflowKind): FinanceCashflowCategory {
  if (transaction.cashflowCategory) return transaction.cashflowCategory;
  if (transaction.type === 'BUY') return 'investment_buy';
  if (transaction.type === 'SELL') return 'investment_sell';
  if (transaction.type === 'CASH_DEPOSIT') return 'cash_deposit';
  if (transaction.type === 'CASH_WITHDRAWAL') return 'cash_withdrawal';
  if (transaction.type === 'DIVIDEND') return 'dividend';
  if (transaction.type === 'INTEREST') return 'interest';
  if (transaction.type === 'REWARD') return 'reward';
  if (transaction.type === 'FX_CONVERSION') return 'fx';
  if (transaction.type === 'TRANSFER_IN' || transaction.type === 'TRANSFER_OUT') return 'transfer';
  if (transaction.type === 'FEE' || kind === 'fee') return 'fee';
  if (transaction.type === 'ADJUSTMENT' || kind === 'adjustment') return 'adjustment';
  return 'other';
}

function directionFor(transaction: FinanceTransaction, kind: FinanceCashflowKind): CashflowDirection {
  if (transaction.type === 'SELL' || transaction.type === 'CASH_DEPOSIT' || transaction.type === 'TRANSFER_IN') return 'in';
  if (transaction.type === 'BUY' || transaction.type === 'CASH_WITHDRAWAL' || transaction.type === 'TRANSFER_OUT' || transaction.type === 'FEE') return 'out';
  if (kind === 'income') return 'in';
  if (kind === 'expense' || kind === 'fee') return 'out';
  return 'neutral';
}

function amountFor(transaction: FinanceTransaction) {
  const base = transaction.amount ?? transaction.toAmount ?? 0;
  const fee = transaction.fee ?? 0;
  if (transaction.type === 'BUY') return base + fee;
  if (transaction.type === 'SELL') return Math.max(0, base - fee);
  if (transaction.type === 'FEE') return transaction.amount ?? fee;
  return base;
}

function addBucket(rows: Map<string, CashflowBucketRow>, row: CashflowNormalizedTransaction) {
  if (row.amountCny === null || row.amountCny <= 0) return;
  const key = `${row.kind}:${row.category}`;
  const existing = rows.get(key) ?? {
    key,
    label: row.categoryLabel,
    kind: row.kind,
    count: 0,
    amountCny: 0,
    percent: 0,
  };
  existing.count += 1;
  existing.amountCny = roundMoney(existing.amountCny + row.amountCny);
  rows.set(key, existing);
}

function monthRow(rows: Map<string, CashflowMonthlyRow>, month: string) {
  const existing = rows.get(month);
  if (existing) return existing;
  const next: CashflowMonthlyRow = {
    month,
    incomeCny: 0,
    expenseCny: 0,
    netCashflowCny: 0,
    investmentInflowCny: 0,
    investmentOutflowCny: 0,
    feeCny: 0,
    transferCny: 0,
    count: 0,
  };
  rows.set(month, next);
  return next;
}

function finalizeBuckets(rows: CashflowBucketRow[]) {
  const total = rows.reduce((sum, row) => sum + row.amountCny, 0);
  return rows
    .map((row) => ({
      ...row,
      percent: total ? roundMoney((row.amountCny / total) * 100, 2) : 0,
    }))
    .sort((a, b) => b.amountCny - a.amountCny);
}

export function normalizeCashflowTransaction(data: FinanceData, transaction: FinanceTransaction): CashflowNormalizedTransaction {
  const asset = transaction.assetId ? data.assets.find((item) => item.id === transaction.assetId) : null;
  const kind = defaultKind(transaction);
  const category = defaultCategory(transaction, kind);
  const direction = directionFor(transaction, kind);
  const amountNative = Math.abs(amountFor(transaction));
  const converted = convertToCny(amountNative, transaction.currency, data);
  return {
    id: transaction.id,
    date: (transaction.tradeDate || transaction.dateTime || '').slice(0, 10),
    assetName: asset?.name ?? transaction.platform ?? '现金/换汇',
    platform: transaction.platform ?? asset?.platform ?? '',
    typeLabel: financeTransactionTypeLabels[transaction.type] ?? transaction.type,
    kind,
    category,
    categoryLabel: cashflowCategoryLabels[category],
    direction,
    amountNative,
    amountCny: converted.value,
    currency: transaction.currency,
    merchant: transaction.merchant ?? '',
    counterparty: transaction.counterparty ?? '',
    tags: transaction.tags ?? [],
    note: transaction.note ?? '',
    warning: converted.warning,
  };
}

export function buildCashflowAnalysis(data: FinanceData, options: CashflowAnalysisOptions = {}): CashflowAnalysis {
  const periodStart = options.from || data.transactions.map((item) => item.dateTime.slice(0, 10)).sort()[0] || todayDateISO();
  const periodEnd = options.to || todayDateISO();
  const warnings = new Set<string>();
  const confirmedRows = data.transactions
    .filter((transaction) => dateInRange((transaction.tradeDate || transaction.dateTime).slice(0, 10), options))
    .map((transaction) => ({ transaction, normalized: normalizeCashflowTransaction(data, transaction) }));
  const rows = confirmedRows.filter(({ transaction }) => transaction.status === 'confirmed').map(({ normalized }) => normalized);
  confirmedRows
    .filter(({ transaction }) => transaction.status !== 'confirmed')
    .forEach(({ transaction }) => warnings.add(`未计入 ${transaction.status} 交易：${transaction.dateTime.slice(0, 10)} ${transaction.type}`));
  rows.filter((row) => row.warning).forEach((row) => warnings.add(row.warning));

  const buckets = new Map<string, CashflowBucketRow>();
  const monthlyRows = new Map<string, CashflowMonthlyRow>();
  let totalIncomeCny = 0;
  let totalExpenseCny = 0;
  let investmentInflowCny = 0;
  let investmentOutflowCny = 0;
  let feeCny = 0;
  let transferCny = 0;
  let largestExpense: CashflowNormalizedTransaction | null = null;
  let largestIncome: CashflowNormalizedTransaction | null = null;

  rows.forEach((row) => {
    const value = row.amountCny;
    const month = row.date.slice(0, 7);
    const monthly = monthRow(monthlyRows, month);
    monthly.count += 1;
    if (value === null) return;
    addBucket(buckets, row);
    if (row.kind === 'income') {
      totalIncomeCny = roundMoney(totalIncomeCny + value);
      monthly.incomeCny = roundMoney(monthly.incomeCny + value);
      if (!largestIncome || value > (largestIncome.amountCny ?? 0)) largestIncome = row;
    } else if (row.kind === 'expense') {
      totalExpenseCny = roundMoney(totalExpenseCny + value);
      monthly.expenseCny = roundMoney(monthly.expenseCny + value);
      if (!largestExpense || value > (largestExpense.amountCny ?? 0)) largestExpense = row;
    } else if (row.kind === 'investment') {
      if (row.direction === 'in') {
        investmentInflowCny = roundMoney(investmentInflowCny + value);
        monthly.investmentInflowCny = roundMoney(monthly.investmentInflowCny + value);
      } else {
        investmentOutflowCny = roundMoney(investmentOutflowCny + value);
        monthly.investmentOutflowCny = roundMoney(monthly.investmentOutflowCny + value);
      }
    } else if (row.kind === 'fee') {
      feeCny = roundMoney(feeCny + value);
      totalExpenseCny = roundMoney(totalExpenseCny + value);
      monthly.feeCny = roundMoney(monthly.feeCny + value);
      monthly.expenseCny = roundMoney(monthly.expenseCny + value);
    } else if (row.kind === 'transfer') {
      transferCny = roundMoney(transferCny + value);
      monthly.transferCny = roundMoney(monthly.transferCny + value);
    }
  });

  const monthly = Array.from(monthlyRows.values())
    .map((row) => ({
      ...row,
      netCashflowCny: roundMoney(row.incomeCny - row.expenseCny),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const categories = finalizeBuckets(Array.from(buckets.values()));
  const netCashflowCny = roundMoney(totalIncomeCny - totalExpenseCny);
  const netInvestmentOutflowCny = roundMoney(investmentOutflowCny - investmentInflowCny);

  return {
    generatedAt: new Date().toISOString(),
    periodStart,
    periodEnd,
    summary: {
      transactionCount: confirmedRows.length,
      confirmedCount: rows.length,
      pendingCount: confirmedRows.filter(({ transaction }) => transaction.status === 'pending').length,
      ignoredCount: confirmedRows.filter(({ transaction }) => transaction.status === 'cancelled').length,
      totalIncomeCny,
      totalExpenseCny,
      netCashflowCny,
      investmentInflowCny,
      investmentOutflowCny,
      netInvestmentOutflowCny,
      feeCny,
      transferCny,
      savingsRate: totalIncomeCny ? roundMoney((netCashflowCny / totalIncomeCny) * 100, 2) : null,
      largestExpense,
      largestIncome,
    },
    monthly,
    categories,
    expenseCategories: categories.filter((row) => row.kind === 'expense' || row.kind === 'fee'),
    incomeCategories: categories.filter((row) => row.kind === 'income'),
    investmentCategories: categories.filter((row) => row.kind === 'investment'),
    recentTransactions: rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30),
    warnings: Array.from(warnings),
  };
}

function quoteCsvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportCashflowCsv(analysis: CashflowAnalysis) {
  const headers = ['date', 'kind', 'category', 'asset', 'platform', 'direction', 'amountCny', 'amountNative', 'currency', 'merchant', 'counterparty', 'tags', 'note'];
  const rows = analysis.recentTransactions.map((row) => [
    row.date,
    cashflowKindLabels[row.kind],
    row.categoryLabel,
    row.assetName,
    row.platform,
    row.direction,
    row.amountCny ?? '',
    row.amountNative,
    row.currency,
    row.merchant,
    row.counterparty,
    row.tags.join(';'),
    row.note,
  ].map(quoteCsvCell).join(','));
  return [headers.join(','), ...rows].join('\n');
}
