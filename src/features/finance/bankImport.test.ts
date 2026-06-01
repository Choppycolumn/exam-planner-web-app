import { describe, expect, it } from 'vitest';
import { bankRowsToFinanceTransactions, parseIcbcStatementText } from './bankImport';

describe('parseIcbcStatementText', () => {
  it('parses ICBC PDF text chunks split across lines', () => {
    const text = `中国工商银行借记账户历史明细（电子版）
2026-05-01
00:27:35 2502024601020172930 活期 00000 人民币 钞 退款 2502 +0.76 1,448.78 深圳市财付通支付
科技有限公司 2433****0133 快捷支付
2026-05-06
10:26:00 2502024601020172930 活期 00000 人民币 钞 理财 2502 -10.00 3,613.19 支付宝（中国）网络技术有限公司 2155****0690 快捷支付
本页交易笔数：2`;

    const result = parseIcbcStatementText(text);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0].amount).toBe(0.76);
    expect(result.transactions[1].summary).toBe('理财');

    const financeTransactions = bankRowsToFinanceTransactions(result.transactions);
    expect(financeTransactions[0].cashflowKind).toBe('income');
    expect(financeTransactions[1].cashflowCategory).toBe('investment_buy');
    expect(financeTransactions[0].note).not.toContain('2502024601020172930');
  });
});
