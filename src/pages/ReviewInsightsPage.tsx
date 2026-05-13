import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { serverApi, type EmbeddingStatus, type ErrorThemeAnalysis } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
import { ChartBox, ReviewTrendChart } from '../components/Charts';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { useReviewsData } from '../hooks/useReviewsData';
import { dateRangeEndingToday, todayISO } from '../utils/date';
import { getReviewAverageScore, getReviewTone, getReviewTrend } from '../utils/statistics';

const reportPageSize = 10;
const problemRangeOptions = [
  { value: '7', label: '最近 7 天' },
  { value: '30', label: '最近 30 天' },
  { value: 'all', label: '全部' },
] as const;
type ProblemRange = typeof problemRangeOptions[number]['value'];

const emptyErrorThemeAnalysis: ErrorThemeAnalysis = {
  periodStart: '1900-01-01',
  periodEnd: todayISO(),
  latestBatch: null,
  summary: {
    occurrenceCount: 0,
    themeCount: 0,
    reviewDayCount: 0,
    topTheme: null,
  },
  themes: [],
  timeline: [],
  readOnly: false,
};

const emptyEmbeddingStatus: EmbeddingStatus = {
  available: false,
  backend: 'unavailable',
  modelName: 'BAAI/bge-small-zh-v1.5',
  cacheDir: '',
  workerFile: '',
  python: null,
  error: '',
  embeddingRows: 0,
  readOnly: false,
};

