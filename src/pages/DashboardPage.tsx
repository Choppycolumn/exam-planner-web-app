import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, BookOpen, CalendarCheck, ClipboardList, Hourglass, Plus, Target, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { serverApi } from '../api/client';
import { queryKeys } from '../api/queryClient';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { WaterIntakeCard } from '../components/WaterIntakeCard';
import { tasksRepository } from '../db/repositories/tasksRepository';
import { useDashboardData } from '../hooks/useDashboardData';
import type { TaskUrgency } from '../types/models';
import { calculateCountdownDays, getDueStatus, minutesToHoursText, todayISO } from '../utils/date';
import {
  getReviewAverageScore,
  getReviewTone,
  urgencyClassName,
  urgencyLabel,
} from '../utils/statistics';
import { routeLoaders } from '../router/preload';

const LazyDashboardCharts = lazy(() => routeLoaders.dashboardCharts().then((module) => ({ default: module.DashboardCharts })));

function getTimeGreeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  if (hour < 22) return '晚上好';
  return '夜深了';
}

function marketToneClass(value?: number | null) {
  if (typeof value !== 'number') return 'text-slate-500';
  return value >= 0 ? 'text-emerald-600' : 'text-rose-600';
}

function formatMarketChange(value?: number | null) {
  return typeof value === 'number' ? `${value}%` : '--';
}

function formatMarketPrice(value?: number, currency?: string) {
  if (typeof value !== 'number') return '--';
  return `${value}${currency ? ` ${currency}` : ''}`;
}

