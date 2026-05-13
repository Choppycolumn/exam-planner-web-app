import { useState } from 'react';
import { ChartBox, ReviewTrendChart } from '../components/Charts';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { useReviewsData } from '../hooks/useReviewsData';
import { dateRangeEndingToday, todayISO } from '../utils/date';
import { getReviewProblemThemes } from '../utils/reviewProblems';
import { getReviewAverageScore, getReviewTone, getReviewTrend } from '../utils/statistics';

const reportPageSize = 10;
const problemRangeOptions = [
  { value: '7', label: '最近 7 天' },
  { value: '30', label: '最近 30 天' },
  { value: 'all', label: '全部' },
] as const;
type ProblemRange = typeof problemRangeOptions[number]['value'];

export function ReviewInsightsPage() {
  const [page, setPage] = useState(1);
  const [problemRange, setProblemRange] = useState<ProblemRange>('30');
  const trendStart = dateRangeEndingToday(30)[0] ?? todayISO();
  const problemStart = problemRange === 'all' ? undefined : dateRangeEndingToday(Number(problemRange))[0] ?? todayISO();
  const problemEnd = problemRange === 'all' ? undefined : todayISO();
  const { reviews: trendReviews } = useReviewsData(trendStart, todayISO());
  const { reviews: problemReviews } = useReviewsData(problemStart, problemEnd);
  const { reviews: reportReviews, total } = useReviewsData(undefined, undefined, reportPageSize, (page - 1) * reportPageSize);
  const sortedReviews = [...reportReviews].sort((a, b) => b.date.localeCompare(a.date));
  const trend = getReviewTrend(trendReviews, 30);
  const problemThemes = getReviewProblemThemes(problemReviews);
  const reviewedDays = total;
  const averageScore = reviewedDays
    ? Math.round((trendReviews.reduce((sum, review) => sum + getReviewAverageScore(review), 0) / Math.max(1, trendReviews.length)) * 10) / 10
    : 0;
  const bestReview = [...trendReviews].sort((a, b) => getReviewAverageScore(b) - getReviewAverageScore(a))[0];
  const totalPages = Math.max(1, Math.ceil(total / reportPageSize));

  return (
    <Page title="复盘趋势" subtitle="从一段时间里看状态、满意度和每日复盘质量。">
      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <MetricCard label="累计复盘" value={`${reviewedDays} 天`} />
        <MetricCard label="平均评分" value={averageScore || '暂无'} />
        <MetricCard label="最好一天" value={bestReview ? bestReview.date : '暂无'} hint={bestReview ? `${getReviewAverageScore(bestReview)} 分` : undefined} />
      </div>

      <ChartBox title="最近 30 天复盘评分趋势">
        {trendReviews.length ? <ReviewTrendChart data={trend} /> : <EmptyState title="还没有复盘数据" description="完成一次每日复盘后，这里会显示趋势。" />}
      </ChartBox>

      <section className="mt-5 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">问题主题统计</h2>
            <p className="mt-1 text-sm text-slate-500">按复盘文字识别周期内反复出现的共性卡点。</p>
          </div>
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            {problemRangeOptions.map((option) => (
              <button
                key={option.value}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                  problemRange === option.value ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                }`}
                onClick={() => setProblemRange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {problemThemes.length ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {problemThemes.map((problem) => (
              <article key={problem.id} className="rounded-lg border border-rose-100 bg-rose-50/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold text-rose-800">{problem.label}</h3>
                  <span className="rounded bg-white/80 px-2 py-1 text-xs font-semibold text-rose-700">{problem.count} 天提到</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-rose-700">出现日期：{problem.dates.join('、')}</p>
                <div className="mt-3 space-y-2">
                  {problem.examples.map((example) => (
                    <p key={`${example.date}-${example.field}-${example.text}`} className="rounded bg-white/80 p-3 text-sm leading-6 text-slate-600">
                      <span className="font-semibold text-slate-800">{example.date} · {example.field}：</span>{example.text}
                    </p>
                  ))}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无反复出现的问题主题" description="这里只做共性错误统计，不生成建议；复盘文字越具体，识别越稳定。" />
        )}
      </section>

      <div className="mt-5 card p-5">
        <h2 className="text-base font-semibold text-slate-900">完整复盘报告</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {sortedReviews.length ? sortedReviews.map((review) => {
            const score = getReviewAverageScore(review);
            const tone = getReviewTone(score);
            return (
              <article key={review.id} className={`rounded-lg border p-4 ${tone.className}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{review.date}</p>
                  <span className="rounded bg-white/70 px-2 py-1 text-sm font-semibold">{score} 分 · {tone.label}</span>
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  <section className="rounded-lg bg-white/70 p-3">
                    <p className="font-semibold text-slate-700">今日总结</p>
                    <p className="mt-1 whitespace-pre-wrap leading-6 text-slate-600">{review.summary || '未填写'}</p>
                  </section>
                  <section className="rounded-lg bg-white/70 p-3">
                    <p className="font-semibold text-emerald-700">完成得好的地方</p>
                    <p className="mt-1 whitespace-pre-wrap leading-6 text-slate-600">{review.wins || '未填写'}</p>
                  </section>
                  <section className="rounded-lg bg-white/70 p-3">
                    <p className="font-semibold text-rose-700">今日问题</p>
                    <p className="mt-1 whitespace-pre-wrap leading-6 text-slate-600">{review.problems || '未填写'}</p>
                  </section>
                  <section className="rounded-lg bg-white/70 p-3">
                    <p className="font-semibold text-blue-700">明日改进计划</p>
                    <p className="mt-1 whitespace-pre-wrap leading-6 text-slate-600">{review.tomorrowPlan || '未填写'}</p>
                  </section>
                </div>
              </article>
            );
          }) : <EmptyState title="还没有复盘记录" />}
        </div>
        {total ? (
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm text-slate-500">
            <span>共 {total} 条复盘，第 {page} / {totalPages} 页</span>
            <div className="flex gap-2">
              <button className="btn btn-soft" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button>
              <button className="btn btn-soft" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>下一页</button>
            </div>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
