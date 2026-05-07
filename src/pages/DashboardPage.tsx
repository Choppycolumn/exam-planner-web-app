import { useState } from 'react';
import { BookOpen, CalendarCheck, ClipboardList, Plus, Target, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ChartBox, DistributionPie, TrendLine } from '../components/Charts';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { tasksRepository } from '../db/repositories/tasksRepository';
import { useAppData } from '../hooks/useAppData';
import type { TaskUrgency } from '../types/models';
import { calculateCountdownDays, getDueStatus, minutesToHoursText, previousDateISO, todayISO } from '../utils/date';
import {
  getDailyProjectDistribution,
  getDailyTotalMinutes,
  getLast7DaysTotals,
  getReviewAverageScore,
  getReviewTone,
  getSubjectExamStats,
  getVisibleShortTermTasks,
  urgencyClassName,
  urgencyLabel,
} from '../utils/statistics';

export function DashboardPage() {
  const { activeGoal, studyRecords, exams, reviews, shortTermTasks } = useAppData();
  const [taskDraft, setTaskDraft] = useState({ title: '', dueDate: todayISO(), urgency: 'medium' as TaskUrgency });
  const today = todayISO();
  const todayTotal = getDailyTotalMinutes(studyRecords, today);
  const distribution = getDailyProjectDistribution(studyRecords, today);
  const trend = getLast7DaysTotals(studyRecords);
  const latestExam = getSubjectExamStats(exams).latest;
  const todayReview = reviews.find((review) => review.date === today);
  const yesterdayDate = previousDateISO(today);
  const yesterdayReview = reviews.find((review) => review.date === yesterdayDate);
  const reviewScore = getReviewAverageScore(todayReview);
  const reviewTone = getReviewTone(reviewScore);
  const visibleTasks = getVisibleShortTermTasks(shortTermTasks, today);

  const saveTask = async () => {
    if (!taskDraft.title.trim()) return alert('请填写短期目标名称');
    await tasksRepository.save(taskDraft);
    setTaskDraft({ title: '', dueDate: todayISO(), urgency: 'medium' });
  };

  return (
    <Page title="早上好，今天继续稳稳推进" subtitle="第一眼看目标、看今天、看趋势。">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="当前长期目标"
          value={activeGoal ? `${calculateCountdownDays(activeGoal.deadline)} 天` : '未设置'}
          hint={activeGoal ? `距离「${activeGoal.name}」` : '请先创建并启用一个目标'}
          icon={<Target size={18} />}
        />
        <MetricCard label="今日总学习" value={minutesToHoursText(todayTotal)} hint={today} icon={<BookOpen size={18} />} />
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
      </div>

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

      <div className="mt-6 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <ChartBox title="今日时间分布">
          {distribution.length ? <DistributionPie data={distribution} /> : <EmptyState title="今天还没有填写学习时间" description="从学习时间页面录入后，这里会自动生成分布图。" />}
        </ChartBox>
        <ChartBox title="最近 7 天学习趋势">
          <TrendLine data={trend} />
        </ChartBox>
      </div>

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