export function DashboardPage() {
  const { activeGoal, todayTotal, totalStudyMinutes, studyTargetMinutes, latestExam, todayReview, yesterdayReview, visibleTasks, todayWaterRecord, todayBrief, readOnly } = useDashboardData();
  const [taskDraft, setTaskDraft] = useState({ title: '', dueDate: todayISO(), urgency: 'medium' as TaskUrgency });
  const [chartsReady, setChartsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [briefAcknowledged, setBriefAcknowledged] = useState(false);
  const { data: dashboardCharts = { today: todayISO(), distribution: [], trend: [] } } = useQuery({
    queryKey: queryKeys.dashboardCharts,
    queryFn: serverApi.getDashboardCharts,
    enabled: chartsReady,
    placeholderData: { today: todayISO(), distribution: [], trend: [] },
  });
  const today = todayISO();
  const greeting = getTimeGreeting(currentTime);
  const reviewScore = getReviewAverageScore(todayReview ?? undefined);
  const reviewTone = getReviewTone(reviewScore);
  const waterCardKey = todayWaterRecord ? `${todayWaterRecord.date}-${todayWaterRecord.updatedAt ?? ''}-${todayWaterRecord.cups}` : today;
  const briefAckKey = todayBrief ? `examPlanner.dashboardBriefAck.${todayBrief.id}.${todayBrief.generatedAt}` : '';
  const briefMarkets = todayBrief?.payload.markets ?? [];
  const successfulMarkets = briefMarkets.filter((item) => item.ok).slice(0, 4);
  const showBriefCard = !todayBrief || !briefAcknowledged;
  const goalDaysLeft = activeGoal ? Math.max(1, calculateCountdownDays(activeGoal.deadline)) : 0;
  const remainingStudyMinutes = Math.max(0, studyTargetMinutes - totalStudyMinutes);
  const dailyRequiredMinutes = goalDaysLeft ? Math.ceil(remainingStudyMinutes / goalDaysLeft) : 0;
  const studyTargetHint = !studyTargetMinutes
    ? '在设置页填写目标总时长'
    : remainingStudyMinutes <= 0
      ? '已达到目标时长'
      : activeGoal
        ? `距目标还差 ${minutesToHoursText(remainingStudyMinutes)}，每天约 ${minutesToHoursText(dailyRequiredMinutes)}`
        : `距目标还差 ${minutesToHoursText(remainingStudyMinutes)}，请先设置长期目标`;

  const saveTask = async () => {
    if (!taskDraft.title.trim()) return alert('请填写短期目标名称');
    await tasksRepository.save(taskDraft);
    setTaskDraft({ title: '', dueDate: todayISO(), urgency: 'medium' });
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setChartsReady(true), 250);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentTime(new Date()), 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    setBriefAcknowledged(Boolean(briefAckKey && localStorage.getItem(briefAckKey)));
  }, [briefAckKey]);

  const acknowledgeBrief = () => {
    if (!briefAckKey) return;
    localStorage.setItem(briefAckKey, new Date().toISOString());
    setBriefAcknowledged(true);
  };

  return (
    <Page title={`${greeting}，今天继续稳稳推进`} subtitle="第一眼看目标、看今天、看趋势。">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          label="当前长期目标"
          value={activeGoal ? `${calculateCountdownDays(activeGoal.deadline)} 天` : '未设置'}
          hint={activeGoal ? `距离「${activeGoal.name}」` : '请先创建并启用一个目标'}
          icon={<Target size={18} />}
        />
        <MetricCard label="今日总学习" value={minutesToHoursText(todayTotal)} hint={today} icon={<BookOpen size={18} />} />
        <MetricCard
          label="目前学习总时长"
          value={minutesToHoursText(totalStudyMinutes)}
          hint={studyTargetHint}
          icon={<Hourglass size={18} />}
        />
        <Link className={`card block border p-5 ${todayReview ? reviewTone.className : 'border-slate-200 bg-white text-slate-700'}`} to="/reviews">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium opacity-80">今日复盘</p>
              <p className="mt-2 text-2xl font-semibold">{todayReview ? `已复盘 ${reviewScore} 分` : '去填写'}</p>
              <p className="mt-2 text-sm opacity-80">{todayReview ? `今日状态：${reviewTone.label}` : '当天只保留一条主复盘'}</p>
            </div>
            <div className="rounded-lg bg-white/70 p-2"><CalendarCheck size={18} /></div>
          </div>
        </Link>
        <MetricCard
          label="最近模考"
          value={latestExam ? `${latestExam.subjectNameSnapshot} ${latestExam.score}/${latestExam.fullScore}` : '暂无'}
          hint={latestExam ? latestExam.paperName : '记录一次模考后显示'}
          icon={<ClipboardList size={18} />}
        />
        <WaterIntakeCard key={waterCardKey} record={todayWaterRecord ?? undefined} readOnly={readOnly} />
      </div>

      {showBriefCard ? (
        <section className="mt-6 rounded-xl border border-blue-100 bg-blue-50/70 p-5 transition hover:-translate-y-0.5 hover:shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-blue-700"><Bell size={16} />今日晨间简报</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">
                {todayBrief ? todayBrief.title : '还没有生成今日简报'}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {todayBrief?.payload.weather?.ok
                  ? `${todayBrief.payload.weather.cityName} ${todayBrief.payload.weather.condition} ${todayBrief.payload.weather.temperature}℃；指数 ${briefMarkets.length} 项。`
                  : '点击进入通知中心，生成天气、指数涨跌和学习提醒。'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="rounded-lg border border-blue-200 bg-white/80 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-white" to="/notifications">
                {todayBrief?.emailedAt ? '已邮件推送' : '查看简报'}
              </Link>
              {todayBrief ? (
                <button className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white" onClick={acknowledgeBrief}>
                  我已知晓
                </button>
              ) : null}
            </div>
          </div>
          {todayBrief && briefMarkets.length ? (
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {successfulMarkets.length ? successfulMarkets.map((item) => (
                <div key={`${item.name}-${item.symbol}`} className="rounded-lg border border-blue-100 bg-white/80 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">{item.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{item.symbol}</p>
                    </div>
                    <p className={`text-sm font-semibold ${marketToneClass(item.changePercent)}`}>{formatMarketChange(item.changePercent)}</p>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{formatMarketPrice(item.price, item.currency)}</p>
                </div>
              )) : (
                <div className="rounded-lg border border-blue-100 bg-white/80 px-3 py-2 text-sm text-slate-500">指数暂时获取失败，可进入通知中心查看详情。</div>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {yesterdayReview?.tomorrowPlan?.trim() ? (
        <div className="mt-6 card border-blue-100 bg-blue-50/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-blue-700">昨日写给今天的计划</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">今天优先照着这份计划推进</h2>
            </div>
            <Link className="btn btn-soft" to="/reviews">去复盘页</Link>
          </div>
          <p className="mt-4 whitespace-pre-wrap rounded-lg border border-blue-100 bg-white/80 p-4 text-sm leading-7 text-slate-700">{yesterdayReview.tomorrowPlan}</p>
        </div>
      ) : null}

      <div className="mt-6 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">短期目标</h2>
            <p className="mt-1 text-sm text-slate-500">按紧急程度排序，完成后当天保留横线，第二天从首页隐藏。</p>
          </div>
          <div className="grid w-full gap-2 md:w-auto md:grid-cols-[220px_150px_130px_auto]">
            <input className="field" placeholder="目标名称" value={taskDraft.title} onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })} />
            <input className="field" type="date" value={taskDraft.dueDate} onChange={(event) => setTaskDraft({ ...taskDraft, dueDate: event.target.value })} />
            <select className="field" value={taskDraft.urgency} onChange={(event) => setTaskDraft({ ...taskDraft, urgency: event.target.value as TaskUrgency })}>
              <option value="high">紧急</option>
              <option value="medium">普通</option>
              <option value="low">不急</option>
            </select>
            <button className="btn btn-primary" onClick={saveTask}><Plus size={16} />添加</button>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {visibleTasks.length ? visibleTasks.map((task) => {
            const dueStatus = getDueStatus(task.dueDate);
            return (
              <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <label className="flex min-w-0 flex-1 items-center gap-3">
                  <input type="checkbox" checked={task.isCompleted} onChange={(event) => tasksRepository.toggleComplete(task, event.target.checked)} />
                  <span className={`truncate font-medium ${task.isCompleted ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{task.title}</span>
                </label>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`rounded border px-2 py-1 ${urgencyClassName[task.urgency]}`}>{urgencyLabel[task.urgency]}</span>
                  <span className={`rounded border px-2 py-1 font-semibold ${dueStatus.className}`}>{dueStatus.label}</span>
                  <span className="text-slate-500">到期：{task.dueDate}</span>
                  <button className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => task.id && confirm('确定删除这个短期目标吗？') && tasksRepository.remove(task.id)}><Trash2 size={16} /></button>
                </div>
              </div>
            );
          }) : <EmptyState title="还没有短期目标" description="添加今天或近期要完成的小目标。" />}
        </div>
      </div>

      {chartsReady ? (
        <Suspense fallback={<div className="mt-6 grid gap-4 lg:grid-cols-2"><div className="card h-72 p-5 text-sm text-slate-500">图表加载中...</div><div className="card h-72 p-5 text-sm text-slate-500">图表加载中...</div></div>}>
          <LazyDashboardCharts distribution={dashboardCharts.distribution} trend={dashboardCharts.trend} />
        </Suspense>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Link className="card block p-5 transition hover:-translate-y-0.5 hover:shadow-lg" to="/study-time">
          <p className="text-sm font-semibold text-blue-700">今日学习时间填写入口</p>
          <p className="mt-2 text-slate-600">按项目记录分钟数和备注，保存后自动进入统计。</p>
        </Link>
        <Link className="card block p-5 transition hover:-translate-y-0.5 hover:shadow-lg" to="/settings">
          <p className="text-sm font-semibold text-blue-700">长期目标管理</p>
          <p className="mt-2 text-slate-600">在设置页管理考研目标、分数目标和截止日期。</p>
        </Link>
      </div>
    </Page>
  );
}
