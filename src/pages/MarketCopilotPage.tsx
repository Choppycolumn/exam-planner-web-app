import { useEffect, useMemo, useState } from 'react';
import { Copy, Database, Download, FileText, LineChart, Plus, RefreshCcw, WalletCards } from 'lucide-react';
import { Page } from '../components/Page';
import { serverApi, type MarketCopilotDashboard } from '../api/client';

const emptyTx = {
  tradedAt: new Date().toISOString().slice(0, 16),
  instrumentSymbol: 'rQQQ',
  action: '买入',
  price: '0',
  quantity: '0',
  feeAmount: '0',
  feeCurrency: 'USDT',
  orderType: 'Day 限价',
  note: '',
  confirmed: true,
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

function toCsv(rows: MarketCopilotDashboard['transactions']) {
  const header = ['id', 'tradedAt', 'instrumentSymbol', 'action', 'price', 'quantity', 'grossAmount', 'feeAmount', 'feeCurrency', 'orderType', 'confirmed', 'note'];
  return [header.join(','), ...rows.map((row) => header.map((key) => `"${String(row[key as keyof typeof row] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
}

function StatusBadge({ value }: { value: string }) {
  const tone = value.includes('ok') || value.includes('verified') || value.includes('normal') ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : value.includes('failed') || value.includes('mismatch') ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-amber-50 text-amber-700 border-amber-200';
  return <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${tone}`}>{value}</span>;
}

export function MarketCopilotPage() {
  const [data, setData] = useState<MarketCopilotDashboard | null>(null);
  const [activeTab, setActiveTab] = useState('今晚情报包');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [tx, setTx] = useState(emptyTx);
  const [manualPrice, setManualPrice] = useState({ symbol: 'rQQQ', price: '' });
  const [plan, setPlan] = useState({ amount1: '25', price1: '', amount2: '25', price2: '', feeRate: '0.001' });
  const latestMarkdown = data?.latestReport?.markdown || '';
  const rqqq = data?.portfolio.positions.find((item) => item.symbol === 'rQQQ');

  const load = async () => {
    const next = await serverApi.getMarketCopilot();
    setData(next);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial server hydration is intentionally loaded once on mount.
    void load().catch((error) => setMessage(error.message || String(error)));
  }, []);

  const run = async (label: string, action: () => Promise<MarketCopilotDashboard | undefined>) => {
    setBusy(label);
    setMessage('');
    try {
      const dashboard = await action();
      if (dashboard) setData(dashboard);
      else await load();
      setMessage(`${label} 已完成`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy('');
    }
  };

  const tabs = ['今晚情报包', '仓位与资金', '交易日志', 'Day 单计划与提醒', '数据源与运行状态'];
  const copiedText = useMemo(() => latestMarkdown || '暂无情报包，请先生成。', [latestMarkdown]);

  return (
    <Page title="理财情报台" subtitle="QQQ 情报包 + 仓位账本。只记录事实、仓位和提醒，不连接交易下单接口。">
      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        {data ? (
          <>
            <div className="card p-4">
              <p className="text-sm text-slate-500">Asia/Shanghai</p>
              <p className="mt-1 font-semibold text-slate-900">{data.timezones.shanghai}</p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-slate-500">Asia/Tokyo</p>
              <p className="mt-1 font-semibold text-slate-900">{data.timezones.tokyo}</p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-slate-500">America/New_York</p>
              <p className="mt-1 font-semibold text-slate-900">{data.timezones.newYork}</p>
            </div>
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

      {!data ? <div className="card p-5 text-sm text-slate-500">正在读取理财情报台数据...</div> : null}

      {data && activeTab === '今晚情报包' ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
          <section className="card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">QQQ / rQQQ 市场情报包</h2>
                <p className="text-sm text-slate-500">复制到 ChatGPT 后再做人类决策；本站不输出买卖结论。</p>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-soft" disabled={Boolean(busy)} type="button" onClick={() => void run('刷新行情', async () => (await serverApi.refreshMarketCopilot()).dashboard)}>
                  <RefreshCcw size={16} /> 刷新行情
                </button>
                <button className="btn btn-primary" disabled={Boolean(busy)} type="button" onClick={() => void run('生成情报包', async () => (await serverApi.generateMarketReport({ reportType: 'manual', marketStatus: '手动生成' })).dashboard)}>
                  <FileText size={16} /> 生成
                </button>
              </div>
            </div>
            <textarea className="field min-h-[560px] font-mono text-sm" readOnly value={copiedText} />
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-soft" type="button" onClick={() => void navigator.clipboard.writeText(copiedText)}>
                <Copy size={16} /> 复制 Markdown
              </button>
              <button className="btn btn-soft" type="button" onClick={() => downloadText('qqq-intelligence-report.md', copiedText)}>
                <Download size={16} /> 下载 Markdown
              </button>
              <button className="btn btn-soft" type="button" onClick={() => downloadText('qqq-intelligence-report.json', JSON.stringify(data.latestReport || {}, null, 2), 'application/json;charset=utf-8')}>
                <Download size={16} /> 下载 JSON
              </button>
            </div>
          </section>
          <aside className="space-y-4">
            <div className="card p-4">
              <h3 className="font-semibold text-slate-900">生成时间表</h3>
              <div className="mt-3 space-y-2 text-sm">
                {data.schedule.map((item) => (
                  <div key={item.label} className="flex justify-between border-b border-slate-100 pb-2">
                    <span>{item.label}</span>
                    <span className="font-semibold">{item.time}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card p-4">
              <h3 className="font-semibold text-slate-900">风险与约束</h3>
              <ul className="mt-3 space-y-2 text-sm text-slate-600">
                {data.warnings.map((item) => <li key={item}>- {item}</li>)}
              </ul>
            </div>
          </aside>
        </div>
      ) : null}

      {data && activeTab === '仓位与资金' ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="card p-4"><p className="text-sm text-slate-500">rQQQ 数量</p><p className="mt-1 text-xl font-semibold">{formatNumber(rqqq?.quantity, 8)}</p></div>
            <div className="card p-4"><p className="text-sm text-slate-500">rQQQ 加权成本</p><p className="mt-1 text-xl font-semibold">{formatNumber(rqqq?.averageCost, 6)}</p></div>
            <div className="card p-4"><p className="text-sm text-slate-500">可自由 USDT</p><p className="mt-1 text-xl font-semibold">{formatNumber(data.portfolio.freeUsdt, 4)}</p></div>
            <div className="card p-4"><p className="text-sm text-slate-500">QQQ/rQQQ 弹药</p><p className="mt-1 text-xl font-semibold">{formatNumber(data.portfolio.qqqAmmoUsdt, 4)}</p></div>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">标的</th><th>数量</th><th>均价</th><th>参考价</th><th>市值</th><th>未实现盈亏</th><th>已实现盈亏</th></tr></thead>
              <tbody>{data.portfolio.positions.map((item) => <tr key={item.symbol} className="border-t border-slate-100"><td className="p-3 font-semibold">{item.symbol}</td><td>{formatNumber(item.quantity, 8)}</td><td>{formatNumber(item.averageCost, 6)}</td><td>{formatNumber(item.referencePrice, 6)}</td><td>{formatNumber(item.marketValue, 4)}</td><td>{formatNumber(item.unrealizedPnl, 4)}</td><td>{formatNumber(item.realizedPnl, 4)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="card p-4">
            <h3 className="font-semibold text-slate-900">锁定仓</h3>
            <p className="mt-1 text-sm text-amber-700">锁定仓与高风险仓不计入 QQQ 可用弹药。</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {data.portfolio.lockedPositions.map((item) => <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm"><p className="font-semibold">{item.symbol} · {item.category}</p><p>数量 {formatNumber(item.quantity, 8)}，估值 {formatNumber(item.valueUsdt, 4)} USDT</p><p className="text-slate-500">{item.note}</p></div>)}
            </div>
          </div>
        </div>
      ) : null}

      {data && activeTab === '交易日志' ? (
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <form className="card space-y-3 p-4" onSubmit={(event) => {
            event.preventDefault();
            void run('保存交易', async () => (await serverApi.saveMarketTransaction({ ...tx, tradedAt: new Date(tx.tradedAt).toISOString(), price: Number(tx.price), quantity: Number(tx.quantity), feeAmount: Number(tx.feeAmount) })).dashboard);
          }}>
            <h2 className="font-semibold text-slate-900"><Plus size={16} className="mr-1 inline" />新增手动交易</h2>
            <label className="label">时间<input className="field" type="datetime-local" value={tx.tradedAt} onChange={(e) => setTx({ ...tx, tradedAt: e.target.value })} /></label>
            <label className="label">标的<select className="field" value={tx.instrumentSymbol} onChange={(e) => setTx({ ...tx, instrumentSymbol: e.target.value })}>{data.instruments.map((item) => <option key={item.symbol}>{item.symbol}</option>)}</select></label>
            <label className="label">动作<select className="field" value={tx.action} onChange={(e) => setTx({ ...tx, action: e.target.value })}>{['买入', '卖出', '转入', '转出', '换汇', '锁定', '解锁'].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="label">价格<input className="field" value={tx.price} onChange={(e) => setTx({ ...tx, price: e.target.value })} /></label>
            <label className="label">数量<input className="field" value={tx.quantity} onChange={(e) => setTx({ ...tx, quantity: e.target.value })} /></label>
            <label className="label">手续费<input className="field" value={tx.feeAmount} onChange={(e) => setTx({ ...tx, feeAmount: e.target.value })} /></label>
            <label className="label">手续费币种<input className="field" value={tx.feeCurrency} onChange={(e) => setTx({ ...tx, feeCurrency: e.target.value })} /></label>
            <label className="label">订单类型<select className="field" value={tx.orderType} onChange={(e) => setTx({ ...tx, orderType: e.target.value })}>{['市价', '限价', 'Day 限价', '其他'].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="label">备注<textarea className="field" value={tx.note} onChange={(e) => setTx({ ...tx, note: e.target.value })} /></label>
            <button className="btn btn-primary w-full" disabled={Boolean(busy) || data.readOnly}>保存</button>
          </form>
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 p-3">
              <h2 className="font-semibold text-slate-900">交易记录</h2>
              <button className="btn btn-soft" type="button" onClick={() => downloadText('market-transactions.csv', toCsv(data.transactions), 'text/csv;charset=utf-8')}>导出 CSV</button>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">时间</th><th>标的</th><th>动作</th><th>价格</th><th>数量</th><th>手续费</th><th>备注</th></tr></thead>
              <tbody>{data.transactions.map((item) => <tr key={item.id} className="border-t border-slate-100"><td className="p-3">{item.tradedAt}</td><td>{item.instrumentSymbol}</td><td>{item.action}</td><td>{formatNumber(item.price, 6)}</td><td>{formatNumber(item.quantity, 8)}</td><td>{formatNumber(item.feeAmount, 6)} {item.feeCurrency}</td><td className="max-w-[260px] truncate">{item.note}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      ) : null}

      {data && activeTab === 'Day 单计划与提醒' ? (
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <form className="card space-y-3 p-4" onSubmit={(event) => {
            event.preventDefault();
            void run('保存 Day 单计划', async () => (await serverApi.saveMarketDayOrderPlan({
              instrumentSymbol: 'rQQQ',
              availableUsdt: data.portfolio.qqqAmmoUsdt,
              estimatedFeeRate: Number(plan.feeRate),
              validUntil: '美股当日收盘',
              legs: [
                { limitPrice: Number(plan.price1), amountUsdt: Number(plan.amount1) },
                { limitPrice: Number(plan.price2), amountUsdt: Number(plan.amount2) },
              ].filter((item) => item.limitPrice > 0 && item.amountUsdt > 0),
            })).dashboard);
          }}>
            <h2 className="font-semibold text-slate-900"><WalletCards size={16} className="mr-1 inline" />Day 限价单计划器</h2>
            <p className="text-sm text-slate-500">只生成可复制参数，不连接交易所，不自动撤单。</p>
            <label className="label">第一档金额 USDT<input className="field" value={plan.amount1} onChange={(e) => setPlan({ ...plan, amount1: e.target.value })} /></label>
            <label className="label">第一档限价<input className="field" value={plan.price1} onChange={(e) => setPlan({ ...plan, price1: e.target.value })} /></label>
            <label className="label">第二档金额 USDT<input className="field" value={plan.amount2} onChange={(e) => setPlan({ ...plan, amount2: e.target.value })} /></label>
            <label className="label">第二档限价<input className="field" value={plan.price2} onChange={(e) => setPlan({ ...plan, price2: e.target.value })} /></label>
            <label className="label">预计手续费率<input className="field" value={plan.feeRate} onChange={(e) => setPlan({ ...plan, feeRate: e.target.value })} /></label>
            <button className="btn btn-primary w-full" disabled={Boolean(busy) || data.readOnly}>保存计划</button>
          </form>
          <div className="space-y-3">
            {data.orderPlans.map((item) => <div key={item.id} className="card p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{item.planDate} · {item.instrumentSymbol}</h3><StatusBadge value={item.status} /></div><p className="mt-1 text-sm text-slate-500">可用 {formatNumber(item.availableUsdt, 4)} USDT，手续费率 {item.estimatedFeeRate}，有效期 {item.validUntil || 'Day'}</p><div className="mt-3 grid gap-2 md:grid-cols-2">{item.legs.map((leg) => <div key={leg.levelIndex} className="rounded-lg border border-slate-200 p-3 text-sm">第 {leg.levelIndex} 档：限价 {formatNumber(leg.limitPrice, 6)}，金额 {formatNumber(leg.amountUsdt, 4)}，预计数量 {formatNumber(leg.expectedQuantity, 8)}，手续费 {formatNumber(leg.expectedFee, 6)}</div>)}</div><p className="mt-3 text-sm text-amber-700">请用户手动确认交易所实际订单状态；系统失效标记不等于已撤单。</p></div>)}
          </div>
        </div>
      ) : null}

      {data && activeTab === '数据源与运行状态' ? (
        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="font-semibold text-slate-900"><LineChart size={16} className="mr-1 inline" />市场快照</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.snapshots.map((item) => <div key={`${item.symbol}-${item.sourceKey}`} className="rounded-lg border border-slate-200 p-3"><div className="flex justify-between"><span className="font-semibold">{item.symbol}</span><StatusBadge value={item.verificationStatus} /></div><p className="mt-1 text-xl font-semibold">{formatNumber(item.value, 6)}</p><p className="text-sm text-slate-500">{item.sourceName} · {item.delayStatus}</p><p className="text-xs text-slate-400">{item.observedAt}</p></div>)}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <h2 className="font-semibold text-slate-900"><Database size={16} className="mr-1 inline" />数据源状态</h2>
              <div className="mt-3 space-y-2">{data.sourceStatus.length ? data.sourceStatus.map((item) => <div key={item.sourceKey} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="flex justify-between"><span>{item.sourceName}</span><StatusBadge value={item.status} /></div><p className="text-slate-500">{item.lastError || item.lastSuccessAt || '尚未刷新'}</p></div>) : <p className="text-sm text-slate-500">尚未刷新外部数据源。</p>}</div>
            </div>
            <form className="card space-y-3 p-4" onSubmit={(event) => {
              event.preventDefault();
              void run('保存手动价格', async () => (await serverApi.saveMarketManualPrice({ symbol: manualPrice.symbol, price: Number(manualPrice.price) })).dashboard);
            }}>
              <h2 className="font-semibold text-slate-900">手动录入 rQQQ/其他参考价</h2>
              <label className="label">标的<select className="field" value={manualPrice.symbol} onChange={(e) => setManualPrice({ ...manualPrice, symbol: e.target.value })}>{data.instruments.map((item) => <option key={item.symbol}>{item.symbol}</option>)}</select></label>
              <label className="label">价格<input className="field" value={manualPrice.price} onChange={(e) => setManualPrice({ ...manualPrice, price: e.target.value })} /></label>
              <button className="btn btn-primary" disabled={Boolean(busy) || data.readOnly}>保存手动价格</button>
            </form>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
