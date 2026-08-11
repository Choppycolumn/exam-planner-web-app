import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Award, CalendarDays, CheckCircle2, Flame, Target, TrendingUp } from 'lucide-react';
import { ChartBox, MinutesBar, ReviewTrendChart, TrendLine } from '../components/Charts';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { serverApi } from '../api/client';
import { queryKeys } from '../api/queryClient';
import { minutesToHoursText } from '../utils/date';

function percentText(value: number | null) {
  return value === null ? '暂无' : `${value}%`;
}

export function LearningProgressPage() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.learningProgress,
    queryFn: serverApi.getLearningProgress,
  });

  const summary = data?.summary;
  const weeklyDelta = useMemo(() => {
    if (!summary || !summary.previous7Minutes) return null;
    return Math.round(((summary.current7Minutes - summary.previous7Minutes) / summary.previous7Minutes) * 100);
  }, [summary]);

  const targetRate = summary?.targetDays ? Math.round((summary.targetHitDays / summary.targetDays) * 100) : null;
  const dailyMinutes = useMemo(() => data?.daily ?? [], [data?.daily]);
  const dailyTrend = useMemo(() => dailyMinutes.map((item) => ({ date: item.date, minutes: item.minutes })), [dailyMinutes]);
  const reviewTrend = data?.reviewTrend ?? [];
  const dashboard2 = useMemo(() => {
    const activeDays = dailyMinutes.filter((day) => day.minutes > 0);
    const bestDay = dailyMinutes.reduce((best, day) => (day.minutes > best.minutes ? day : best), dailyMinutes[0] ?? { date: '', minutes: 0, reviewScore: null, targetMinutes: 0, hitTarget: false });
    const lowDays = dailyMinutes.filter((day) => day.minutes > 0 && day.minutes < day.targetMinutes).length;
    const averageActiveMinutes = activeDays.length ? Math.round(activeDays.reduce((sum, day) => sum + day.minutes, 0) / activeDays.length) : 0;
    const consistencyScore = dailyMinutes.length ? Math.round(((summary?.studyStreakDays ?? 0) * 0.4 + (summary?.targetHitDays ?? 0) * 0.6) / dailyMinutes.length * 100) : 0;
    const reviewCoverage = dailyMinutes.length ? Math.round(((summary?.reviewCount ?? 0) / dailyMinutes.length) * 100) : 0;
    return { activeDays: activeDays.length, averageActiveMinutes, bestDay, lowDays, consistencyScore, reviewCoverage };
  }, [dailyMinutes, summary?.reviewCount, summary?.studyStreakDays, summary?.targetHitDays]);

  return (
    <Page title="学习进度仪表盘" subtitle="把近 30 天学习、复盘、任务完成和目标达成放在同一张进度面板里。">
      {data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="近 7 天学习" value={minutesToHoursText(summary?.current7Minutes ?? 0)} hint={weeklyDelta === null ? '暂无上周对比' : `较前 7 天 ${weeklyDelta >= 0 ? '+' : ''}${weeklyDelta}%`} icon={<TrendingUp size={20} />} />
            <MetricCard label="近 30 天学习" value={minutesToHoursText(summary?.current30Minutes ?? 0)} hint={summary?.topProject ? `最高投入：${summary.topProject.name}` : '暂无项目分布'} icon={<CalendarDays size={20} />} />
            <MetricCard label="连续学习" value={`${summary?.studyStreakDays ?? 0} 天`} hint={`目标达成率 ${percentText(targetRate)}`} icon={<Flame size={20} />} />
            <MetricCard label="短期任务" value={percentText(summary?.taskCompletionRate ?? null)} hint={`${summary?.completedTasks ?? 0}/${summary?.totalTasks ?? 0} 已完成`} icon={<CheckCircle2 size={20} />} />
          </div>

          <section className="mt-5 card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-primary">个人数据仪表盘 2.0</h2>
                <p className="mt-1 text-sm text-secondary">把连续性、目标命中、复盘覆盖和低投入天数合成一个可执行视图。</p>
              </div>
              <span className={`rounded-lg border px-3 py-2 text-sm font-semibold ${dashboard2.consistencyScore >= 70 ? 'border-success bg-success-soft text-success' : dashboard2.consistencyScore >= 45 ? 'border-warning bg-warning-soft text-warning' : 'border-danger bg-danger-soft text-danger'}`}>
                稳定性 {dashboard2.consistencyScore}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-line bg-surface-muted p-3">
                <p className="text-xs font-semibold text-secondary">活跃学习天</p>
                <p className="mt-1 text-lg font-semibold text-primary">{dashboard2.activeDays}/{dailyMinutes.length}</p>
                <p className="mt-1 text-xs text-secondary">活跃日均 {minutesToHoursText(dashboard2.averageActiveMinutes)}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-muted p-3">
                <p className="text-xs font-semibold text-secondary">最佳单日</p>
                <p className="mt-1 text-lg font-semibold text-primary">{dashboard2.bestDay.date || '--'}</p>
                <p className="mt-1 text-xs text-secondary">{minutesToHoursText(dashboard2.bestDay.minutes)}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-muted p-3">
                <p className="text-xs font-semibold text-secondary">复盘覆盖率</p>
                <p className="mt-1 text-lg font-semibold text-primary">{dashboard2.reviewCoverage}%</p>
                <p className="mt-1 text-xs text-secondary">近 30 天复盘 {summary?.reviewCount ?? 0} 次</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-muted p-3">
                <p className="text-xs font-semibold text-secondary">低于目标天数</p>
                <p className="mt-1 text-lg font-semibold text-primary">{dashboard2.lowDays}</p>
                <p className="mt-1 text-xs text-secondary">有学习但未达目标</p>
              </div>
            </div>
          </section>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <ChartBox title="近 30 天学习趋势">
              {dailyMinutes.some((item) => item.minutes > 0) ? <TrendLine data={dailyTrend} /> : <EmptyState title="暂无学习时间记录" />}
            </ChartBox>
            <ChartBox title="复盘评分趋势">
              {reviewTrend.some((item) => item.score !== null) ? <ReviewTrendChart data={reviewTrend} /> : <EmptyState title="暂无复盘评分" />}
            </ChartBox>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.2fr]">
            <section className="card p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Target size={18} />
                目标达成日历
              </div>
              <div className="mt-4 grid grid-cols-7 gap-2">
                {dailyMinutes.map((day) => (
                  <div key={day.date} className={`rounded-lg border p-2 text-center text-xs ${day.hitTarget ? 'border-success bg-success-soft text-success' : day.minutes > 0 ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface-muted text-secondary'}`}>
                    <p className="font-semibold">{day.date.slice(5)}</p>
                    <p className="mt-1">{day.minutes} 分钟</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs leading-5 text-secondary">绿色表示达到每日学习目标，蓝色表示有学习但未达到目标。</p>
            </section>

            <ChartBox title="近 30 天项目投入">
              {data.projectTotals.length ? <MinutesBar data={data.projectTotals} denseLabels /> : <EmptyState title="暂无项目投入数据" />}
            </ChartBox>
          </div>

          <section className="mt-5 card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Award size={18} />
              本期观察
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-line bg-surface-muted p-3">
                <p className="text-xs font-semibold text-secondary">复盘覆盖</p>
                <p className="mt-1 text-lg font-semibold text-primary">{summary?.reviewCount ?? 0} 次</p>
                <p className="mt-1 text-xs text-secondary">均分 {summary?.averageReviewScore ?? '暂无'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-muted p-3">
                <p className="text-xs font-semibold text-secondary">学习目标</p>
                <p className="mt-1 text-lg font-semibold text-primary">{summary?.targetHitDays ?? 0}/{summary?.targetDays ?? 0} 天</p>
                <p className="mt-1 text-xs text-secondary">按当前每日目标统计</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-muted p-3">
                <p className="text-xs font-semibold text-secondary">主要投入</p>
                <p className="mt-1 text-lg font-semibold text-primary">{summary?.topProject?.name ?? '暂无'}</p>
                <p className="mt-1 text-xs text-secondary">{summary?.topProject ? minutesToHoursText(summary.topProject.minutes) : '近 30 天无记录'}</p>
              </div>
            </div>
          </section>
        </>
      ) : (
        <EmptyState title={isLoading ? '正在读取学习进度' : '暂无学习进度'} />
      )}
    </Page>
  );
}
