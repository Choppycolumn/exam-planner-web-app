import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardCheck, Flag, Settings, Target, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Page } from '../components/Page';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { serverApi } from '../api/client';
import { queryKeys } from '../api/queryClient';
import { useDashboardData } from '../hooks/useDashboardData';
import { calculateCountdownDays, minutesToHoursText } from '../utils/date';

function statusTone(value: number) {
  if (value >= 80) return 'border-success bg-success-soft text-success';
  if (value >= 55) return 'border-accent bg-accent-soft text-accent';
  if (value >= 35) return 'border-warning bg-warning-soft text-warning';
  return 'border-danger bg-danger-soft text-danger';
}

export function GoalReviewPage() {
  const { activeGoal, totalStudyMinutes, studyTargetMinutes, visibleTasks, todayReview, yesterdayReview } = useDashboardData();
  const { data: reportsData } = useQuery({
    queryKey: queryKeys.reports,
    queryFn: serverApi.getReports,
    placeholderData: { reports: [] },
  });
  const { data: progressData } = useQuery({
    queryKey: queryKeys.projectProgress,
    queryFn: serverApi.getProjectProgress,
  });

  const latestReport = reportsData?.reports[0] ?? null;
  const topProject = progressData?.totals.topProject ?? latestReport?.summary.topProject ?? null;
  const activeProjects = progressData?.items.filter((item) => item.isActive) ?? [];
  const slowingProjects = activeProjects.filter((item) => item.momentum === 'down').slice(0, 4);
  const urgentTasks = visibleTasks.filter((task) => !task.isCompleted).slice(0, 6);
  const progressPercent = studyTargetMinutes ? Math.min(100, Math.round((totalStudyMinutes / studyTargetMinutes) * 100)) : 0;
  const daysLeft = activeGoal ? calculateCountdownDays(activeGoal.deadline) : 0;
  const reviewQuestions = [
    activeGoal ? `距离「${activeGoal.name}」还有 ${daysLeft} 天，本周最小推进动作是什么？` : '本周是否需要先创建并启用一个长期目标？',
    topProject ? `最近投入最高的是「${topProject.name}」，它是否仍然是当前最重要的方向？` : '最近 30 天还没有清晰的主项目，是否需要重新安排学习块？',
    slowingProjects.length ? `这些项目动量放缓：${slowingProjects.map((item) => item.name).join('、')}。要暂停、降级还是恢复？` : '当前项目动量没有明显下滑，哪些动作值得固定下来？',
    urgentTasks.length ? `仍有 ${urgentTasks.length} 个短期任务未闭环，哪些可以今天完成？` : '短期任务压力较低，可以安排一个复盘或预习动作。',
  ];

  return (
    <Page title="目标复盘系统" subtitle="把长期目标、周/月报、项目动量和短期任务合在一起做校准。">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="长期目标" value={activeGoal ? `${daysLeft} 天` : '未设置'} hint={activeGoal?.name ?? '先在目标页启用一个目标'} icon={<Target size={20} />} />
        <MetricCard label="总进度" value={`${progressPercent}%`} hint={studyTargetMinutes ? `${minutesToHoursText(totalStudyMinutes)} / ${minutesToHoursText(studyTargetMinutes)}` : '尚未设置目标总时长'} icon={<Flag size={20} />} />
        <MetricCard label="最近主项目" value={topProject?.name ?? '暂无'} hint={topProject ? minutesToHoursText(topProject.minutes) : '等待更多记录'} icon={<TrendingUp size={20} />} />
        <MetricCard label="待闭环任务" value={`${urgentTasks.length} 项`} hint={todayReview ? '今日已复盘' : yesterdayReview?.tomorrowPlan ? '可接昨天计划' : '建议今日复盘'} icon={<ClipboardCheck size={20} />} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_0.9fr]">
        <section className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-primary">本轮复盘问题</h2>
              <p className="mt-1 text-sm text-secondary">每周打开一次，把这些问题回答到日报或报告里。</p>
            </div>
            <Link className="btn btn-primary" to="/settings"><Settings size={16} />简报设置</Link>
          </div>
          <div className="mt-4 space-y-3">
            {reviewQuestions.map((question, index) => (
              <div key={question} className="rounded-lg border border-line bg-surface-muted p-4">
                <p className="text-xs font-semibold text-accent">Q{index + 1}</p>
                <p className="mt-1 text-sm font-semibold leading-6 text-strong">{question}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-semibold text-primary">校准结论草稿</h2>
          <div className="mt-4 space-y-3">
            <div className={`rounded-lg border p-4 ${statusTone(progressPercent)}`}>
              <p className="text-sm font-semibold">长期进度：{progressPercent}%</p>
              <p className="mt-1 text-xs leading-5 opacity-80">{studyTargetMinutes ? '按总学习目标估算，适合每周复盘一次偏差。' : '先补齐目标总时长，进度判断会更有意义。'}</p>
            </div>
            {latestReport ? (
              <div className="rounded-lg border border-accent bg-accent-soft p-4 text-accent">
                <p className="text-sm font-semibold">最近报告：{latestReport.title}</p>
                <p className="mt-1 text-xs leading-5 opacity-80">学习 {minutesToHoursText(latestReport.summary.totalMinutes)}，复盘 {latestReport.summary.reviewCount} 篇，任务完成率 {latestReport.summary.taskCompletionRate ?? '暂无'}%。</p>
              </div>
            ) : <EmptyState title="暂无报告" description="生成周报或月报后，这里会显示最近一次复盘结论。" />}
          </div>
        </section>
      </div>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-base font-semibold text-primary">待推进任务</h2>
          <div className="mt-3 space-y-2">
            {urgentTasks.length ? urgentTasks.map((task) => (
              <Link key={task.id} to="/task-center" className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-strong px-3 py-2 text-sm text-strong">
                <span className="min-w-0 truncate font-semibold">{task.title}</span>
                <ArrowRight size={15} className="shrink-0 text-tertiary" />
              </Link>
            )) : <EmptyState title="没有明显待闭环任务" />}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="text-base font-semibold text-primary">项目动量</h2>
          <div className="mt-3 space-y-2">
            {activeProjects.slice(0, 8).map((item) => (
              <div key={item.id} className="rounded-lg border border-line bg-surface-strong px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-strong">{item.name}</p>
                  <span className="text-xs text-secondary">{item.momentum === 'up' ? '升温' : item.momentum === 'down' ? '放缓' : '平稳'}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-inset">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, item.sharePercent)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </Page>
  );
}
