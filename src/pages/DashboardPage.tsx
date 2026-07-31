import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Bell, BookOpen, CalendarCheck, CheckCircle2, ClipboardList, CloudSun, Coffee, Hourglass, PenLine, PlayCircle, Plus, Target, TimerReset, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { serverApi } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
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
import { useAccountSession } from '../hooks/useAccountSession';

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

function formatWeatherRange(min?: number, max?: number) {
  if (typeof min !== 'number' || typeof max !== 'number') return '--';
  return `${min}-${max}℃`;
}

function toneClass(tone?: string) {
  if (tone === 'rose') return 'border-rose-100 bg-rose-50 text-rose-700';
  if (tone === 'amber') return 'border-amber-100 bg-amber-50 text-amber-700';
  if (tone === 'blue') return 'border-blue-100 bg-blue-50 text-blue-700';
  if (tone === 'emerald') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function activityCellClass(minutes: number) {
  if (minutes >= 360) return 'bg-emerald-600';
  if (minutes >= 240) return 'bg-emerald-500';
  if (minutes >= 120) return 'bg-blue-400';
  if (minutes > 0) return 'bg-amber-300';
  return 'bg-slate-100';
}

export function DashboardPage() {
  const { data: session } = useAccountSession();
  const isLearner = session?.accountType === 'learner';
  const {
    activeGoal,
    todayTotal,
    totalStudyMinutes,
    studyTargetMinutes,
    latestExam,
    todayReview,
    yesterdayReview,
    visibleTasks,
    todayWaterRecord,
    todayBrief,
    englishWritingPlan,
    startupPlan,
    reminders = [],
    activityCalendar = [],
    errorThemeWall = [],
    breakGuard,
    readOnly,
  } = useDashboardData();
  const [taskDraft, setTaskDraft] = useState({ title: '', dueDate: todayISO(), dueTime: '', urgency: 'medium' as TaskUrgency });
  const [inboxText, setInboxText] = useState('');
  const [startPanelOpen, setStartPanelOpen] = useState(false);
  const [chartsReady, setChartsReady] = useState(
    () => typeof window !== 'undefined' && !('IntersectionObserver' in window),
  );
  const chartsAnchorRef = useRef<HTMLDivElement | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const { data: dashboardCharts = { today: todayISO(), distribution: [], trend: [] } } = useQuery({
    queryKey: queryKeys.dashboardCharts,
    queryFn: serverApi.getDashboardCharts,
    enabled: chartsReady,
    placeholderData: { today: todayISO(), distribution: [], trend: [] },
  });
  const { data: inboxData = { items: [], readOnly: false } } = useQuery({
    queryKey: queryKeys.problemInbox('open'),
    queryFn: () => serverApi.getProblemInbox('open', 6),
    placeholderData: { items: [], readOnly: false },
  });
  const { data: notificationCenter = { metrics: { total: 0, open: 0, warnings: 0, critical: 0 }, events: [] } } = useQuery({
    queryKey: queryKeys.notifications('all'),
    queryFn: () => serverApi.getNotificationCenter('all'),
    enabled: Boolean(session) && !isLearner,
    placeholderData: { generatedAt: '', channels: [], events: [], deliveries: [], metrics: { total: 0, open: 0, warnings: 0, critical: 0 }, channelPlan: {} },
  });
  const today = todayISO();
  const greeting = getTimeGreeting(currentTime);
  const reviewScore = getReviewAverageScore(todayReview ?? undefined);
  const reviewTone = getReviewTone(reviewScore);
  const waterCardKey = todayWaterRecord ? `${todayWaterRecord.date}-${todayWaterRecord.updatedAt ?? ''}-${todayWaterRecord.cups}` : today;
  const briefWeather = todayBrief?.payload.weather;
  const briefMarkets = todayBrief?.payload.markets ?? [];
  const successfulMarkets = briefMarkets.filter((item) => item.ok).slice(0, 4);
  const showEnglishWritingPlan = Boolean(englishWritingPlan?.enabled && englishWritingPlan.showOnDashboard);
  const showBriefCard = !isLearner;
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
    await tasksRepository.save({ ...taskDraft, reminderEnabled: Boolean(taskDraft.dueTime) });
    setTaskDraft({ title: '', dueDate: todayISO(), dueTime: '', urgency: 'medium' });
  };

  const refreshInbox = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.problemInbox('open') }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard }),
    ]);
  };

  const addInboxItem = async () => {
    if (readOnly || !inboxText.trim()) return;
    await serverApi.saveProblemInbox(inboxText.trim(), today);
    setInboxText('');
    await refreshInbox();
  };

  const resolveInboxItem = async (id: number) => {
    if (readOnly) return;
    await serverApi.setProblemInboxStatus(id, 'resolved');
    await refreshInbox();
  };

  const removeInboxItem = async (id: number) => {
    if (readOnly || !confirm('确定删除这条问题记录吗？')) return;
    await serverApi.removeProblemInbox(id);
    await refreshInbox();
  };

  useEffect(() => {
    const anchor = chartsAnchorRef.current;
    if (!anchor) return undefined;
    if (!('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setChartsReady(true);
      observer.disconnect();
    }, { rootMargin: '360px 0px' });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setCurrentTime(new Date()), 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, []);

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

      <section className={`mt-6 grid gap-4 md:grid-cols-2 ${isLearner ? '' : 'xl:grid-cols-4'}`}>
        <Link className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-blue-700 transition hover:bg-blue-100" to="/goal-review">
          <p className="flex items-center gap-2 text-sm font-semibold"><Target size={16} />目标复盘</p>
          <p className="mt-2 text-xs leading-5 opacity-80">把长期目标、项目动量和最近报告汇总校准。</p>
        </Link>
        <Link className="rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-emerald-700 transition hover:bg-emerald-100" to="/progress">
          <p className="flex items-center gap-2 text-sm font-semibold"><CalendarCheck size={16} />阶段进度</p>
          <p className="mt-2 text-xs leading-5 opacity-80">查看学习、复盘、任务和目标推进节奏。</p>
        </Link>
        {!isLearner ? <Link className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-amber-700 transition hover:bg-amber-100" to="/settings">
          <p className="flex items-center gap-2 text-sm font-semibold"><Bell size={16} />最近通知 {notificationCenter.metrics.open}</p>
          <p className="mt-2 text-xs leading-5 opacity-80">{notificationCenter.metrics.warnings || notificationCenter.metrics.critical ? '存在需要关注的系统预警。' : '日报、报告和系统事件仍会保留在后台。'}</p>
        </Link> : null}
        {!isLearner ? <div className={`rounded-lg border p-4 ${breakGuard?.unfocusedCount ? 'border-rose-100 bg-rose-50 text-rose-700' : 'border-sky-100 bg-sky-50 text-sky-700'}`}>
          <p className="flex items-center gap-2 text-sm font-semibold"><TimerReset size={16} />休息守护</p>
          <p className="mt-2 text-xs leading-5 opacity-80">
            今日休息 {breakGuard?.breakCount ?? 0} 次，不专注 {breakGuard?.unfocusedCount ?? 0} 次
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs opacity-80"><Coffee size={13} />午饭 {breakGuard?.lunchCount ?? 0} / 晚饭 {breakGuard?.dinnerCount ?? 0}</p>
        </div> : null}
      </section>

      {showEnglishWritingPlan ? (
        <section className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50/70 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-indigo-700"><PenLine size={16} />英语写作计划</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">
                {englishWritingPlan?.currentStage?.name ?? '当前阶段未设置'}
                {englishWritingPlan?.currentStage?.weeks ? <span className="ml-2 text-sm font-medium text-slate-500">{englishWritingPlan.currentStage.weeks}</span> : null}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{englishWritingPlan?.currentStage?.focus || '在设置页维护阶段重点后，这里会自动显示。'}</p>
            </div>
            <Link className="btn btn-soft" to="/settings">编辑计划</Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr]">
            <div className="rounded-lg border border-indigo-100 bg-white/80 px-3 py-2">
              <p className="text-xs font-semibold text-slate-500">建议用时</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{englishWritingPlan?.dailyMinutes || '20-25 分钟'}</p>
            </div>
            <div className="rounded-lg border border-indigo-100 bg-white/80 px-3 py-2">
              <p className="text-xs font-semibold text-slate-500">{englishWritingPlan?.weekdayLabel || '今日'}任务</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-900">{englishWritingPlan?.todayTask || '今天没有设置固定写作任务。'}</p>
            </div>
          </div>
        </section>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-blue-700">今日启动</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-950">{startupPlan?.firstSession ?? '先开始一个 25 分钟低阻力学习块'}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{startupPlan?.stage.hint ?? '打开主页后先确认今天最小推进动作。'}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-lg border px-3 py-2 text-sm font-semibold ${toneClass(startupPlan?.stage.tone)}`}>
                {startupPlan?.stage.label ?? '未设定阶段'}
              </span>
              <button className="btn btn-primary" type="button" onClick={() => setStartPanelOpen((open) => !open)}>
                <PlayCircle size={16} />{startPanelOpen ? '收起开工清单' : '开始今天'}
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">优先目标</p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-800">{startupPlan?.primaryTask?.title ?? '暂无待办短期目标'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">今日均摊目标</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{minutesToHoursText(startupPlan?.dailyTargetMinutes ?? dailyRequiredMinutes)}</p>
            </div>
            <Link className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm font-semibold text-blue-700 transition hover:bg-blue-100" to="/study-time">
              开始记录学习时间
            </Link>
          </div>
          {startPanelOpen ? (
            <div className="mt-4 grid gap-3 rounded-lg border border-blue-100 bg-blue-50/70 p-4 md:grid-cols-[1fr_1fr]">
              <div>
                <p className="text-sm font-semibold text-blue-800">开工三步</p>
                <div className="mt-3 space-y-2">
                  {(startupPlan?.checklist?.length ? startupPlan.checklist : ['确认今天最小任务', '开始一个学习块', '睡前复盘']).map((item) => (
                    <div key={item} className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2 text-sm text-slate-700">
                      <CheckCircle2 size={15} className="text-blue-600" />{item}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-800">今日注意</p>
                <div className="mt-3 space-y-2">
                  {reminders.slice(0, 3).map((item) => (
                    <div key={item.id} className={`rounded-lg border px-3 py-2 text-sm ${toneClass(item.tone)}`}>
                      <p className="font-semibold">{item.title}</p>
                      <p className="mt-1 text-xs opacity-80">{item.detail}</p>
                    </div>
                  ))}
                  {!reminders.length ? <p className="rounded-lg bg-white/80 px-3 py-2 text-sm text-slate-500">今天没有明显积压项。</p> : null}
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="card p-5">
          <div className="flex items-center gap-2">
            <AlertCircle size={17} className="text-amber-600" />
            <h2 className="text-base font-semibold text-slate-900">提醒中心</h2>
          </div>
          <div className="mt-3 space-y-2">
            {reminders.length ? reminders.map((item) => (
              <div key={item.id} className={`rounded-lg border px-3 py-2 ${toneClass(item.tone)}`}>
                <p className="text-sm font-semibold">{item.title}</p>
                <p className="mt-1 text-xs opacity-80">{item.detail}</p>
              </div>
            )) : (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
                今天没有明显积压项，保持节奏就好。
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">问题 Inbox</h2>
              <p className="mt-1 text-sm text-slate-500">随手记今天暴露的问题，夜间会进入错误主题库分析。</p>
            </div>
            <Link className="text-sm font-semibold text-blue-700" to="/review-insights">查看主题库</Link>
          </div>
          <div className="mt-4 flex gap-2">
            <input
              className="field"
              placeholder="例如：英语阅读定位太慢 / 高数计划没执行"
              value={inboxText}
              onChange={(event) => setInboxText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addInboxItem();
              }}
              disabled={readOnly}
            />
            <button className="btn btn-primary shrink-0" disabled={readOnly || !inboxText.trim()} onClick={() => void addInboxItem()}>
              <Plus size={16} />加入
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {inboxData.items.length ? inboxData.items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-slate-800">{item.text}</p>
                  <p className="mt-1 text-xs text-slate-400">{item.date}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button className="rounded p-1 text-emerald-600 hover:bg-emerald-50" title="标记已处理" onClick={() => void resolveInboxItem(item.id)} disabled={readOnly}>
                    <CheckCircle2 size={16} />
                  </button>
                  <button className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" title="删除" onClick={() => void removeInboxItem(item.id)} disabled={readOnly}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )) : (
              <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">暂时没有待处理问题。</p>
            )}
          </div>
        </section>

        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">学习连续性</h2>
              <p className="mt-1 text-sm text-slate-500">最近 12 周学习、复盘、喝水和短期目标完成情况。</p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-3 w-3 rounded bg-slate-100" />空白
              <span className="h-3 w-3 rounded bg-amber-300" />启动
              <span className="h-3 w-3 rounded bg-blue-400" />稳定
              <span className="h-3 w-3 rounded bg-emerald-600" />高强度
            </div>
          </div>
          <div className="mt-4 grid gap-1" style={{ gridTemplateColumns: 'repeat(21, minmax(0, 1fr))' }}>
            {activityCalendar.map((day) => (
              <div
                key={day.date}
                className={`h-4 rounded ${activityCellClass(day.minutes)} ring-1 ring-white`}
                title={`${day.date} 学习 ${minutesToHoursText(day.minutes)}；复盘 ${day.hasReview ? `${day.reviewScore} 分` : '无'}；喝水 ${day.waterCups}/${day.waterTargetCups}；任务 ${day.taskCompleted}/${day.taskTotal}`}
              />
            ))}
          </div>
        </section>
      </div>

      <section className="mt-6 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">高频问题墙</h2>
            <p className="mt-1 text-sm text-slate-500">来自错误主题库的高频错因，越大代表最近出现越多。</p>
          </div>
          <Link className="text-sm font-semibold text-blue-700" to="/review-insights">打开错因分析</Link>
        </div>
        {errorThemeWall.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {errorThemeWall.map((item) => {
              const size = Math.min(22, 12 + item.occurrenceCount * 1.4);
              return (
                <span
                  key={item.id}
                  className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 font-semibold text-rose-700"
                  style={{ fontSize: `${size}px` }}
                  title={`${item.reviewDayCount} 天 / ${item.occurrenceCount} 条；最近 ${item.lastSeenAt}`}
                >
                  {item.label}
                </span>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">暂无高频问题，夜间预计算后会自动显示。</p>
        )}
      </section>

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
                  : '可在设置里生成天气、指数涨跌和学习提醒。'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="rounded-lg border border-blue-200 bg-white/80 px-3 py-2 text-sm font-semibold text-blue-700 transition hover:bg-white" to="/settings">
                {todayBrief?.emailedAt ? '已邮件推送' : '简报设置'}
              </Link>
            </div>
          </div>
          {todayBrief ? (
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-lg border border-blue-100 bg-white/80 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{briefWeather?.cityName || '天气'}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{briefWeather?.ok ? briefWeather.condition : briefWeather?.error || '暂未获取'}</p>
                  </div>
                  <CloudSun className="text-blue-600" size={18} />
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  {briefWeather?.ok
                    ? `${briefWeather.temperature}℃ · ${formatWeatherRange(briefWeather.minTemperature, briefWeather.maxTemperature)} · 降水 ${briefWeather.precipitationProbability ?? 0}%`
                    : '天气稍后再看'}
                </p>
              </div>
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
                <div className="rounded-lg border border-blue-100 bg-white/80 px-3 py-2 text-sm text-slate-500">指数暂时获取失败，可在设置里重新生成简报。</div>
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
          <div className="grid w-full gap-2 md:w-auto md:grid-cols-[220px_150px_120px_130px_auto]">
            <input className="field" placeholder="目标名称" value={taskDraft.title} onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })} />
            <input className="field" type="date" value={taskDraft.dueDate} onChange={(event) => setTaskDraft({ ...taskDraft, dueDate: event.target.value })} />
            <input className="field" type="time" value={taskDraft.dueTime} onChange={(event) => setTaskDraft({ ...taskDraft, dueTime: event.target.value })} />
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
                  <span className="text-slate-500">到期：{task.dueTime ? `${task.dueDate} ${task.dueTime}` : task.dueDate}</span>
                  <button className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => task.id && confirm('确定删除这个短期目标吗？') && tasksRepository.remove(task.id)}><Trash2 size={16} /></button>
                </div>
              </div>
            );
          }) : <EmptyState title="还没有短期目标" description="添加今天或近期要完成的小目标。" />}
        </div>
      </div>

      <div ref={chartsAnchorRef} className="min-h-1">
        {chartsReady ? (
          <Suspense fallback={<div className="mt-6 grid gap-4 lg:grid-cols-2"><div className="card h-72 p-5 text-sm text-slate-500">图表加载中...</div><div className="card h-72 p-5 text-sm text-slate-500">图表加载中...</div></div>}>
            <LazyDashboardCharts distribution={dashboardCharts.distribution} trend={dashboardCharts.trend} />
          </Suspense>
        ) : null}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Link className="card block p-5 transition hover:-translate-y-0.5 hover:shadow-lg" to="/study-time">
          <p className="text-sm font-semibold text-blue-700">今日学习时间填写入口</p>
          <p className="mt-2 text-slate-600">按项目记录分钟数和备注，保存后自动进入统计。</p>
        </Link>
        <Link className="card block p-5 transition hover:-translate-y-0.5 hover:shadow-lg" to="/goals">
          <p className="text-sm font-semibold text-blue-700">长期目标管理</p>
          <p className="mt-2 text-slate-600">管理考研目标、分数目标和截止日期。</p>
        </Link>
      </div>
    </Page>
  );
}
