import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BriefcaseBusiness, Clock3, Layers3, TrendingDown, TrendingUp } from 'lucide-react';
import { ChartBox, MinutesBar, TrendLine } from '../components/Charts';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { serverApi } from '../api/client';
import { queryKeys } from '../api/queryClient';
import { minutesToHoursText } from '../utils/date';

const momentumText = {
  up: '升温',
  flat: '平稳',
  down: '放缓',
};

const momentumClass = {
  up: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  flat: 'border-blue-200 bg-blue-50 text-blue-700',
  down: 'border-amber-200 bg-amber-50 text-amber-700',
};

export function ProjectProgressPage() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.projectProgress,
    queryFn: serverApi.getProjectProgress,
  });

  const activeItems = useMemo(() => (data?.items ?? []).filter((item) => item.isActive), [data?.items]);
  const last30Bars = useMemo(() => activeItems.map((item) => ({ name: item.name, minutes: item.last30Minutes })), [activeItems]);

  return (
    <Page title="项目进展看板" subtitle="按学习项目拆解投入、占比、最近活跃时间和短期趋势。">
      {data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="全部项目投入" value={minutesToHoursText(data.totals.totalMinutes)} hint={`${data.totals.activeProjects} 个启用项目`} icon={<Layers3 size={20} />} />
            <MetricCard label="近 30 天重点" value={data.totals.topProject?.name ?? '暂无'} hint={data.totals.topProject ? minutesToHoursText(data.totals.topProject.minutes) : '没有新的项目记录'} icon={<BriefcaseBusiness size={20} />} />
            <MetricCard label="活跃项目" value={`${data.totals.activeProjects} 个`} hint={`${data.totals.inactiveProjects} 个已停用`} icon={<TrendingUp size={20} />} />
            <MetricCard label="最近记录" value={activeItems.find((item) => item.lastStudiedAt)?.lastStudiedAt ?? '暂无'} hint="按项目最近学习日期排序" icon={<Clock3 size={20} />} />
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.2fr_1fr]">
            <ChartBox title="近 30 天总投入趋势">
              {data.daily.some((item) => item.minutes > 0) ? <TrendLine data={data.daily} /> : <EmptyState title="暂无学习时间记录" />}
            </ChartBox>
            <ChartBox title="近 30 天项目排行">
              {last30Bars.some((item) => item.minutes > 0) ? <MinutesBar data={last30Bars} denseLabels /> : <EmptyState title="暂无项目排行" />}
            </ChartBox>
          </div>

          <section className="mt-5 grid gap-4 lg:grid-cols-2">
            {activeItems.length ? activeItems.map((item) => (
              <article key={item.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: item.color }} />
                      <h2 className="truncate text-base font-semibold text-slate-950">{item.name}</h2>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">最近学习：{item.lastStudiedAt ?? '暂无'}</p>
                  </div>
                  <span className={`rounded-lg border px-3 py-1 text-xs font-semibold ${momentumClass[item.momentum]}`}>
                    {item.momentum === 'down' ? <TrendingDown className="inline" size={13} /> : <TrendingUp className="inline" size={13} />} {momentumText[item.momentum]}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-500">总投入</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{minutesToHoursText(item.totalMinutes)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-500">近 30 天</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{minutesToHoursText(item.last30Minutes)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold text-slate-500">占比</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{item.sharePercent}%</p>
                  </div>
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(100, item.sharePercent)}%` }} />
                </div>
              </article>
            )) : <EmptyState title={isLoading ? '正在读取项目进展' : '暂无启用项目'} />}
          </section>
        </>
      ) : (
        <EmptyState title={isLoading ? '正在读取项目进展' : '暂无项目进展'} />
      )}
    </Page>
  );
}
