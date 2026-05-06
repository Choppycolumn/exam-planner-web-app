/* eslint-disable react-hooks/set-state-in-effect -- Selected-date form state intentionally mirrors the local DB record. */
import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { reviewsRepository } from '../db/repositories/reviewsRepository';
import { useAppData } from '../hooks/useAppData';
import { previousDateISO, todayISO } from '../utils/date';
import { getReviewAverageScore, getReviewTone } from '../utils/statistics';

export function ReviewsPage() {
  const { reviews } = useAppData();
  const [date, setDate] = useState(todayISO());
  const current = useMemo(() => reviews.find((review) => review.date === date), [reviews, date]);
  const yesterdayDate = previousDateISO(date);
  const yesterdayReview = useMemo(() => reviews.find((review) => review.date === yesterdayDate), [reviews, yesterdayDate]);
  const [draft, setDraft] = useState({ summary: '', wins: '', problems: '', tomorrowPlan: '', score: 6 });
  const [toast, setToast] = useState('');
  const yesterdayAverageScore = getReviewAverageScore(yesterdayReview);
  const scoreDiff = yesterdayReview ? Math.round((draft.score - yesterdayAverageScore) * 10) / 10 : 0;
  const yesterdayTone = getReviewTone(yesterdayAverageScore);

  useEffect(() => {
    setDraft({
      summary: current?.summary ?? '',
      wins: current?.wins ?? '',
      problems: current?.problems ?? '',
      tomorrowPlan: current?.tomorrowPlan ?? '',
      score: getReviewAverageScore(current) || 6,
    });
  }, [current]);

  const save = async () => {
    if (!draft.summary.trim()) return alert('请至少填写今日总结');
    await reviewsRepository.upsert({ date, ...draft });
    setToast(current ? '复盘已更新' : '复盘已保存');
    setTimeout(() => setToast(''), 1800);
  };

  return (
    <Page title="每日复盘" subtitle="每天一条主复盘，回看时不会散。">
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="card p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <label><span className="label">复盘日期</span><input className="field w-52" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <span className="rounded bg-slate-100 px-3 py-2 text-sm text-slate-600">{current ? '编辑已有复盘' : '新建当天复盘'}</span>
          </div>
          <div className="grid gap-4">
            <label><span className="label">今日总结 *</span><textarea className="field min-h-28" value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} /></label>
            <label><span className="label">完成得好的地方</span><textarea className="field min-h-24" value={draft.wins} onChange={(e) => setDraft({ ...draft, wins: e.target.value })} /></label>
            <label><span className="label">今日问题</span><textarea className="field min-h-24" value={draft.problems} onChange={(e) => setDraft({ ...draft, problems: e.target.value })} /></label>
            <label><span className="label">明日改进计划</span><textarea className="field min-h-24" value={draft.tomorrowPlan} onChange={(e) => setDraft({ ...draft, tomorrowPlan: e.target.value })} /></label>
            <label>
              <span className="label">今日复盘评分：{draft.score} / 10</span>
              <input className="w-full" type="range" min={1} max={10} value={draft.score} onChange={(e) => setDraft({ ...draft, score: Number(e.target.value) })} />
            </label>
            <button className="btn btn-primary w-fit" onClick={save}><Save size={16} />保存复盘</button>
          </div>
        </div>
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-base font-semibold">昨日对比</h2>
            {yesterdayReview ? (
              <div className="mt-4 space-y-4">
                <div className={`rounded-lg border p-4 ${yesterdayTone.className}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{yesterdayDate}</p>
                    <span className="rounded bg-white/70 px-2 py-1 text-sm font-semibold">{yesterdayAverageScore} 分 · {yesterdayTone.label}</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-sm font-semibold text-slate-700">昨日总结</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600">{yesterdayReview.summary || '未填写'}</p>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                    <p className="text-sm font-semibold text-emerald-700">昨日完成得好的地方</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-emerald-700/80">{yesterdayReview.wins || '未填写'}</p>
                  </div>
                  <div className="rounded-lg border border-rose-100 bg-rose-50 p-3">
                    <p className="text-sm font-semibold text-rose-700">昨日问题</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-rose-700/80">{yesterdayReview.problems || '未填写'}</p>
                  </div>
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                    <p className="text-sm font-semibold text-blue-700">昨日写给今天的改进计划</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-blue-700/80">{yesterdayReview.tomorrowPlan || '未填写'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-slate-500">昨日评分</p>
                    <p className="mt-1 text-lg font-semibold">{yesterdayAverageScore}</p>
                  </div>
                  <div className={`rounded-lg p-3 ${scoreDiff > 0 ? 'bg-emerald-50 text-emerald-700' : scoreDiff < 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-600'}`}>
                    <p className="opacity-75">当前差值</p>
                    <p className="mt-1 text-lg font-semibold">{scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <p className="text-slate-500">今日评分</p>
                    <p className="mt-1 text-lg font-semibold">{draft.score}</p>
                  </div>
                </div>
              </div>
            ) : <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">没有找到 {yesterdayDate} 的复盘，保存后明天这里就能自动对比。</p>}
          </div>

          <div className="card p-5">
            <h2 className="text-base font-semibold">历史复盘</h2>
            <div className="mt-4 space-y-2">
              {reviews.length ? [...reviews].sort((a, b) => b.date.localeCompare(a.date)).map((review) => (
                <button key={review.id} className="w-full rounded-lg border border-slate-200 p-3 text-left hover:bg-slate-50" onClick={() => setDate(review.date)}>
                  <p className="font-medium">{review.date}</p>
                  <p className="line-clamp-2 text-sm text-slate-500">{review.summary}</p>
                </button>
              )) : <p className="text-sm text-slate-500">还没有复盘记录。</p>}
            </div>
          </div>
        </div>
      </div>
      <Toast message={toast} />
    </Page>
  );
}
