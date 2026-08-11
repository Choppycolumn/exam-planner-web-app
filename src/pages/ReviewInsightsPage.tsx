import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, RefreshCw, X } from 'lucide-react';
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
  modelName: 'intfloat/multilingual-e5-large',
  modelProfile: 'large',
  smallModelName: 'BAAI/bge-small-zh-v1.5',
  largeModelName: 'intfloat/multilingual-e5-large',
  nightlyModelProfile: 'rules',
  manualModelProfile: 'rules',
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
  const [selectedThemeId, setSelectedThemeId] = useState<number | null>(null);
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
  const { data: reviewTrendData } = useQuery({
    queryKey: queryKeys.reviewTrend(30),
    queryFn: () => serverApi.getReviewTrend(30),
  });
  const { data: embeddingStatus = emptyEmbeddingStatus } = useQuery({
    queryKey: queryKeys.embeddingStatus,
    queryFn: serverApi.getEmbeddingStatus,
    placeholderData: emptyEmbeddingStatus,
  });
  const { data: themeOptionsData = { themes: [] } } = useQuery({
    queryKey: queryKeys.errorThemeOptions,
    queryFn: serverApi.getErrorThemeOptions,
    placeholderData: { themes: [] },
  });
  const { data: batchStatus = { job: null } } = useQuery({
    queryKey: queryKeys.errorThemeBatchStatus,
    queryFn: serverApi.getErrorThemeBatchStatus,
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      return status === 'queued' || status === 'running' ? 5000 : false;
    },
    placeholderData: { job: null },
  });
  const { data: selectedThemeDetail } = useQuery({
    queryKey: queryKeys.errorThemeDetail(selectedThemeId ?? 0, problemStart, problemEnd),
    queryFn: () => serverApi.getErrorThemeDetail(selectedThemeId || 0, problemStart, problemEnd),
    enabled: Boolean(selectedThemeId),
  });
  const sortedReviews = [...reportReviews].sort((a, b) => b.date.localeCompare(a.date));
  const trend = reviewTrendData?.trend ?? getReviewTrend(trendReviews, 30);
  const readOnly = reviewsReadOnly || Boolean(errorThemeAnalysis.readOnly);
  const reviewedDays = total;
  const averageScore = reviewedDays
    ? Math.round((trendReviews.reduce((sum, review) => sum + getReviewAverageScore(review), 0) / Math.max(1, trendReviews.length)) * 10) / 10
    : 0;
  const bestReview = [...trendReviews].sort((a, b) => getReviewAverageScore(b) - getReviewAverageScore(a))[0];
  const totalPages = Math.max(1, Math.ceil(total / reportPageSize));
  const maxTimelineCount = Math.max(1, ...errorThemeAnalysis.timeline.map((item) => item.count));
  const activeJob = batchStatus.job?.status === 'queued' || batchStatus.job?.status === 'running' ? batchStatus.job : null;

  const runBatch = async () => {
    if (readOnly) return;
    setBatchLoading(true);
    try {
      const result = await serverApi.runErrorThemeBatch(problemStart, problemEnd, 'rules');
      await queryClient.invalidateQueries({ queryKey: queryKeys.errorThemeBatchStatus });
      setToast(result.started ? '后台批处理已开始，完成后会自动刷新报告' : '已有批处理正在运行');
    } catch {
      setToast('批处理失败，请稍后重试');
    } finally {
      setBatchLoading(false);
      window.setTimeout(() => setToast(''), 2600);
    }
  };

  const refreshAfterCorrection = async (analysis?: ErrorThemeAnalysis) => {
    if (analysis) queryClient.setQueryData(queryKeys.errorThemes(problemStart, problemEnd), analysis);
    await queryClient.invalidateQueries({ queryKey: queryKeys.reports });
    await queryClient.invalidateQueries({ queryKey: queryKeys.errorThemes(problemStart, problemEnd) });
    if (selectedThemeId) await queryClient.invalidateQueries({ queryKey: queryKeys.errorThemeDetail(selectedThemeId, problemStart, problemEnd) });
  };

  const relabelExample = async (problemLabel: string, problemKey: string, example: ErrorThemeAnalysis['themes'][number]['examples'][number], targetThemeKey: string) => {
    if (readOnly || !targetThemeKey || targetThemeKey === problemKey) return;
    try {
      const result = await serverApi.saveErrorThemeCorrection({
        occurrenceId: example.occurrenceId,
        sentence: example.evidence,
        action: 'relabel',
        targetThemeKey,
        sourceThemeKey: problemKey,
        sourceLabel: problemLabel,
        from: problemStart,
        to: problemEnd,
      });
      await refreshAfterCorrection(result.analysis);
      setToast('分类已修正，并写入纠错样本库');
    } catch {
      setToast('修正失败，请稍后重试');
    } finally {
      window.setTimeout(() => setToast(''), 2400);
    }
  };

  const ignoreExample = async (problemLabel: string, problemKey: string, example: ErrorThemeAnalysis['themes'][number]['examples'][number]) => {
    if (readOnly) return;
    try {
      const result = await serverApi.saveErrorThemeCorrection({
        occurrenceId: example.occurrenceId,
        sentence: example.evidence,
        action: 'ignore',
        sourceThemeKey: problemKey,
        sourceLabel: problemLabel,
        from: problemStart,
        to: problemEnd,
      });
      await refreshAfterCorrection(result.analysis);
      setToast('这条证据已忽略，并写入纠错样本库');
    } catch {
      setToast('忽略失败，请稍后重试');
    } finally {
      window.setTimeout(() => setToast(''), 2400);
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
        {trend.some((item) => item.score !== null) ? <ReviewTrendChart data={trend} /> : <EmptyState title="还没有复盘数据" description="完成一次每日复盘后，这里会显示趋势。" />}
      </ChartBox>

      <section className="mt-5 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-primary">错误主题库分析</h2>
            <p className="mt-1 text-sm text-secondary">规则分类会优先识别你反复出现的拖延、执行、英语阅读、数学错题等问题，并写入错误主题库。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-line bg-surface-muted p-1">
              {problemRangeOptions.map((option) => (
                <button
                  key={option.value}
                  className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                    problemRange === option.value ? 'bg-surface-strong text-primary shadow-sm' : 'text-secondary hover:text-primary'
                  }`}
                  onClick={() => setProblemRange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button className="btn btn-primary" disabled={readOnly || batchLoading || Boolean(activeJob)} onClick={() => void runBatch()}>
              <RefreshCw size={16} className={batchLoading || activeJob ? 'animate-spin' : ''} />
              {activeJob ? '后台批处理中' : '手动开始规则整理'}
            </button>
          </div>
        </div>

        {errorThemeAnalysis.themes.length ? (
          <div className="mt-4 rounded-lg border border-line bg-surface-strong p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-primary">错因词云</h3>
              {errorThemeAnalysis.precomputedAt ? <span className="text-xs text-tertiary">缓存于 {new Date(errorThemeAnalysis.precomputedAt).toLocaleString()}</span> : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {errorThemeAnalysis.themes.map((theme) => {
                const size = Math.min(24, 12 + theme.occurrenceCount * 1.3);
                return (
                  <button
                    key={theme.id}
                    className="rounded-lg border border-danger bg-danger-soft px-3 py-2 font-semibold text-danger transition hover:bg-danger-soft"
                    style={{ fontSize: `${size}px` }}
                    onClick={() => setSelectedThemeId(theme.id)}
                    title={`${theme.reviewDayCount} 天 / ${theme.occurrenceCount} 条`}
                  >
                    {theme.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className={`mt-4 rounded-lg border p-4 ${embeddingStatus.available ? 'border-success bg-success-soft text-success' : 'border-warning bg-warning-soft text-warning'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">当前策略：规则分类</p>
            <span className="rounded bg-surface-strong px-2 py-1 text-xs font-semibold">{embeddingStatus.embeddingRows} 条向量已落库</span>
          </div>
          <p className="mt-2 text-xs leading-5">
            备用模型：{embeddingStatus.smallModelName || embeddingStatus.modelName}，后端：{embeddingStatus.backend}
            {embeddingStatus.error ? `，状态：${embeddingStatus.error}` : ''}
          </p>
        </div>

        {errorThemeAnalysis.latestBatch ? (
          <p className="mt-3 text-xs text-secondary">
            最近批处理：{new Date(errorThemeAnalysis.latestBatch.completedAt || errorThemeAnalysis.latestBatch.createdAt).toLocaleString()}，
            范围 {errorThemeAnalysis.latestBatch.periodStart} 至 {errorThemeAnalysis.latestBatch.periodEnd}，
            来源 {errorThemeAnalysis.latestBatch.source}，状态 {errorThemeAnalysis.latestBatch.status}。
            {errorThemeAnalysis.latestBatch.status === 'failed' && errorThemeAnalysis.latestBatch.note ? ` ${errorThemeAnalysis.latestBatch.note}` : ''}
          </p>
        ) : null}
        {batchStatus.job ? (
          <p className="mt-2 text-xs text-secondary">
            后台任务：{batchStatus.job.status}
            {batchStatus.job.result ? `，最近完成 ${batchStatus.job.result.occurrenceCount} 条证据` : ''}
            {batchStatus.job.error ? `，错误：${batchStatus.job.error}` : ''}
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-line bg-surface-muted p-4">
            <p className="text-xs font-semibold text-secondary">主题数</p>
            <p className="mt-2 text-xl font-semibold text-primary">{errorThemeAnalysis.summary.themeCount}</p>
          </div>
          <div className="rounded-lg border border-line bg-surface-muted p-4">
            <p className="text-xs font-semibold text-secondary">证据句</p>
            <p className="mt-2 text-xl font-semibold text-primary">{errorThemeAnalysis.summary.occurrenceCount}</p>
          </div>
          <div className="rounded-lg border border-line bg-surface-muted p-4">
            <p className="text-xs font-semibold text-secondary">涉及天数</p>
            <p className="mt-2 text-xl font-semibold text-primary">{errorThemeAnalysis.summary.reviewDayCount}</p>
          </div>
          <div className="rounded-lg border border-line bg-surface-muted p-4">
            <p className="text-xs font-semibold text-secondary">最高频问题</p>
            <p className="mt-2 line-clamp-1 text-base font-semibold text-primary">{errorThemeAnalysis.summary.topTheme?.label ?? '暂无'}</p>
          </div>
        </div>

        {errorThemeAnalysis.themes.length ? (
          <>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {errorThemeAnalysis.themes.map((problem) => (
                <article key={problem.id} className="rounded-lg border border-danger bg-danger-soft p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-danger">{problem.label}</h3>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-surface-strong px-2 py-1 text-xs font-semibold text-danger">
                        {problem.reviewDayCount} 天 / {problem.occurrenceCount} 条
                      </span>
                      <button className="inline-flex items-center gap-1 rounded-md border border-danger bg-surface-strong px-2 py-1 text-xs font-semibold text-danger hover:bg-surface-hover" onClick={() => setSelectedThemeId(problem.id)}>
                        <Eye size={12} />详情
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-danger">
                    首次：{problem.firstSeenAt}，最近：{problem.lastSeenAt}，平均置信度 {Math.round(problem.averageConfidence * 100)}%
                  </p>
                  <div className="mt-3 space-y-2">
                    {problem.examples.map((example) => (
                      <div key={`${problem.id}-${example.occurrenceId}-${example.evidence}`} className="rounded bg-surface-strong p-3 text-sm leading-6 text-secondary">
                        <p>
                          <span className="font-semibold text-strong">{example.date} · {example.field}：</span>{example.evidence}
                        </p>
                        {!readOnly ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <select
                              className="rounded-md border border-line bg-surface-strong px-2 py-1 text-strong"
                              defaultValue={problem.normalizedLabel}
                              onChange={(event) => void relabelExample(problem.label, problem.normalizedLabel, example, event.target.value)}
                            >
                              {themeOptionsData.themes.map((theme) => (
                                <option key={theme.id} value={theme.id}>{theme.label}</option>
                              ))}
                            </select>
                            <button className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-strong px-2 py-1 font-semibold text-secondary hover:text-danger" onClick={() => void ignoreExample(problem.label, problem.normalizedLabel, example)}>
                              <X size={12} />忽略
                            </button>
                            <span className="text-tertiary">来源：{example.source}</span>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>

            {selectedThemeDetail ? (
              <div className="mt-5 rounded-lg border border-accent bg-accent-soft p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-accent">{selectedThemeDetail.theme.label}</h3>
                    <p className="mt-1 text-xs leading-5 text-accent">
                      {selectedThemeDetail.periodStart} 至 {selectedThemeDetail.periodEnd}，共 {selectedThemeDetail.occurrences.length} 条证据。
                      {selectedThemeDetail.repeatedWeeks.length ? ` 有 ${selectedThemeDetail.repeatedWeeks.length} 个周区间重复出现 3 次以上。` : ''}
                    </p>
                  </div>
                  <button className="rounded-md border border-accent bg-surface-strong px-2 py-1 text-xs font-semibold text-accent" onClick={() => setSelectedThemeId(null)}>
                    收起详情
                  </button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {selectedThemeDetail.byField.map((item) => (
                    <div key={item.field} className="rounded-lg border border-accent bg-surface-strong p-3">
                      <p className="text-xs font-semibold text-accent">{item.field}</p>
                      <p className="mt-1 text-lg font-semibold text-accent">{item.count} 条</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 max-h-[520px] space-y-3 overflow-auto pr-1">
                  {selectedThemeDetail.occurrences.map((item) => (
                    <article key={item.occurrenceId} className="rounded-lg border border-accent bg-surface-strong p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-primary">{item.date} · {item.field}</p>
                        <span className="text-xs text-tertiary">{item.source} · {Math.round(Number(item.confidence || 0) * 100)}%</span>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap leading-6 text-strong">{item.evidence}</p>
                      <div className="mt-3 grid gap-2 text-xs leading-5 text-secondary md:grid-cols-2">
                        <p><span className="font-semibold text-strong">当日总结：</span>{item.summary || '未填写'}</p>
                        <p><span className="font-semibold text-strong">今日问题：</span>{item.problems || '未填写'}</p>
                        <p><span className="font-semibold text-strong">做得好的地方：</span>{item.wins || '未填写'}</p>
                        <p><span className="font-semibold text-strong">明日计划：</span>{item.tomorrowPlan || '未填写'}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-5 rounded-lg border border-line bg-surface-strong p-4">
              <h3 className="text-sm font-semibold text-primary">周期内错误密度</h3>
              <div className="mt-3 space-y-2">
                {errorThemeAnalysis.timeline.map((item) => (
                  <div key={item.date} className="grid grid-cols-[88px_1fr_40px] items-center gap-3 text-sm">
                    <span className="text-secondary">{item.date.slice(5)}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-inset">
                      <div className="h-full rounded-full bg-danger" style={{ width: `${Math.max(8, (item.count / maxTimelineCount) * 100)}%` }} />
                    </div>
                    <span className="text-right font-semibold text-strong">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <EmptyState title="错误主题库暂无数据" description="点击“手动开始规则整理”后，系统会把历史复盘里的共性错误写入主题库。" />
        )}
      </section>

      <div className="mt-5 card p-5">
        <h2 className="text-base font-semibold text-primary">完整复盘报告</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {sortedReviews.length ? sortedReviews.map((review) => {
            const score = getReviewAverageScore(review);
            const tone = getReviewTone(score);
            return (
              <article key={review.id} className={`rounded-lg border p-4 ${tone.className}`}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{review.date}</p>
                  <span className="rounded bg-surface-strong px-2 py-1 text-sm font-semibold">{score} 分 · {tone.label}</span>
                </div>
                <div className="mt-4 space-y-3 text-sm">
                  <section className="rounded-lg bg-surface-strong p-3">
                    <p className="font-semibold text-strong">今日总结</p>
                    <p className="mt-1 whitespace-pre-wrap leading-6 text-secondary">{review.summary || '未填写'}</p>
                  </section>
                  <section className="rounded-lg bg-surface-strong p-3">
                    <p className="font-semibold text-success">完成得好的地方</p>
                    <p className="mt-1 whitespace-pre-wrap leading-6 text-secondary">{review.wins || '未填写'}</p>
                  </section>
                  <section className="rounded-lg bg-surface-strong p-3">
                    <p className="font-semibold text-danger">今日问题</p>
                    <p className="mt-1 whitespace-pre-wrap leading-6 text-secondary">{review.problems || '未填写'}</p>
                  </section>
                  <section className="rounded-lg bg-surface-strong p-3">
                    <p className="font-semibold text-accent">明日改进计划</p>
                    <p className="mt-1 whitespace-pre-wrap leading-6 text-secondary">{review.tomorrowPlan || '未填写'}</p>
                  </section>
                </div>
              </article>
            );
          }) : <EmptyState title="还没有复盘记录" />}
        </div>
        {total ? (
          <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-sm text-secondary">
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
