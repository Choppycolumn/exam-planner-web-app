import { useState } from 'react';
import { ChartBox, ReviewTrendChart } from '../components/Charts';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { useReviewsData } from '../hooks/useReviewsData';
import { dateRangeEndingToday, todayISO } from '../utils/date';
import { getReviewAverageScore, getReviewTone, getReviewTrend } from '../utils/statistics';

const reportPageSize = 10;

export function ReviewInsightsPage() {
  const [page, setPage] = useState(1);
  const trendStart = dateRangeEndingToday(30)[0] ?? todayISO();
  const { reviews: trendReviews } = useReviewsData(trendStart, todayISO());
  const { reviews: reportReviews, total } = useReviewsData(undefined, undefined, reportPageSize, (page - 1) * reportPageSize);
  const sortedReviews = [...reportReviews].sort((a, b) => b.date.localeCompare(a.date));
  const trend = getReviewTrend(trendReviews, 30);
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