export function ReviewInsightsPage() {
  const [page, setPage] = useState(1);
  const [problemRange, setProblemRange] = useState<ProblemRange>('30');
  const [batchLoading, setBatchLoading] = useState(false);
  const [toast, setToast] = useState('');
  const trendStart = dateRangeEndingToday(30)[0] ?? todayISO();
  const problemStart = problemRange === 'all' ? undefined : dateRangeEndingToday(Number(problemRange))[0] ?? todayISO();
  const problemEnd = problemRange === 'all' ? undefined : todayISO();
  const { reviews: trendReviews } = useReviewsData(trendStart, todayISO());
  const { reviews: reportReviews, total, readOnly: reviewsReadOnly } = useReviewsData(undefined, undefined, reportPageSize, (page - 1) * reportPageSize);
  const { data: errorThemeAnalysis = emptyErrorThemeAnalysis } = useQuery({
    queryKey: queryKeys.errorThemes(problemStart, problemEnd),
    queryFn: () => serverApi.getErrorThemeAnalysis(problemStart, problemEnd),
    placeholderData: emptyErrorThemeAnalysis,
  });
  const { data: embeddingStatus = emptyEmbeddingStatus } = useQuery({
    queryKey: queryKeys.embeddingStatus,
    queryFn: serverApi.getEmbeddingStatus,
    placeholderData: emptyEmbeddingStatus,
  });
  const sortedReviews = [...reportReviews].sort((a, b) => b.date.localeCompare(a.date));
  const trend = getReviewTrend(trendReviews, 30);
  const readOnly = reviewsReadOnly || Boolean(errorThemeAnalysis.readOnly);
  const reviewedDays = total;
  const averageScore = reviewedDays
    ? Math.round((trendReviews.reduce((sum, review) => sum + getReviewAverageScore(review), 0) / Math.max(1, trendReviews.length)) * 10) / 10
    : 0;
  const bestReview = [...trendReviews].sort((a, b) => getReviewAverageScore(b) - getReviewAverageScore(a))[0];
  const totalPages = Math.max(1, Math.ceil(total / reportPageSize));
  const maxTimelineCount = Math.max(1, ...errorThemeAnalysis.timeline.map((item) => item.count));

  const runBatch = async () => {
    if (readOnly) return;
    setBatchLoading(true);
    try {
      const result = await serverApi.runErrorThemeBatch(problemStart, problemEnd, 'embedding');
      queryClient.setQueryData(queryKeys.errorThemes(problemStart, problemEnd), result.analysis);
      await queryClient.invalidateQueries({ queryKey: queryKeys.embeddingStatus });
      await queryClient.invalidateQueries({ queryKey: queryKeys.reports });
      const modeLabel = result.result.source === 'local-embedding-batch' ? 'embedding' : '规则兜底';
      setToast(`批处理完成：${modeLabel} 识别 ${result.result.themeCount} 类，生成 ${result.result.occurrenceCount} 条证据，合并重复 ${result.result.deduplicatedCount} 条`);
    } catch {
      setToast('批处理失败，请稍后重试');
    } finally {
      setBatchLoading(false);
      window.setTimeout(() => setToast(''), 2600);
    }
  };

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
            <h2 className="text-base font-semibold text-slate-900">错误主题库分析</h2>
            <p className="mt-1 text-sm text-slate-500">本地 embedding 会先把复盘句子转成语义向量，再写入错误主题库；不可用时自动规则兜底。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <button className="btn btn-primary" disabled={readOnly || batchLoading} onClick={() => void runBatch()}>
              <RefreshCw size={16} className={batchLoading ? 'animate-spin' : ''} />
              手动开始本地 embedding 批处理
            </button>
          </div>
        </div>

        <div className={`mt-4 rounded-lg border p-4 ${embeddingStatus.available ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">本地 embedding 模型：{embeddingStatus.available ? '可用' : '未就绪，批处理会规则兜底'}</p>
            <span className="rounded bg-white/80 px-2 py-1 text-xs font-semibold">{embeddingStatus.embeddingRows} 条向量已落库</span>
          </div>
          <p className="mt-2 text-xs leading-5">
            模型：{embeddingStatus.modelName}，后端：{embeddingStatus.backend}
            {embeddingStatus.error ? `，状态：${embeddingStatus.error}` : ''}
          </p>
        </div>

        {errorThemeAnalysis.latestBatch ? (
          <p className="mt-3 text-xs text-slate-500">
            最近批处理：{new Date(errorThemeAnalysis.latestBatch.completedAt || errorThemeAnalysis.latestBatch.createdAt).toLocaleString()}，
            范围 {errorThemeAnalysis.latestBatch.periodStart} 至 {errorThemeAnalysis.latestBatch.periodEnd}，
            来源 {errorThemeAnalysis.latestBatch.source}。
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-500">主题数</p>
            <p className="mt-2 text-xl font-semibold text-slate-950">{errorThemeAnalysis.summary.themeCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-500">证据句</p>
            <p className="mt-2 text-xl font-semibold text-slate-950">{errorThemeAnalysis.summary.occurrenceCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-500">涉及天数</p>
            <p className="mt-2 text-xl font-semibold text-slate-950">{errorThemeAnalysis.summary.reviewDayCount}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-500">最高频问题</p>
            <p className="mt-2 line-clamp-1 text-base font-semibold text-slate-950">{errorThemeAnalysis.summary.topTheme?.label ?? '暂无'}</p>
          </div>
        </div>

        {errorThemeAnalysis.themes.length ? (
          <>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {errorThemeAnalysis.themes.map((problem) => (
                <article key={problem.id} className="rounded-lg border border-rose-100 bg-rose-50/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-rose-800">{problem.label}</h3>
                    <span className="rounded bg-white/80 px-2 py-1 text-xs font-semibold text-rose-700">
                      {problem.reviewDayCount} 天 / {problem.occurrenceCount} 条
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-rose-700">
                    首次：{problem.firstSeenAt}，最近：{problem.lastSeenAt}，平均置信度 {Math.round(problem.averageConfidence * 100)}%
                  </p>
                  <div className="mt-3 space-y-2">
                    {problem.examples.map((example) => (
                      <p key={`${problem.id}-${example.date}-${example.field}-${example.evidence}`} className="rounded bg-white/80 p-3 text-sm leading-6 text-slate-600">
                        <span className="font-semibold text-slate-800">{example.date} · {example.field}：</span>{example.evidence}
                      </p>
                    ))}
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">周期内错误密度</h3>
              <div className="mt-3 space-y-2">
                {errorThemeAnalysis.timeline.map((item) => (
                  <div key={item.date} className="grid grid-cols-[88px_1fr_40px] items-center gap-3 text-sm">
                    <span className="text-slate-500">{item.date.slice(5)}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-rose-400" style={{ width: `${Math.max(8, (item.count / maxTimelineCount) * 100)}%` }} />
                    </div>
                    <span className="text-right font-semibold text-slate-700">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <EmptyState title="错误主题库暂无数据" description="点击“手动开始本地模型批处理”后，系统会把历史复盘里的共性错误写入主题库。" />
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
      <Toast message={toast} />
    </Page>
  );
}
