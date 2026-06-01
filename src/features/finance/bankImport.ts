import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import type { FinanceTransaction } from '../../types/finance';
import { newFinanceId, nowISO } from './calculations';

export interface ParsedBankTransaction {
  source: 'ICBC_PDF';
  dateTime: string;
  summary: string;
  amount: number;
  balance: number | null;
  counterparty: string;
  channel: string;
  raw: string;
}

export interface BankImportResult {
  transactions: ParsedBankTransaction[];
  skippedLines: string[];
}

function parseAmount(value: string) {
  const normalized = value.replace(/\s+/g, '').replace(/,/g, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function classify(row: ParsedBankTransaction): Pick<FinanceTransaction, 'type' | 'cashflowKind' | 'cashflowCategory'> {
  const text = `${row.summary} ${row.counterparty} ${row.channel}`;
  const positive = row.amount >= 0;
  if (/理财|基金|金融付款|证券|银证|投资/.test(text)) {
    return positive
      ? { type: 'SELL', cashflowKind: 'investment', cashflowCategory: 'investment_sell' }
      : { type: 'BUY', cashflowKind: 'investment', cashflowCategory: 'investment_buy' };
  }
  if (/工资|薪/.test(text)) return { type: 'CASH_DEPOSIT', cashflowKind: 'income', cashflowCategory: 'salary' };
  if (/退款|退货|返现/.test(text)) return { type: 'CASH_DEPOSIT', cashflowKind: 'income', cashflowCategory: 'reward' };
  if (/利息|分红/.test(text)) return { type: 'INTEREST', cashflowKind: 'income', cashflowCategory: 'interest' };
  if (/转账|网转|提现|充值|卡通|财付通|微信|支付宝/.test(text)) {
    return positive
      ? { type: 'TRANSFER_IN', cashflowKind: 'transfer', cashflowCategory: 'transfer' }
      : { type: 'TRANSFER_OUT', cashflowKind: 'transfer', cashflowCategory: 'transfer' };
  }
  if (/手续费|服务费/.test(text)) return { type: 'FEE', cashflowKind: 'fee', cashflowCategory: 'fee' };
  if (/餐|饭|美团|饿了么|外卖|咖啡|饮品/.test(text)) return { type: 'CASH_WITHDRAWAL', cashflowKind: 'expense', cashflowCategory: 'food' };
  if (/房租|物业|水电|燃气|宽带/.test(text)) return { type: 'CASH_WITHDRAWAL', cashflowKind: 'expense', cashflowCategory: 'housing' };
  if (/地铁|公交|铁路|机票|滴滴|高德|交通/.test(text)) return { type: 'CASH_WITHDRAWAL', cashflowKind: 'expense', cashflowCategory: 'transport' };
  if (/医院|药|医保|健康/.test(text)) return { type: 'CASH_WITHDRAWAL', cashflowKind: 'expense', cashflowCategory: 'health' };
  if (/课程|书|教育|学习/.test(text)) return { type: 'CASH_WITHDRAWAL', cashflowKind: 'expense', cashflowCategory: 'education' };
  return positive
    ? { type: 'CASH_DEPOSIT', cashflowKind: 'income', cashflowCategory: 'other' }
    : { type: 'CASH_WITHDRAWAL', cashflowKind: 'expense', cashflowCategory: 'living' };
}

function compactLine(line: string) {
  return line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseTransactionLine(line: string): ParsedBankTransaction | null {
  const normalized = compactLine(line);
  const dateMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(.+)$/);
  if (!dateMatch) return null;
  const rest = dateMatch[3];
  const amountMatch = rest.match(/([+-]\s?[\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+(.*)$/);
  if (!amountMatch) return null;
  const beforeAmount = compactLine(rest.slice(0, amountMatch.index));
  const amount = parseAmount(amountMatch[1]);
  const balance = parseAmount(amountMatch[2]);
  if (amount === null) return null;
  const beforeTokens = beforeAmount.split(' ').filter(Boolean);
  const summaryTokenIndex = /^\d+$/.test(beforeTokens.at(-1) ?? '') ? beforeTokens.length - 2 : beforeTokens.length - 1;
  const summary = beforeTokens[summaryTokenIndex] ?? '银行流水';
  const tailTokens = compactLine(amountMatch[3]).split(' ').filter(Boolean);
  const channel = tailTokens.at(-1) ?? '';
  const counterparty = tailTokens.slice(0, -1).join(' ');
  return {
    source: 'ICBC_PDF',
    dateTime: `${dateMatch[1]}T${dateMatch[2]}`,
    summary,
    amount,
    balance,
    counterparty,
    channel,
    raw: normalized,
  };
}

function transactionChunks(text: string) {
  const normalized = text
    .replace(/\r/g, '\n')
    .replace(/(\d{4}-\d{2}-\d{2})\s*\n\s*(\d{2}:\d{2}:\d{2})/g, '$1 $2');
  const chunks: string[] = [];
  const pattern = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})([\s\S]*?)(?=\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}|本页|第\s*\d+\s*页|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalized)) !== null) {
    chunks.push(`${match[1]} ${match[2]}`);
  }
  return chunks;
}

function redactBankRaw(value: string) {
  return value.replace(/\b\d{10,}\b/g, '****');
}

export function parseIcbcStatementText(text: string): BankImportResult {
  const lines = transactionChunks(text);
  const transactions: ParsedBankTransaction[] = [];
  const skippedLines: string[] = [];
  lines.forEach((line) => {
    const parsed = parseTransactionLine(line);
    if (parsed) transactions.push({ ...parsed, raw: redactBankRaw(parsed.raw) });
    else skippedLines.push(line);
  });
  return { transactions, skippedLines };
}

export async function extractPdfTextFromFile(file: File) {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pages.join('\n');
}

export function bankRowsToFinanceTransactions(rows: ParsedBankTransaction[], existingTransactions: FinanceTransaction[] = []) {
  const timestamp = nowISO();
  const existingKeys = new Set(existingTransactions.map((item) => `${item.dateTime}|${item.amount ?? ''}|${item.counterparty ?? ''}|${item.merchant ?? ''}|${item.note ?? ''}`));
  const imported: FinanceTransaction[] = [];
  rows.forEach((row) => {
    const classified = classify(row);
    const amount = Math.abs(row.amount);
    const note = `ICBC PDF import: ${row.summary}; balance=${row.balance ?? ''}; raw=${redactBankRaw(row.raw)}`;
    const key = `${new Date(row.dateTime).toISOString()}|${amount}|${row.counterparty}|${row.channel}|${note}`;
    if (existingKeys.has(key)) return;
    existingKeys.add(key);
    imported.push({
      id: newFinanceId('icbc'),
      dateTime: new Date(row.dateTime).toISOString(),
      platform: '中国工商银行',
      amount,
      currency: 'CNY',
      relatedTransactionIds: [],
      merchant: row.channel || undefined,
      counterparty: row.counterparty || undefined,
      tags: ['ICBC', 'PDF导入', row.summary].filter(Boolean),
      note,
      status: 'confirmed',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...classified,
    });
  });
  return imported;
}
