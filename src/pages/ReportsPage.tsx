import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { ChartBox, MinutesBar, TrendLine } from '../components/Charts';
import { EmptyState } from '../components/EmptyState';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { serverApi, type LearningReport } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
import { useDashboardData } from '../hooks/useDashboardData';
import { minutesToHoursText } from '../utils/date';

const kindLabel: Record<LearningReport['kind'], string> = {
  weekly: '周报',
  monthly: '月报',
};

export function ReportsPage() {
  const { readOnly } = useDashboardData();
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);
  const { data } = useQuery({
    queryKey: queryKeys.reports,
    queryFn: serverApi.getReports,
    placeholderData: { reports: [] as LearningReport[] },
  });
  const reports = useMemo(() => data?.reports ?? [], [data?.reports]);

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? reports[0],
    [reports, selectedReportId],
  );

  const loadReports = async (preferred?: LearningReport) => {
    const result = await serverApi.getReports();
    queryClient.setQueryData(queryKeys.reports, result);
    const matched = preferred
      ? result.reports.find((report) => report.kind === preferred.kind && report.periodStart === preferred.periodStart && report.periodEnd === preferred.periodEnd)
      : null;
    setSelectedReportId(matched?.id ?? result.reports[0]?.id ?? null);
  };

  const generate = async (kind: LearningReport['kind']) => {
    if (readOnly) return;
    setLoading(true);
    try {
      const result = await serverApi.generateReport(kind, 'current');
      await loadReports(result.report);
      setToast(`${kindLabel[kind]}已刷新`);
    } catch {
      setToast('报告生成失败，请稍后重试');
    } finally {
      setLoading(false);
      window.setTimeout(() => setToast(''), 2200);
    }
  };

  return (
    <Page title="学习报告" subtitle="服务器自动生成周报和月报，沉淀每个阶段的学习记录。">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-soft" disabled={readOnly || loading} onClick={() => void generate('weekly')}>
            <RefreshCw size={16} />刷新本周周报
          </button>
          <button className="btn btn-soft" disabled={readOnly || loading} onClick={() => void generate('monthly')}>
            <RefreshCw size={16} />刷新本月月报
          </button>
        </div>
        <p className="text-sm text-slate-500">上一个完整周和上一个完整月会由服务器自动生成。</p>
      </div>

      {selectedReport ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="space-y-2">
              {reports.map((report) => (
                <button
                  key={report.id}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    selectedReport.id === report.id ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                  onClick={() => setSelectedReportId(report.id ?? null)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{kindLabel[report.kind]}</span>
                    <span className="text-xs opacity-70">{report.trigger === 'auto' ? '自动' : '手动'}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm">{report.title}</p>
                  <p className="mt-1 text-xs opacity-70">{new Date(report.generatedAt).toLocaleString()}</p>
                </button>
              ))}
            </div>

            <section className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-blue-700"><CalendarDays size={16} />{kindLabel[selectedReport.kind]}</p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-950">{selectedReport.title}</h2>
                  <p className="mt-1 text-sm text-slate-500">生成时间：{new Date(selectedReport.generatedAt).toLocaleString()}</p>
                </div>
              </div>

              <dl className="mt-5 grid gap-4 border-y border-slate-100 py-4 md:grid-cols-4">
                <div>
                  <dt className="text-xs font-semibold text-slate-500">累计学习</dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-950">{minutesToHoursText(selectedReport.summary.totalMinutes)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">学习天数</dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-950">{selectedReport.summary.studyDays} 天</dd>
                  <p className="mt-1 text-xs text-slate-500">学习日均 {minutesToHoursText(selectedReport.summary.averageStudyDayMinutes)}</p>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">复盘均分</dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-950">{selectedReport.summary.averageReviewScore ? `${selectedReport.summary.averageReviewScore}/10` : '暂无'}</dd>
                  <p className="mt-1 text-xs text-slate-500">{selectedReport.summary.reviewCount} 篇复盘</p>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">短期目标</dt>
                  <dd className="mt-1 text-lg font-semibold text-slate-950">{selectedReport.summary.totalTasks ? `${selectedReport.summary.completedTasks}/${selectedReport.summary.totalTasks}` : '暂无'}</dd>
                  <p className="mt-1 text-xs text-slate-500">{selectedReport.summary.taskCompletionRate !== null ? `完成率 ${selectedReport.summary.taskCompletionRate}%` : '本周期无目标'}</p>
                </div>
              </dl>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">本期摘要</h3>
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
                    {selectedReport.highlights.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">共性错误总结</h3>
                  {selectedReport.commonProblems?.length ? (
                    <div className="mt-3 space-y-3">
                      {selectedReport.commonProblems.map((problem) => (
                        <article key={problem.id} className="rounded-lg border border-rose-100 bg-rose-50/60 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-rose-800">{problem.label}</p>
                            <span className="rounded bg-white/80 px-2 py-1 text-xs font-semibold text-rose-700">{problem.count} 天提到</span>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-rose-700">出现日期：{problem.dates.join('、')}</p>
                          <div className="mt-2 space-y-2">
                            {problem.examples.map((example) => (
                              <p key={`${example.date}-${example.field}-${example.text}`} className="rounded bg-white/80 p-2 text-xs leading-5 text-slate-600">
                                <span className="font-semibold text-slate-800">{example.date} · {example.field}：</span>{example.text}
                              </p>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-500">
                      本周期未识别到反复出现的共性问题。刷新报告后会按复盘文字重新统计。
                    </p>
                  )}
                </div>
              </div>
            </section>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <ChartBox title="每日学习趋势">
              <TrendLine data={selectedReport.dailyTotals} />
            </ChartBox>
            <ChartBox title="项目累计用时">
              {selectedReport.projectTotals.length ? <MinutesBar data={selectedReport.projectTotals} denseLabels /> : <EmptyState title="暂无项目用时" />}
            </ChartBox>
          </div>

          <section className="mt-5 card p-5">
            <h2 className="text-base font-semibold text-slate-900">复盘摘录</h2>
            <div className="mt-4 space-y-3">
              {selectedReport.reviews.length ? selectedReport.reviews.map((review) => (
                <article key={review.date} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-slate-900">{review.date}</h3>
                    <span className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">{review.score}/10</span>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm leading-6 text-slate-600 md:grid-cols-2">
                    <p><span className="font-semibold text-slate-800">总结：</span>{review.summary || '未填写'}</p>
                    <p><span className="font-semibold text-slate-800">做得好：</span>{review.wins || '未填写'}</p>
                    <p><span className="font-semibold text-slate-800">问题：</span>{review.problems || '未填写'}</p>
                    <p><span className="font-semibold text-slate-800">下一步：</span>{review.tomorrowPlan || '未填写'}</p>
                  </div>
                </article>
              )) : <EmptyState title="本周期没有复盘记录" />}
            </div>
          </section>
        </>
      ) : (
        <EmptyState title="还没有学习报告" description="服务器会自动生成上一个完整周和上一个完整月的报告，也可以点击上方按钮手动生成当前周期报告。" />
      )}
      <Toast message={toast} />
    </Page>
  );
}
