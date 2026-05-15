import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CloudSun, Mail, RefreshCw, TrendingUp } from 'lucide-react';
import { Page } from '../components/Page';
import { EmptyState } from '../components/EmptyState';
import { Toast } from '../components/Toast';
import { serverApi, type DailyBrief } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
import { useDashboardData } from '../hooks/useDashboardData';
import { minutesToHoursText } from '../utils/date';

function changeClass(value?: number) {
  if (!value) return 'text-slate-500';
  return value >= 0 ? 'text-emerald-600' : 'text-rose-600';
}

function BriefDetail({ brief }: { brief: DailyBrief }) {
  const weather = brief.payload.weather;
  const learning = brief.payload.learning;
  const markets = brief.payload.markets ?? [];

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-blue-700">{brief.date}</p>
          <h2 className="mt-1 text-xl font-semibold text-slate-950">{brief.title}</h2>
          <p className="mt-1 text-sm text-slate-500">生成时间：{new Date(brief.generatedAt).toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-500">
          {brief.emailedAt ? `已邮件推送 ${new Date(brief.emailedAt).toLocaleString()}` : '尚未邮件推送'}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CloudSun size={16} />天气</p>
          {weather?.ok ? (
            <>
              <p className="mt-3 text-2xl font-semibold text-slate-950">{weather.temperature}℃</p>
              <p className="mt-1 text-sm text-slate-600">{weather.cityName} · {weather.condition} · {weather.minTemperature}-{weather.maxTemperature}℃</p>
              <p className="mt-1 text-sm text-slate-500">降水概率 {weather.precipitationProbability ?? 0}%</p>
            </>
          ) : (
            <p className="mt-3 text-sm text-rose-600">天气获取失败：{weather?.error || '未知错误'}</p>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarCheck size={16} />学习提醒</p>
          <p className="mt-3 text-sm text-slate-600">昨日学习：{minutesToHoursText(learning?.yesterdayMinutes ?? 0)}</p>
          <p className="mt-1 text-sm text-slate-600">近 7 天累计：{minutesToHoursText(learning?.last7Minutes ?? 0)}</p>
          {learning?.activeGoal ? <p className="mt-1 text-sm text-slate-600">{learning.activeGoal.name} 剩余 {learning.activeGoal.daysLeft} 天</p> : null}
          {learning?.yesterdayReview?.problems ? <p className="mt-3 line-clamp-3 text-sm text-slate-500">昨日问题：{learning.yesterdayReview.problems}</p> : null}
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><TrendingUp size={16} />指数与资产</h3>
          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
            <div className="grid grid-cols-[1fr_90px_90px] bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
              <span>名称</span>
              <span>最新</span>
              <span>涨跌</span>
            </div>
            {markets.length ? markets.map((item) => (
              <div key={`${item.name}-${item.symbol}`} className="grid grid-cols-[1fr_90px_90px] items-center border-t border-slate-100 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-800">{item.name}</p>
                  <p className="text-xs text-slate-500">{item.symbol}</p>
                </div>
                <span>{item.ok ? item.price : '--'}</span>
                <span className={changeClass(item.changePercent)}>{item.ok ? `${item.changePercent}%` : '失败'}</span>
              </div>
            )) : <div className="border-t border-slate-100 px-3 py-4 text-sm text-slate-500">暂无指数配置。</div>}
          </div>
        </div>

        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><CalendarCheck size={16} />今日待推进</h3>
          <div className="mt-3 space-y-2">
            {learning?.todayTasks?.length ? learning.todayTasks.map((task) => (
              <div key={task.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <p className="text-sm font-semibold text-slate-800">{task.title}</p>
                <p className="mt-1 text-xs text-slate-500">到期：{task.dueDate} · {task.urgency}</p>
              </div>
            )) : <EmptyState title="今天没有到期任务" description="短期目标会在这里变成晨间提醒。" />}
          </div>
        </div>
      </div>
    </section>
  );
}

export function NotificationsPage() {
  const { readOnly } = useDashboardData();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);
  const { data } = useQuery({
    queryKey: queryKeys.briefs,
    queryFn: () => serverApi.getBriefs(30),
    placeholderData: { briefs: [] as DailyBrief[] },
  });
  const briefs = data?.briefs ?? [];
  const selected = useMemo(() => briefs.find((brief) => brief.id === selectedId) ?? briefs[0] ?? null, [briefs, selectedId]);

  const refreshBriefs = async (preferred?: DailyBrief) => {
    const result = await serverApi.getBriefs(30);
    queryClient.setQueryData(queryKeys.briefs, result);
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
    setSelectedId(preferred?.id ?? result.briefs[0]?.id ?? null);
  };

  const generate = async (sendEmail = false) => {
    if (readOnly) return;
    setLoading(true);
    try {
      const result = await serverApi.generateBrief(sendEmail);
      await refreshBriefs(result.brief);
      setToast(sendEmail ? '简报已生成并尝试邮件推送' : '今日简报已生成');
    } catch {
      setToast('简报生成失败，请稍后重试');
    } finally {
      setLoading(false);
      window.setTimeout(() => setToast(''), 2200);
    }
  };

  const sendLatest = async () => {
    if (readOnly) return;
    setLoading(true);
    try {
      const result = await serverApi.sendLatestBrief();
      await refreshBriefs(result.brief);
      setToast('最新简报已邮件推送');
    } catch {
      setToast('邮件推送失败，请检查 SMTP 配置');
    } finally {
      setLoading(false);
      window.setTimeout(() => setToast(''), 2200);
    }
  };

  return (
    <Page title="通知中心" subtitle="每天早上聚合天气、指数涨跌和学习提醒，也可以配置邮件推送。">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={readOnly || loading} onClick={() => void generate(false)}>
            <RefreshCw size={16} />生成今日简报
          </button>
          <button className="btn btn-soft" disabled={readOnly || loading} onClick={() => void sendLatest()}>
            <Mail size={16} />发送最新简报
          </button>
        </div>
        <p className="text-sm text-slate-500">自动生成时间和邮件 SMTP 在设置页配置。</p>
      </div>

      {selected ? (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {briefs.map((brief) => (
              <button
                key={brief.id}
                className={`w-full rounded-lg border p-3 text-left transition ${
                  selected.id === brief.id ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                }`}
                onClick={() => setSelectedId(brief.id)}
              >
                <p className="text-sm font-semibold">{brief.title}</p>
                <p className="mt-1 text-xs opacity-70">{new Date(brief.generatedAt).toLocaleString()}</p>
                <p className="mt-2 text-xs opacity-70">{brief.emailedAt ? '已邮件推送' : '未邮件推送'}</p>
              </button>
            ))}
          </div>
          <BriefDetail brief={selected} />
        </div>
      ) : (
        <EmptyState title="还没有晨间简报" description="点击生成今日简报后，这里会显示天气、指数和学习提醒。" />
      )}
      {toast ? <Toast message={toast} /> : null}
    </Page>
  );
}
