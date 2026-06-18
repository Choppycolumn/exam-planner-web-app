import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock3, Monitor, ShieldCheck, Target, TimerReset } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartBox } from '../components/Charts';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { serverApi, type StudyPetDailyReport, type StudyPetSiteUsage } from '../api/client';
import { queryKeys } from '../api/queryClient';

const categoryLabels: Record<string, string> = {
  study: '学习',
  entertainment: '娱乐',
  tool: '工具',
  social: '社交',
  unknown: '未知',
};

function secondsToText(seconds = 0) {
  const totalMinutes = Math.round(Math.max(0, seconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

function toMinutes(seconds = 0) {
  return Math.round(Math.max(0, seconds) / 60);
}

function addDaysISO(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function fillDailyRange(startDate: string, endDate: string, daily: StudyPetDailyReport[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return [];
  const byDate = new Map(daily.map((item) => [item.date, item]));
  const rows: Array<{
    date: string;
    studyMinutes: number;
    entertainmentMinutes: number;
    totalMinutes: number;
  }> = [];
  let cursor = startDate;
  for (let guard = 0; guard < 31 && cursor <= endDate; guard += 1) {
    const item = byDate.get(cursor);
    rows.push({
      date: cursor.slice(5),
      studyMinutes: toMinutes(item?.studySeconds ?? 0),
      entertainmentMinutes: toMinutes(item?.entertainmentSeconds ?? 0),
      totalMinutes: toMinutes(item?.totalComputerSeconds ?? 0),
    });
    cursor = addDaysISO(cursor, 1);
  }
  return rows;
}

function categoryTone(category: string) {
  if (category === 'study') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (category === 'entertainment') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (category === 'tool') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (category === 'social') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function SiteUsageTable({ sites }: { sites: StudyPetSiteUsage[] }) {
  if (!sites.length) return <EmptyState title="暂无网站使用排行" description="桌宠同步后会在这里显示使用时间最长的网站。" />;
  const maxSeconds = Math.max(...sites.map((site) => site.seconds), 1);
  return (
    <div className="space-y-3">
      {sites.slice(0, 12).map((site) => {
        const width = `${Math.max(4, Math.round((site.seconds / maxSeconds) * 100))}%`;
        return (
          <article key={`${site.deviceId || 'device'}-${site.domain}-${site.category}`} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-slate-900">{site.domain}</h3>
                <p className="mt-1 text-xs text-slate-500">{site.visits} 次访问 · {secondsToText(site.seconds)}</p>
              </div>
              <span className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${categoryTone(site.category)}`}>
                {categoryLabels[site.category] || '未知'}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-blue-600" style={{ width }} />
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function StudyPetStatsPage() {
  const todayQuery = useQuery({
    queryKey: queryKeys.studyPetToday(),
    queryFn: () => serverApi.getStudyPetToday(),
  });
  const statsQuery = useQuery({
    queryKey: queryKeys.studyPetStats(),
    queryFn: () => serverApi.getStudyPetStats(),
  });

  const report = todayQuery.data?.report ?? null;
  const stats = statsQuery.data;
  const hasAnyData = Boolean(report || stats?.daily.length || stats?.siteUsage.length);
  const dailyTrend = useMemo(
    () => fillDailyRange(stats?.startDate ?? '', stats?.endDate ?? '', stats?.daily ?? []),
    [stats?.daily, stats?.endDate, stats?.startDate],
  );
  const hasTrendData = dailyTrend.some((item) => item.studyMinutes > 0 || item.entertainmentMinutes > 0 || item.totalMinutes > 0);
  const todaySites = todayQuery.data?.sites ?? [];
  const topSites = stats?.siteUsage?.length ? stats.siteUsage : todaySites;
  const todayCategoryData = report
    ? [
        { name: '学习', minutes: toMinutes(report.studySeconds), fill: '#16a34a' },
        { name: '娱乐', minutes: toMinutes(report.entertainmentSeconds), fill: '#dc2626' },
        { name: '工具', minutes: toMinutes(report.toolSeconds), fill: '#2563eb' },
        { name: '社交', minutes: toMinutes(report.socialSeconds), fill: '#ca8a04' },
        { name: '未知', minutes: toMinutes(report.unknownSeconds), fill: '#64748b' },
      ]
    : [];

  return (
    <Page title="桌宠统计" subtitle="来自 Windows 桌宠的电脑使用、学习娱乐分类和强提醒记录。">
      {!hasAnyData && !todayQuery.isLoading && !statsQuery.isLoading ? (
        <div className="mb-5">
          <EmptyState title="暂无桌宠统计数据，请先启动桌宠同步" description="桌宠端同步成功后，这里会显示今日统计、最近 7 天趋势和网站排行。" />
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="今日电脑使用" value={secondsToText(report?.totalComputerSeconds ?? 0)} icon={<Monitor size={20} />} />
        <MetricCard label="今日学习时间" value={secondsToText(report?.studySeconds ?? 0)} icon={<Clock3 size={20} />} />
        <MetricCard label="今日娱乐时间" value={secondsToText(report?.entertainmentSeconds ?? 0)} icon={<AlertTriangle size={20} />} />
        <MetricCard
          label="学习目标"
          value={report?.studyGoal.completed ? '已完成' : '未完成'}
          hint={report?.studyGoal.targetStudySeconds ? `目标 ${secondsToText(report.studyGoal.targetStudySeconds)}` : '暂未设置目标'}
          icon={report?.studyGoal.completed ? <ShieldCheck size={20} /> : <Target size={20} />}
        />
        <MetricCard
          label="强提醒"
          value={`${report?.strongReminderCount ?? 0} 次`}
          hint={`娱乐超时 ${report?.entertainmentOvertimeCount ?? 0} 次`}
          icon={<TimerReset size={20} />}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <ChartBox title="最近 7 天学习 / 娱乐趋势">
          {hasTrendData ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => [`${value} 分钟`, '']} />
                <Legend />
                <Line type="monotone" dataKey="studyMinutes" name="学习" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="entertainmentMinutes" name="娱乐" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="暂无 7 天趋势数据" />
          )}
        </ChartBox>

        <ChartBox title="今日时间构成">
          {report && report.totalComputerSeconds > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={todayCategoryData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => [`${value} 分钟`, '用时']} />
                <Bar dataKey="minutes" radius={[6, 6, 0, 0]}>
                  {todayCategoryData.map((item) => (
                    <Cell key={item.name} fill={item.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="暂无今日构成数据" />
          )}
        </ChartBox>
      </div>

      <section className="card mt-5 p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">网站使用排行</h2>
            <p className="mt-1 text-sm text-slate-500">按最近 7 天使用时长排序，展示域名、分类、时长和访问次数。</p>
          </div>
          {stats?.generatedAt ? (
            <span className="text-xs text-slate-500">
              更新于 {new Date(stats.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
            </span>
          ) : null}
        </div>
        <SiteUsageTable sites={topSites} />
      </section>
    </Page>
  );
}
