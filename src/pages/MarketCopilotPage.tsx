import { useEffect, useMemo, useState } from 'react';
import { ArchiveRestore, Copy, Download, FileText, Pencil, Plus, RotateCcw, Save, Trash2, WalletCards, XCircle } from 'lucide-react';
import { Page } from '../components/Page';
import { serverApi, type MarketCopilotDashboard } from '../api/client';

type TransactionRow = MarketCopilotDashboard['transactions'][number];

const tabs = ['概览', '交易流水', '仓位与资金', 'Day 单计划', 'ChatGPT 研究提示词', '账户核对', '回收站', '迁移核对与系统状态'] as const;

const emptyTx = {
  id: '',
  occurredAt: new Date().toISOString().slice(0, 16),
  transactionType: 'buy',
  status: 'confirmed',
  accountId: '1',
  instrumentSymbol: 'rQQQ',
  quantity: '',
  price: '',
  grossAmount: '',
  feeAmount: '0',
  feeCurrency: 'USDT',
  quoteCurrency: 'USDT',
  orderType: 'Day 限价',
  externalReference: '',
  tags: '',
  note: '',
};

function formatNumber(value: unknown, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(number);
}

function downloadText(filename: string, text: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function transactionToCsv(rows: TransactionRow[]) {
  const header = ['id', 'occurredAt', 'transactionType', 'status', 'accountId', 'symbol', 'quantity', 'price', 'nominalAmount', 'feeAmount', 'feeCurrency', 'orderType', 'externalReference', 'tags', 'note'];
  const body = rows.map((row) => {
    const leg = row.legs[0];
    const values = [
      row.id,
      row.occurredAt,
      row.transactionType,
      row.status,
      row.accountId ?? '',
      leg?.instrumentSymbol ?? '',
      leg?.quantity ?? '',
      leg?.unitPrice ?? '',
      leg?.nominalAmount ?? '',
      leg?.feeAmount ?? '',
      leg?.feeCurrency ?? '',
      row.orderType,
      row.externalReference,
      row.tags.join(' '),
      row.note,
    ];
    return values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',');
  });
  return [header.join(','), ...body].join('\n');
}

