import { Download, Pencil, RefreshCw, TrendingDown, TrendingUp, WalletCards } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MetricCard } from '../../../components/MetricCard';
import { EmptyState } from '../../../components/EmptyState';
import type { CashflowAnalysis } from '../cashflow';
import { cashflowKindLabels } from '../cashflow';
import { formatMoney, formatPercent } from '../calculations';

type CashflowPanelProps = {
  analysis: CashflowAnalysis;
  hidden: boolean;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onResetPeriod: () => void;
  onExportCsv: () => void;
  onEditTransaction: (transactionId: string) => void;
};

function money(value: number | null | undefined, hidden: boolean) {
  return formatMoney(value, 'CNY', hidden);
}

function amountTone(value: number) {
  if (value > 0) return 'text-emerald-700';
  if (value < 0) return 'text-rose-700';
  return 'text-slate-700';
}

function CashflowBar({ analysis, hidden }: { analysis: CashflowAnalysis; hidden: boolean }) {
  if (!analysis.monthly.length) return <EmptyState title="暂无可分析流水" description="当前周期内没有已确认交易。" />;
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={analysis.monthly} margin={{ top: 8, right: 8, bottom: 28, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(value, name) => [hidden ? '••••' : `${Number(value).toFixed(2)} CNY`, name === 'incomeCny' ? '收入' : name === 'expenseCny' ? '支出' : '投资流出']} />
          <Bar dataKey="incomeCny" name="收入" fill="#16a34a" radius={[5, 5, 0, 0]} />
          <Bar dataKey="expenseCny" name="支出" fill="#dc2626" radius={[5, 5, 0, 0]} />
          <Bar dataKey="investmentOutflowCny" name="投资流出" fill="#2563eb" radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CategoryList({ title, rows, hidden }: { title: string; rows: CashflowAnalysis['categories']; hidden: boolean }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-3 space-y-2">
        {rows.slice(0, 8).map((row) => (
          <div key={row.key} className="grid grid-cols-[1fr_auto] gap-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-800">{row.label}</p>
              <p className="text-xs text-slate-500">{cashflowKindLabels[row.kind]} · {row.count} 笔 · {formatPercent(row.percent, 1)}</p>
            </div>
            <span className="font-semibold text-slate-900">{money(row.amountCny, hidden)}</span>
          </div>
        ))}
        {rows.length ? null : <p className="text-sm text-slate-500">暂无数据</p>}
      </div>
    </section>
  );
}

export function CashflowPanel({
  analysis,
  hidden,
  from,
  to,
  onFromChange,
  onToChange,
  onResetPeriod,
  onExportCsv,
  onEditTransaction,
}: CashflowPanelProps) {
  const { summary } = analysis;
  return (
    <div className="mt-6 space-y-5">
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">流水分析系统</h2>
            <p className="mt-1 text-sm text-slate-500">
              按收入、支出、投资、转账和费用归类交易，统计现金流、储蓄率和投资净流出。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input className="field w-40" type="date" value={from} onChange={(event) => onFromChange(event.target.value)} />
            <input className="field w-40" type="date" value={to} onChange={(event) => onToChange(event.target.value)} />
            <button className="btn btn-soft" type="button" onClick={onResetPeriod}><RefreshCw size={16} />本月</button>
            <button className="btn btn-soft" type="button" onClick={onExportCsv}><Download size={16} />流水 CSV</button>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="收入" value={money(summary.totalIncomeCny, hidden)} hint={`${summary.confirmedCount}/${summary.transactionCount} 笔已确认`} icon={<TrendingUp size={19} />} />
          <MetricCard label="支出" value={money(summary.totalExpenseCny, hidden)} hint={`最大支出：${summary.largestExpense ? summary.largestExpense.categoryLabel : '暂无'}`} icon={<TrendingDown size={19} />} />
          <MetricCard label="净现金流" value={money(summary.netCashflowCny, hidden)} hint={`储蓄率 ${summary.savingsRate === null ? '暂无' : `${summary.savingsRate}%`}`} icon={<WalletCards size={19} />} />
          <MetricCard label="投资净流出" value={money(summary.netInvestmentOutflowCny, hidden)} hint={`买入 ${money(summary.investmentOutflowCny, hidden)} / 回款 ${money(summary.investmentInflowCny, hidden)}`} icon={<WalletCards size={19} />} />
        </div>
        {analysis.warnings.length ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {analysis.warnings.slice(0, 3).join('；')}{analysis.warnings.length > 3 ? `；另有 ${analysis.warnings.length - 3} 条提示` : ''}
          </div>
        ) : null}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">月度现金流趋势</h2>
          <div className="mt-4">
            <CashflowBar analysis={analysis} hidden={hidden} />
          </div>
        </div>
        <div className="grid gap-4">
          <CategoryList title="支出分类" rows={analysis.expenseCategories} hidden={hidden} />
          <CategoryList title="收入分类" rows={analysis.incomeCategories} hidden={hidden} />
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
        <CategoryList title="投资分类" rows={analysis.investmentCategories} hidden={hidden} />
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">最近流水</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-2">日期</th><th>分类</th><th>资产/账户</th><th>方向</th><th>金额</th><th>对象</th><th>标签</th><th>操作</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analysis.recentTransactions.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2">{row.date}</td>
                    <td>
                      <p className="font-medium text-slate-900">{row.categoryLabel}</p>
                      <p className="text-xs text-slate-500">{cashflowKindLabels[row.kind]}</p>
                    </td>
                    <td>{row.assetName}</td>
                    <td>{row.direction === 'in' ? '流入' : row.direction === 'out' ? '流出' : '中性'}</td>
                    <td className={amountTone(row.direction === 'out' ? -1 : row.direction === 'in' ? 1 : 0)}>{money(row.amountCny, hidden)}</td>
                    <td>{row.merchant || row.counterparty || row.platform || '--'}</td>
                    <td>{row.tags.length ? row.tags.join(' / ') : '--'}</td>
                    <td><button className="rounded p-1 text-blue-700 hover:bg-blue-50" type="button" onClick={() => onEditTransaction(row.id)}><Pencil size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {analysis.recentTransactions.length ? null : <EmptyState title="暂无流水" />}
          </div>
        </div>
      </section>
    </div>
  );
}
