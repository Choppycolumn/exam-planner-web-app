import type { DailyReview, MockExamRecord, ShortTermTask, StudyTimeRecord, TaskUrgency } from '../types/models';
import { dateRangeEndingToday, todayISO } from './date';

export const getDailyTotalMinutes = (records: StudyTimeRecord[], date: string) =>
  records.filter((record) => record.date === date).reduce((sum, record) => sum + Number(record.minutes || 0), 0);

export const getDailyProjectDistribution = (records: StudyTimeRecord[], date: string) => {
  const totals = new Map<string, number>();
  records
    .filter((record) => record.date === date && record.minutes > 0)
    .forEach((record) => totals.set(record.projectNameSnapshot, (totals.get(record.projectNameSnapshot) ?? 0) + record.minutes));

  const dayTotal = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
  return Array.from(totals.entries()).map(([name, value]) => ({
    name,
    value,
    percent: dayTotal ? Math.round((value / dayTotal) * 100) : 0,
  }));
};

export const getLast7DaysTotals = (records: StudyTimeRecord[]) =>
  dateRangeEndingToday(7).map((date) => ({
    date: date.slice(5),
    minutes: getDailyTotalMinutes(records, date),
  }));

export const getLast30DaysProjectTotals = (records: StudyTimeRecord[]) => {
  const range = new Set(dateRangeEndingToday(30));
  const totals = new Map<string, number>();
  records
    .filter((record) => range.has(record.date))
    .forEach((record) => totals.set(record.projectNameSnapshot, (totals.get(record.projectNameSnapshot) ?? 0) + record.minutes));

  return Array.from(totals.entries())
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes);
};

export const getSubjectExamStats = (records: MockExamRecord[], subjectId?: number) => {
  const scoped = subjectId ? records.filter((record) => record.subjectId === subjectId) : records;
  if (!scoped.length) return { average: 0, highest: 0, lowest: 0, latest: undefined as MockExamRecord | undefined };
  const scores = scoped.map((record) => record.score);
  const latest = [...scoped].sort((a, b) => b.date.localeCompare(a.date))[0];
  return {
    average: Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10,
    highest: Math.max(...scores),
    lowest: Math.min(...scores),
    latest,
  };
};

export const getSubjectScoreTrend = (records: MockExamRecord[], subjectId?: number) =>
  records
    .filter((record) => !subjectId || record.subjectId === subjectId)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((record) => ({
      date: record.date.slice(5),
      score: record.score,
      subject: record.subjectNameSnapshot,
      paper: record.paperName,
    }));

export const getReviewAverageScore = (review?: DailyReview) => {
  if (!review) return 0;
  return Math.round(((review.statusScore + review.satisfactionScore) / 2) * 10) / 10;
};

export const getReviewTone = (score: number) => {
  if (score >= 4) return { label: '较好', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
  if (score <= 2) return { label: '较差', className: 'border-rose-200 bg-rose-50 text-rose-700' };
  return { label: '平稳', className: 'border-amber-200 bg-amber-50 text-amber-700' };
};

export const getReviewTrend = (reviews: DailyReview[], days = 30) => {
  const range = dateRangeEndingToday(days);
  return range.map((date) => {
    const review = reviews.find((item) => item.date === date);
    return {
      date: date.slice(5),
      statusScore: review?.statusScore ?? null,
      satisfactionScore: review?.satisfactionScore ?? null,
      averageScore: review ? getReviewAverageScore(review) : null,
    };
  });
};

const urgencyRank: Record<TaskUrgency, number> = { high: 3, medium: 2, low: 1 };

export const urgencyLabel: Record<TaskUrgency, string> = {
  high: '紧急',
  medium: '普通',
  low: '不急',
};

export const urgencyClassName: Record<TaskUrgency, string> = {
  high: 'border-rose-200 bg-rose-50 text-rose-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-slate-200 bg-slate-50 text-slate-600',
};

export const getVisibleShortTermTasks = (tasks: ShortTermTask[], currentDate = todayISO()) =>
  tasks
    .filter((task) => !task.isCompleted || task.completedAt?.slice(0, 10) === currentDate)
    .sort((a, b) => {
      const urgencyDiff = urgencyRank[b.urgency] - urgencyRank[a.urgency];
      if (urgencyDiff) return urgencyDiff;
      return a.dueDate.localeCompare(b.dueDate);
    });