function badgeTone(value: string) {
  if (['confirmed', 'cleared', 'reconciled', 'filled_manually', 'active', 'normal'].includes(value)) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (['deleted', 'voided', 'expired_unconfirmed', 'failed'].includes(value)) return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${badgeTone(value)}`}>{value}</span>;
}

function firstLeg(row: TransactionRow) {
  return row.legs[0] || { instrumentSymbol: '', quantity: 0, unitPrice: 0, nominalAmount: 0, feeAmount: 0, feeCurrency: '' };
}

export function MarketCopilotPage() {
  const [data, setData] = useState<MarketCopilotDashboard | null>(null);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('概览');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [tx, setTx] = useState(emptyTx);
  const [filter, setFilter] = useState('');
  const [price, setPrice] = useState({ symbol: 'rQQQ', value: '' });
  const [plan, setPlan] = useState({ price1: '', amount1: '25', price2: '', amount2: '25', feeRate: '0.001', note: '' });
  const [reconcile, setReconcile] = useState({ accountId: '1', actualJson: '{\n  "USDT": 0,\n  "rQQQ": 0\n}', note: '' });
  const [csvText, setCsvText] = useState('');
  const [importPreview, setImportPreview] = useState<Record<string, unknown> | null>(null);
  const latestMarkdown = data?.latestReport?.markdown || '';

  const load = async () => {
    const next = await serverApi.getMarketCopilot();
    setData(next);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 页面进入时需要读取服务器账本。
    void load().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  const run = async (label: string, action: () => Promise<MarketCopilotDashboard | undefined>) => {
    setBusy(label);
    setMessage('');
    try {
      const dashboard = await action();
      if (dashboard) setData(dashboard);
      else await load();
      setMessage(`${label}已完成`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  };

  const filteredTransactions = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    if (!data) return [];
    if (!keyword) return data.transactions;
    return data.transactions.filter((row) => JSON.stringify(row).toLowerCase().includes(keyword));
  }, [data, filter]);

  const saveTx = async () => {
    const quantity = Number(tx.quantity || 0);
    const priceNumber = Number(tx.price || 0);
    const gross = Number(tx.grossAmount || 0) || Math.abs(quantity) * priceNumber;
    const body = {
      id: Number(tx.id || 0),
      occurredAt: new Date(tx.occurredAt).toISOString(),
      transactionType: tx.transactionType,
      status: tx.status,
      accountId: Number(tx.accountId || 1),
      instrumentSymbol: tx.instrumentSymbol,
      quantity,
      price: priceNumber,
      grossAmount: gross,
      feeAmount: Number(tx.feeAmount || 0),
      feeCurrency: tx.feeCurrency,
      quoteCurrency: tx.quoteCurrency,
      orderType: tx.orderType,
      externalReference: tx.externalReference,
      tags: tx.tags,
      note: tx.note,
    };
    if (tx.id) return (await serverApi.updateMarketTransaction(body)).dashboard;
    return (await serverApi.saveMarketTransaction(body)).dashboard;
  };

  const editTx = (row: TransactionRow) => {
    const leg = firstLeg(row);
    setTx({
      id: String(row.id),
      occurredAt: row.occurredAt.slice(0, 16),
      transactionType: row.transactionType,
      status: row.status,
      accountId: String(row.accountId || leg.accountId || 1),
      instrumentSymbol: leg.instrumentSymbol || 'rQQQ',
      quantity: String(Math.abs(Number(leg.quantity || 0))),
      price: String(leg.unitPrice || ''),
      grossAmount: String(leg.nominalAmount || ''),
      feeAmount: String(leg.feeAmount || 0),
      feeCurrency: leg.feeCurrency || 'USDT',
      quoteCurrency: leg.quoteCurrency || 'USDT',
      orderType: row.orderType || 'other',
      externalReference: row.externalReference || '',
      tags: row.tags.join(' '),
      note: row.note || '',
    });
    setActiveTab('交易流水');
  };

  return (
    <Page title="理财情报台" subtitle="可编辑、可删除、可恢复、可审计的投资账本。本站不再自动采集行情，研究提示词复制到 ChatGPT 后由 ChatGPT 联网核验。">
      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        {data ? (
          <>
            <div className="card p-4"><p className="text-sm text-slate-500">Asia/Shanghai</p><p className="mt-1 font-semibold text-slate-900">{data.timezones.shanghai}</p></div>
            <div className="card p-4"><p className="text-sm text-slate-500">Asia/Tokyo</p><p className="mt-1 font-semibold text-slate-900">{data.timezones.tokyo}</p></div>
            <div className="card p-4"><p className="text-sm text-slate-500">America/New_York</p><p className="mt-1 font-semibold text-slate-900">{data.timezones.newYork}</p></div>
          </>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button key={tab} className={`btn ${activeTab === tab ? 'btn-primary' : 'btn-soft'}`} type="button" onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </div>

      {message ? <div className="mb-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{message}</div> : null}
      {!data ? <div className="card p-5 text-sm text-slate-500">正在读取理财账本...</div> : null}

      {data && activeTab === '概览' ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="card p-4"><p className="text-sm text-slate-500">可自由 USDT</p><p className="mt-1 text-2xl font-semibold">{formatNumber(data.portfolio.freeUsdt, 4)}</p></div>
            <div className="card p-4"><p className="text-sm text-slate-500">QQQ/rQQQ 弹药</p><p className="mt-1 text-2xl font-semibold">{formatNumber(data.portfolio.qqqAmmoUsdt, 4)}</p></div>
            <div className="card p-4"><p className="text-sm text-slate-500">锁定/高风险余额</p><p className="mt-1 text-2xl font-semibold">{formatNumber(data.portfolio.lockedValueUsdt, 4)}</p></div>
            <div className="card p-4"><p className="text-sm text-slate-500">待迁移核对</p><p className="mt-1 text-2xl font-semibold">{data.migrationAudit.summary.example_pending || 0}</p></div>
          </div>
          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 p-4">
                <h2 className="font-semibold text-slate-900">当前持仓</h2>
                <button className="btn btn-primary" type="button" disabled={Boolean(busy)} onClick={() => void run('生成研究提示词', async () => (await serverApi.generateMarketPrompt()).dashboard)}>
                  <FileText size={16} /> 生成 ChatGPT 研究提示词
                </button>
              </div>
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">标的</th><th>账户</th><th>数量</th><th>移动均价</th><th>成本</th><th>已实现盈亏</th><th>未实现盈亏</th></tr></thead>
                <tbody>{data.portfolio.positions.map((item) => <tr key={item.key} className="border-t border-slate-100"><td className="p-3 font-semibold">{item.symbol}</td><td>{item.accountName || item.accountId}</td><td>{formatNumber(item.quantity, 8)}</td><td>{formatNumber(item.averageCost, 6)}</td><td>{formatNumber(item.costBasis, 4)}</td><td>{formatNumber(item.realizedPnl, 4)}</td><td>{item.unrealizedPnl === null ? '需手动参考价' : formatNumber(item.unrealizedPnl, 4)}</td></tr>)}</tbody>
              </table>
            </section>
            <aside className="space-y-3">
              <div className="card p-4">
                <h3 className="font-semibold text-slate-900">系统边界</h3>
                <p className="mt-2 text-sm text-slate-600">{data.systemStatus.message}</p>
              </div>
              <div className="card p-4">
                <h3 className="font-semibold text-slate-900">最近交易</h3>
                <div className="mt-3 space-y-2 text-sm text-slate-600">{data.transactions.slice(0, 5).map((row) => <p key={row.id}>#{row.id} {row.transactionType} {firstLeg(row).instrumentSymbol} {formatNumber(firstLeg(row).quantity, 8)}</p>)}</div>
              </div>
            </aside>
          </div>
        </div>
      ) : null}

      {data && activeTab === '交易流水' ? (
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <form className="card space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); void run(tx.id ? '编辑交易' : '新增交易', saveTx).then(() => setTx(emptyTx)); }}>
            <h2 className="font-semibold text-slate-900"><Plus size={16} className="mr-1 inline" />{tx.id ? `编辑交易 #${tx.id}` : '新增手动交易'}</h2>
            <label className="label">时间<input className="field" type="datetime-local" value={tx.occurredAt} onChange={(event) => setTx({ ...tx, occurredAt: event.target.value })} /></label>
            <label className="label">类型<select className="field" value={tx.transactionType} onChange={(event) => setTx({ ...tx, transactionType: event.target.value })}>{['buy', 'sell', 'deposit', 'withdrawal', 'transfer', 'exchange', 'lock', 'unlock', 'dividend', 'interest', 'reward', 'fee', 'adjustment', 'other'].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="label">状态<select className="field" value={tx.status} onChange={(event) => setTx({ ...tx, status: event.target.value })}>{['draft', 'pending', 'confirmed', 'cleared', 'reconciled'].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="label">账户<select className="field" value={tx.accountId} onChange={(event) => setTx({ ...tx, accountId: event.target.value })}>{data.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="label">标的<input className="field" value={tx.instrumentSymbol} onChange={(event) => setTx({ ...tx, instrumentSymbol: event.target.value })} /></label>
            <div className="grid grid-cols-2 gap-2"><label className="label">数量<input className="field" value={tx.quantity} onChange={(event) => setTx({ ...tx, quantity: event.target.value })} /></label><label className="label">单价<input className="field" value={tx.price} onChange={(event) => setTx({ ...tx, price: event.target.value })} /></label></div>
            <div className="grid grid-cols-2 gap-2"><label className="label">成交额<input className="field" value={tx.grossAmount} onChange={(event) => setTx({ ...tx, grossAmount: event.target.value })} /></label><label className="label">计价币<input className="field" value={tx.quoteCurrency} onChange={(event) => setTx({ ...tx, quoteCurrency: event.target.value })} /></label></div>
            <div className="grid grid-cols-2 gap-2"><label className="label">手续费<input className="field" value={tx.feeAmount} onChange={(event) => setTx({ ...tx, feeAmount: event.target.value })} /></label><label className="label">手续费币种<input className="field" value={tx.feeCurrency} onChange={(event) => setTx({ ...tx, feeCurrency: event.target.value })} /></label></div>
            <label className="label">订单类型<input className="field" value={tx.orderType} onChange={(event) => setTx({ ...tx, orderType: event.target.value })} /></label>
            <label className="label">订单/成交编号<input className="field" value={tx.externalReference} onChange={(event) => setTx({ ...tx, externalReference: event.target.value })} /></label>
            <label className="label">标签<input className="field" value={tx.tags} onChange={(event) => setTx({ ...tx, tags: event.target.value })} /></label>
            <label className="label">备注<textarea className="field" value={tx.note} onChange={(event) => setTx({ ...tx, note: event.target.value })} /></label>
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" disabled={Boolean(busy) || data.readOnly}><Save size={16} />保存</button>
              {tx.id ? <button className="btn btn-soft" type="button" onClick={() => setTx(emptyTx)}>取消</button> : null}
            </div>
          </form>
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3">
              <input className="field max-w-xs" placeholder="搜索交易、备注、标的、标签" value={filter} onChange={(event) => setFilter(event.target.value)} />
              <div className="flex gap-2">
                <button className="btn btn-soft" type="button" onClick={() => downloadText('investment-transactions.csv', transactionToCsv(data.transactions), 'text/csv;charset=utf-8')}><Download size={16} />CSV</button>
                <button className="btn btn-soft" type="button" onClick={() => downloadText('investment-transactions.json', JSON.stringify(data.transactions, null, 2), 'application/json;charset=utf-8')}><Download size={16} />JSON</button>
              </div>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">时间</th><th>类型</th><th>标的</th><th>数量</th><th>价格</th><th>手续费</th><th>状态</th><th>备注</th><th>操作</th></tr></thead>
              <tbody>{filteredTransactions.map((row) => {
                const leg = firstLeg(row);
                return <tr key={row.id} className="border-t border-slate-100"><td className="p-3">{row.occurredAt}</td><td>{row.transactionType}</td><td className="font-semibold">{leg.instrumentSymbol}</td><td>{formatNumber(leg.quantity, 8)}</td><td>{formatNumber(leg.unitPrice, 6)}</td><td>{formatNumber(leg.feeAmount, 6)} {leg.feeCurrency}</td><td><StatusBadge value={row.status} /></td><td className="max-w-[220px] truncate">{row.note}</td><td><div className="flex gap-1"><button className="btn btn-soft" type="button" onClick={() => editTx(row)} title="编辑"><Pencil size={14} /></button><button className="btn btn-soft" type="button" onClick={() => { if (confirm('删除后会进入回收站，并立即从持仓计算中排除。')) void run('删除交易', async () => (await serverApi.deleteMarketTransaction(row.id)).dashboard); }} title="删除"><Trash2 size={14} /></button><button className="btn btn-soft" type="button" onClick={() => { if (confirm('冲销会保留原交易并生成反向调整记录。')) void run('冲销交易', async () => (await serverApi.voidMarketTransaction(row.id)).dashboard); }} title="冲销"><XCircle size={14} /></button></div></td></tr>;
              })}</tbody>
            </table>
          </section>
          <section className="card space-y-3 p-4 xl:col-span-2">
            <h2 className="font-semibold text-slate-900">CSV 导入</h2>
            <p className="text-sm text-slate-500">支持字段：时间、标的、类型、数量、单价、成交额、手续费、手续费币种、订单编号、标签、备注、状态。导入前会先 dry-run 并检测重复。</p>
            <textarea className="field min-h-32 font-mono text-sm" placeholder="时间,标的,类型,数量,单价,成交额,手续费,手续费币种,订单编号,标签,备注,状态" value={csvText} onChange={(event) => setCsvText(event.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-soft" type="button" disabled={!csvText.trim() || Boolean(busy)} onClick={() => void run('CSV 预览', async () => { const result = await serverApi.dryRunMarketImport(csvText); setImportPreview(result.result); return undefined; })}>预览</button>
              <button className="btn btn-primary" type="button" disabled={!csvText.trim() || Boolean(busy)} onClick={() => void run('CSV 导入', async () => { const result = await serverApi.commitMarketImport(csvText); setImportPreview(result.result); return result.dashboard; })}>确认导入</button>
            </div>
            {importPreview ? <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(importPreview, null, 2)}</pre> : null}
          </section>
        </div>
      ) : null}

      {data && activeTab === '仓位与资金' ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <form className="card flex items-end gap-2 p-4" onSubmit={(event) => { event.preventDefault(); void run('保存手动参考价', async () => (await serverApi.saveMarketManualPrice({ symbol: price.symbol, price: Number(price.value) })).dashboard); }}>
              <label className="label flex-1">手动参考价标的<input className="field" value={price.symbol} onChange={(event) => setPrice({ ...price, symbol: event.target.value })} /></label>
              <label className="label flex-1">价格<input className="field" value={price.value} onChange={(event) => setPrice({ ...price, value: event.target.value })} /></label>
              <button className="btn btn-primary" disabled={Boolean(busy)}><Save size={16} /></button>
            </form>
            <div className="card p-4 md:col-span-2"><p className="text-sm text-amber-700">参考价由用户手动录入，不是实时行情；未录入参考价时不计算未实现盈亏。锁定仓与高风险仓不计入 QQQ/rQQQ 弹药。</p></div>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <section className="card overflow-hidden"><h2 className="border-b border-slate-100 p-4 font-semibold">持仓</h2><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">标的</th><th>账户</th><th>数量</th><th>均价</th><th>成本待核对</th></tr></thead><tbody>{data.portfolio.positions.map((item) => <tr key={item.key} className="border-t border-slate-100"><td className="p-3 font-semibold">{item.symbol}</td><td>{item.accountName}</td><td>{formatNumber(item.quantity, 8)}</td><td>{formatNumber(item.averageCost, 6)}</td><td>{item.costReviewRequired ? '是' : '否'}</td></tr>)}</tbody></table></section>
            <section className="card overflow-hidden"><h2 className="border-b border-slate-100 p-4 font-semibold">余额</h2><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">币种</th><th>账户</th><th>数量</th><th>锁定</th><th>高风险</th></tr></thead><tbody>{data.portfolio.balances.map((item) => <tr key={item.key} className="border-t border-slate-100"><td className="p-3 font-semibold">{item.symbol}</td><td>{item.accountName}</td><td>{formatNumber(item.quantity, 8)}</td><td>{item.locked ? '是' : '否'}</td><td>{item.highRisk ? '是' : '否'}</td></tr>)}</tbody></table></section>
          </div>
        </div>
      ) : null}

      {data && activeTab === 'Day 单计划' ? (
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <form className="card space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); void run('保存 Day 单计划', async () => (await serverApi.saveMarketDayOrderPlan({ instrumentSymbol: 'rQQQ', direction: 'buy', availableAmmoSnapshot: data.portfolio.qqqAmmoUsdt, estimatedFeeRate: Number(plan.feeRate), validUntil: '美股当日收盘', note: plan.note, legs: [{ limitPrice: Number(plan.price1), amountUsdt: Number(plan.amount1) }, { limitPrice: Number(plan.price2), amountUsdt: Number(plan.amount2) }].filter((item) => item.limitPrice > 0 && item.amountUsdt > 0) })).dashboard); }}>
            <h2 className="font-semibold text-slate-900"><WalletCards size={16} className="mr-1 inline" />Day 限价计划器</h2>
            <p className="text-sm text-slate-500">只生成计划和提醒，不连接交易所，不代表已挂单或已撤单。</p>
            <div className="grid grid-cols-2 gap-2"><label className="label">第一档金额<input className="field" value={plan.amount1} onChange={(event) => setPlan({ ...plan, amount1: event.target.value })} /></label><label className="label">第一档限价<input className="field" value={plan.price1} onChange={(event) => setPlan({ ...plan, price1: event.target.value })} /></label></div>
            <div className="grid grid-cols-2 gap-2"><label className="label">第二档金额<input className="field" value={plan.amount2} onChange={(event) => setPlan({ ...plan, amount2: event.target.value })} /></label><label className="label">第二档限价<input className="field" value={plan.price2} onChange={(event) => setPlan({ ...plan, price2: event.target.value })} /></label></div>
            <label className="label">预计手续费率<input className="field" value={plan.feeRate} onChange={(event) => setPlan({ ...plan, feeRate: event.target.value })} /></label>
            <label className="label">备注<textarea className="field" value={plan.note} onChange={(event) => setPlan({ ...plan, note: event.target.value })} /></label>
            <button className="btn btn-primary w-full" disabled={Boolean(busy)}><Save size={16} />保存计划</button>
          </form>
          <div className="space-y-3">
            {data.orderPlans.map((item) => <div key={item.id} className="card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">#{item.id} {item.planDate} {item.instrumentSymbol}</h3><StatusBadge value={item.status} /></div><p className="mt-1 text-sm text-slate-500">可用弹药快照 {formatNumber(item.availableAmmoSnapshot, 4)} USDT，总占用 {formatNumber(item.totalAmount, 4)} USDT，有效期 {item.validUntil}</p><div className="mt-3 grid gap-2 md:grid-cols-2">{item.legs.map((leg) => <div key={leg.levelIndex} className="rounded-lg border border-slate-200 p-3 text-sm">第 {leg.levelIndex} 档：限价 {formatNumber(leg.limitPrice, 6)}，金额 {formatNumber(leg.amountUsdt, 4)}，预计数量 {formatNumber(leg.expectedQuantity, 8)}，手续费 {formatNumber(leg.expectedFee, 6)}</div>)}</div><p className="mt-3 text-sm text-amber-700">请到 Bitget 手动确认 Day 单状态。</p><div className="mt-3 flex gap-2"><button className="btn btn-soft" type="button" onClick={() => void run('复制 Day 单计划', async () => (await serverApi.duplicateMarketDayOrderPlan(item.id)).dashboard)}>复制到今天</button><button className="btn btn-soft" type="button" onClick={() => void run('删除 Day 单计划', async () => (await serverApi.deleteMarketDayOrderPlan(item.id)).dashboard)}>删除</button></div></div>)}
          </div>
        </div>
      ) : null}

      {data && activeTab === 'ChatGPT 研究提示词' ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <section className="card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">每日研究提示词</h2><button className="btn btn-primary" disabled={Boolean(busy)} type="button" onClick={() => void run('生成研究提示词', async () => (await serverApi.generateMarketPrompt()).dashboard)}><FileText size={16} />生成</button></div>
            <textarea className="field min-h-[560px] font-mono text-sm" readOnly value={latestMarkdown || '暂无提示词，请先生成。'} />
            <div className="mt-3 flex flex-wrap gap-2"><button className="btn btn-soft" type="button" onClick={() => void navigator.clipboard.writeText(latestMarkdown)}><Copy size={16} />复制 Markdown</button><button className="btn btn-soft" type="button" onClick={() => downloadText('qqq-research-prompt.md', latestMarkdown)}><Download size={16} />下载 Markdown</button><button className="btn btn-soft" type="button" onClick={() => downloadText('qqq-research-prompt.json', JSON.stringify(data.latestReport || {}, null, 2), 'application/json;charset=utf-8')}><Download size={16} />下载 JSON</button></div>
          </section>
          <aside className="card p-4"><h3 className="font-semibold text-slate-900">历史提示词</h3><div className="mt-3 space-y-2 text-sm">{data.reports.map((item) => <button key={item.id} className="block w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50" type="button" onClick={() => downloadText(`research-prompt-${item.id}.md`, item.markdown)}>{item.generatedAt}<br /><span className="text-slate-500">{item.reportType}</span></button>)}</div></aside>
        </div>
      ) : null}

      {data && activeTab === '账户核对' ? (
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <form className="card space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); let actual: Record<string, number>; try { actual = JSON.parse(reconcile.actualJson) as Record<string, number>; } catch { setMessage('实际余额 JSON 格式错误'); return; } void run('保存账户核对', async () => (await serverApi.saveMarketReconciliation({ accountId: Number(reconcile.accountId), actual, note: reconcile.note })).dashboard); }}>
            <h2 className="font-semibold text-slate-900">新增核对记录</h2>
            <label className="label">账户<select className="field" value={reconcile.accountId} onChange={(event) => setReconcile({ ...reconcile, accountId: event.target.value })}>{data.accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="label">实际余额 JSON<textarea className="field min-h-32 font-mono" value={reconcile.actualJson} onChange={(event) => setReconcile({ ...reconcile, actualJson: event.target.value })} /></label>
            <label className="label">备注<textarea className="field" value={reconcile.note} onChange={(event) => setReconcile({ ...reconcile, note: event.target.value })} /></label>
            <button className="btn btn-primary w-full"><Save size={16} />保存核对</button>
          </form>
          <section className="card overflow-hidden"><h2 className="border-b border-slate-100 p-4 font-semibold">核对历史</h2><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">时间</th><th>账户</th><th>状态</th><th>差异</th><th>备注</th></tr></thead><tbody>{data.reconciliations.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="p-3">{item.reconciledAt}</td><td>{item.accountId}</td><td><StatusBadge value={item.status} /></td><td><code>{JSON.stringify(item.diff)}</code></td><td>{item.note}</td></tr>)}</tbody></table></section>
        </div>
      ) : null}

      {data && activeTab === '回收站' ? (
        <section className="card overflow-hidden">
          <table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">删除时间</th><th>原时间</th><th>类型</th><th>标的</th><th>备注</th><th>操作</th></tr></thead><tbody>{data.deletedTransactions.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="p-3">{row.deletedAt}</td><td>{row.occurredAt}</td><td>{row.transactionType}</td><td>{firstLeg(row).instrumentSymbol}</td><td className="max-w-[280px] truncate">{row.note}</td><td><div className="flex gap-2"><button className="btn btn-soft" type="button" onClick={() => void run('恢复交易', async () => (await serverApi.restoreMarketTransaction(row.id)).dashboard)}><ArchiveRestore size={14} />恢复</button><button className="btn btn-soft" type="button" onClick={() => { if (confirm('永久删除只保留最小审计事件，无法从页面恢复。')) void run('永久删除交易', async () => (await serverApi.permanentDeleteMarketTransaction(row.id)).dashboard); }}><Trash2 size={14} />永久删除</button></div></td></tr>)}</tbody></table>
        </section>
      ) : null}

      {data && activeTab === '迁移核对与系统状态' ? (
        <div className="space-y-4">
          <section className="card p-4"><h2 className="font-semibold text-slate-900">系统状态</h2><p className="mt-2 text-sm text-slate-600">{data.systemStatus.message}</p><div className="mt-3 flex flex-wrap gap-2">{data.sourceStatus.map((item) => <StatusBadge key={item.sourceKey} value={`${item.sourceName}: ${item.status}`} />)}</div></section>
          <section className="card overflow-hidden"><h2 className="border-b border-slate-100 p-4 font-semibold">迁移核对</h2><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">ID</th><th>状态</th><th>来源</th><th>类型</th><th>标的</th><th>是否计入真实资产</th><th>操作</th></tr></thead><tbody>{data.migrationAudit.rows.map((row) => <tr key={row.id} className="border-t border-slate-100"><td className="p-3">#{row.id}</td><td><StatusBadge value={row.migrationState} /></td><td>{row.source}</td><td>{row.transactionType}</td><td>{firstLeg(row).instrumentSymbol}</td><td>{row.migrationState === 'example_pending' || row.migrationState === 'archived' ? '否' : '是'}</td><td><div className="flex gap-2"><button className="btn btn-soft" type="button" onClick={() => void run('标记为真实记录', async () => (await serverApi.markMarketMigration(row.id, 'active')).dashboard)}><RotateCcw size={14} />确认</button><button className="btn btn-soft" type="button" onClick={() => void run('归档迁移记录', async () => (await serverApi.markMarketMigration(row.id, 'archived')).dashboard)}>归档</button></div></td></tr>)}</tbody></table></section>
        </div>
      ) : null}
    </Page>
  );
}
