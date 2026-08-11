/* eslint-disable react-hooks/set-state-in-effect -- Selected-date form state intentionally mirrors the local DB record. */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { serverApi } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { reviewsRepository } from '../db/repositories/reviewsRepository';
import { useReviewsData } from '../hooks/useReviewsData';
import { minutesToHoursText, previousDateISO, todayISO } from '../utils/date';
import { getReviewAverageScore, getReviewTone } from '../utils/statistics';

export function ReviewsPage() {
  const { reviews } = useReviewsData();
  const [date, setDate] = useState(todayISO());
  const [autoImportedDate, setAutoImportedDate] = useState('');
  const current = useMemo(() => reviews.find((review) => review.date === date), [reviews, date]);
  const yesterdayDate = previousDateISO(date);
  const yesterdayReview = useMemo(() => reviews.find((review) => review.date === yesterdayDate), [reviews, yesterdayDate]);
  const [draft, setDraft] = useState({ summary: '', wins: '', problems: '', tomorrowPlan: '', score: 6 });
  const [toast, setToast] = useState('');
  const yesterdayAverageScore = getReviewAverageScore(yesterdayReview);
  const scoreDiff = yesterdayReview ? Math.round((draft.score - yesterdayAverageScore) * 10) / 10 : 0;
  const yesterdayTone = getReviewTone(yesterdayAverageScore);
  const { data: prefill } = useQuery({
    queryKey: queryKeys.reviewPrefill(date),
    queryFn: () => serverApi.getReviewPrefill(date),
    placeholderData: undefined,
  });

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
  };

  useEffect(() => {
    setDraft({
      summary: current?.summary ?? '',
      wins: current?.wins ?? '',
      problems: current?.problems ?? '',
      tomorrowPlan: current?.tomorrowPlan ?? '',
      score: getReviewAverageScore(current) || 6,
    });
    setAutoImportedDate('');
  }, [current]);

  useEffect(() => {
    if (current || autoImportedDate === date || !prefill?.problemInboxItems.length || draft.problems.trim()) return;
    setDraft((currentDraft) => ({
      ...currentDraft,
      problems: prefill.suggestedProblems,
    }));
    setAutoImportedDate(date);
  }, [autoImportedDate, current, date, draft.problems, prefill]);

  const save = async () => {
    if (!draft.summary.trim()) return alert('请至少填写今日总结');
    showToast(current ? '复盘正在后台更新' : '复盘正在后台保存');
    void reviewsRepository.upsert({ date, ...draft })
      .then(async () => {
        if (prefill?.problemInboxItems.length) {
          await serverApi.resolveProblemInboxByDate(date);
          await queryClient.invalidateQueries({ queryKey: queryKeys.problemInbox('open') });
          await queryClient.invalidateQueries({ queryKey: queryKeys.reviewPrefill(date) });
        }
        showToast(current ? '复盘已更新，问题 Inbox 已同步' : '复盘已保存，问题 Inbox 已同步');
      })
      .catch(() => showToast('复盘保存失败，请稍后重试'));
  };

  const appendField = (field: 'summary' | 'problems' | 'tomorrowPlan', value = '') => {
    const text = value.trim();
    if (!text) return;
    setDraft((currentDraft) => ({
      ...currentDraft,
      [field]: currentDraft[field]?.trim() ? `${currentDraft[field].trim()}\n${text}` : text,
    }));
  };

  return (
    <Page title="每日复盘" subtitle="每天一条主复盘，回看时不会散。">
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="card p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <label><span className="label">复盘日期</span><input className="field w-52" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <span className="rounded bg-surface-inset px-3 py-2 text-sm text-secondary">{current ? '编辑已有复盘' : '新建当天复盘'}</span>
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
            <h2 className="text-base font-semibold">今日复盘预填</h2>
            <p className="mt-1 text-sm text-secondary">根据今天的学习、短期目标、喝水和问题 Inbox 生成素材，点一下就能带入表单。</p>
            <div className="mt-4 grid gap-2 text-sm">
              <div className="rounded-lg border border-line bg-surface-muted p-3">
                <p className="text-xs font-semibold text-secondary">今日学习</p>
                <p className="mt-1 font-semibold text-strong">{prefill ? minutesToHoursText(prefill.totalMinutes) : '--'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-muted p-3">
                <p className="text-xs font-semibold text-secondary">投入最多</p>
                <p className="mt-1 font-semibold text-strong">{prefill?.topProject ? `${prefill.topProject.name} ${minutesToHoursText(prefill.topProject.minutes)}` : '暂无'}</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-muted p-3">
                <p className="text-xs font-semibold text-secondary">喝水</p>
                <p className="mt-1 font-semibold text-strong">{prefill ? `${prefill.water.cups}/${prefill.water.targetCups} 杯` : '--'}</p>
              </div>
            </div>
            {prefill?.problemInboxItems.length ? (
              <div className="mt-3 rounded-lg border border-warning bg-warning-soft p-3">
                <p className="text-xs font-semibold text-warning">今天记录的问题</p>
                <ul className="mt-2 space-y-1 text-sm text-warning">
                  {prefill.problemInboxItems.map((item) => <li key={item.id}>- {item.text}</li>)}
                </ul>
                {!current ? <p className="mt-2 text-xs font-semibold text-warning">已自动带入“今日问题”，保存复盘后会标记为已处理。</p> : null}
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn btn-soft" type="button" onClick={() => appendField('summary', prefill?.suggestedSummary)}>带入总结</button>
              <button className="btn btn-soft" type="button" onClick={() => appendField('problems', prefill?.suggestedProblems)}>带入问题</button>
              <button className="btn btn-soft" type="button" onClick={() => appendField('tomorrowPlan', prefill?.previousTomorrowPlan)}>沿用昨日计划</button>
            </div>
          </div>

          <div className="card p-5">
            <h2 className="text-base font-semibold">昨日对比</h2>
            {yesterdayReview ? (
              <div className="mt-4 space-y-4">
                <div className={`rounded-lg border p-4 ${yesterdayTone.className}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{yesterdayDate}</p>
                    <span className="rounded bg-surface-strong px-2 py-1 text-sm font-semibold">{yesterdayAverageScore} 分 · {yesterdayTone.label}</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-lg border border-line bg-surface-strong p-3">
                    <p className="text-sm font-semibold text-strong">昨日总结</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-secondary">{yesterdayReview.summary || '未填写'}</p>
                  </div>
                  <div className="rounded-lg border border-success bg-success-soft p-3">
                    <p className="text-sm font-semibold text-success">昨日完成得好的地方</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-success">{yesterdayReview.wins || '未填写'}</p>
                  </div>
                  <div className="rounded-lg border border-danger bg-danger-soft p-3">
                    <p className="text-sm font-semibold text-danger">昨日问题</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-danger">{yesterdayReview.problems || '未填写'}</p>
                  </div>
                  <div className="rounded-lg border border-accent bg-accent-soft p-3">
                    <p className="text-sm font-semibold text-accent">昨日写给今天的改进计划</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-accent">{yesterdayReview.tomorrowPlan || '未填写'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-lg bg-surface-muted p-3">
                    <p className="text-secondary">昨日评分</p>
                    <p className="mt-1 text-lg font-semibold">{yesterdayAverageScore}</p>
                  </div>
                  <div className={`rounded-lg p-3 ${scoreDiff > 0 ? 'bg-success-soft text-success' : scoreDiff < 0 ? 'bg-danger-soft text-danger' : 'bg-surface-muted text-secondary'}`}>
                    <p className="opacity-75">当前差值</p>
                    <p className="mt-1 text-lg font-semibold">{scoreDiff > 0 ? `+${scoreDiff}` : scoreDiff}</p>
                  </div>
                  <div className="rounded-lg bg-surface-muted p-3">
                    <p className="text-secondary">今日评分</p>
                    <p className="mt-1 text-lg font-semibold">{draft.score}</p>
                  </div>
                </div>
              </div>
            ) : <p className="mt-4 rounded-lg border border-dashed border-line-strong bg-surface-muted p-4 text-sm text-secondary">没有找到 {yesterdayDate} 的复盘，保存后明天这里就能自动对比。</p>}
          </div>

          <div className="card p-5">
            <h2 className="text-base font-semibold">历史复盘</h2>
            <div className="mt-4 space-y-2">
              {reviews.length ? [...reviews].sort((a, b) => b.date.localeCompare(a.date)).map((review) => (
                <button key={review.id} className="w-full rounded-lg border border-line p-3 text-left hover:bg-surface-hover" onClick={() => setDate(review.date)}>
                  <p className="font-medium">{review.date}</p>
                  <p className="line-clamp-2 text-sm text-secondary">{review.summary}</p>
                </button>
              )) : <p className="text-sm text-secondary">还没有复盘记录。</p>}
            </div>
          </div>
        </div>
      </div>
      <Toast message={toast} />
    </Page>
  );
}
