import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Clipboard, Download, RefreshCw, Sparkles } from 'lucide-react';
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

function buildReportMarkdown(report: LearningReport) {
  const lines = [
    `# ${report.title}`,
    '',
    `- 类型：${kindLabel[report.kind]}`,
    `- 周期：${report.periodStart} 至 ${report.periodEnd}`,
    `- 生成时间：${new Date(report.generatedAt).toLocaleString()}`,
    '',
    '## 总览',
    '',
    `- 累计学习：${minutesToHoursText(report.summary.totalMinutes)}`,
    `- 学习天数：${report.summary.studyDays} 天`,
    `- 复盘数量：${report.summary.reviewCount} 篇`,
    `- 复盘均分：${report.summary.averageReviewScore ?? '暂无'}`,
    `- 任务完成：${report.summary.totalTasks ? `${report.summary.completedTasks}/${report.summary.totalTasks}` : '暂无'}`,
    `- 主要项目：${report.summary.topProject ? `${report.summary.topProject.name} ${minutesToHoursText(report.summary.topProject.minutes)}` : '暂无'}`,
    '',
    '## 本期摘要',
    '',
    ...report.highlights.map((item) => `- ${item}`),
    '',
    '## 建议',
    '',
    ...(report.suggestions.length ? report.suggestions.map((item) => `- ${item}`) : ['- 暂无自动建议']),
    '',
    '## 共性问题',
    '',
    ...(report.commonProblems?.length
      ? report.commonProblems.map((item) => `- ${item.label}：${item.count} 天提到，日期 ${item.dates.join('、')}`)
      : ['- 暂未识别到反复出现的问题']),
    '',
    '## 复盘摘录',
    '',
    ...(report.reviews.length
      ? report.reviews.map((review) => `### ${review.date}（${review.score}/10）\n\n- 总结：${review.summary || '未填写'}\n- 做得好：${review.wins || '未填写'}\n- 问题：${review.problems || '未填写'}\n- 下一步：${review.tomorrowPlan || '未填写'}`)
      : ['暂无复盘摘录']),
  ];
  return lines.join('\n');
}

function buildAiPrompt(report: LearningReport) {
  return [
    '你现在是我的学习复盘教练，请基于下面这份结构化学习报告，输出一份简洁但具体的 AI 总结：',
    '',
    '要求：',
    '1. 先判断本周期学习状态；',
    '2. 找出最值得继续保持的 3 件事；',
    '3. 找出最需要修正的 3 个问题；',
    '4. 给出下一周/下一月的行动计划；',
    '5. 不要泛泛鼓励，要引用报告里的数据和复盘内容。',
    '',
    buildReportMarkdown(report),
  ].join('\n');
}

function downloadTextFile(fileName: string, text: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

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
  const selectedReportMarkdown = useMemo(() => (selectedReport ? buildReportMarkdown(selectedReport) : ''), [selectedReport]);
  const selectedAiPrompt = useMemo(() => (selectedReport ? buildAiPrompt(selectedReport) : ''), [selectedReport]);

  const loadReports = async (preferred?: LearningReport) => {
    const result = await serverApi.getReports();
    queryClient.setQueryData(queryKeys.reports, result);
    const matched = preferred
      ? result.reports.find((report) => report.kind === preferred.kind && report.periodStart === preferred.periodStart && report.periodEnd === preferred.periodEnd)
      : null;
    setSelectedReportId(matched?.id ?? result.reports[0]?.id ?? null);
  };

  const generate = async (kind: LearningReport['kind'], period: 'current' | 'previous' = 'current') => {
    if (readOnly) return;
    setLoading(true);
    try {
      const result = await serverApi.generateReport(kind, period);
      await loadReports(result.report);
      setToast(`${period === 'current' ? '当前' : '上一'}${kindLabel[kind]}已刷新`);
    } catch {
      setToast('报告生成失败，请稍后重试');
    } finally {
      setLoading(false);
      window.setTimeout(() => setToast(''), 2200);
    }
  };

  const copyText = async (text: string, message: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setToast(message);
    window.setTimeout(() => setToast(''), 2200);
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
          <button className="btn btn-soft" disabled={readOnly || loading} onClick={() => void generate('weekly', 'previous')}>
            <RefreshCw size={16} />补生成上周
          </button>
          <button className="btn btn-soft" disabled={readOnly || loading} onClick={() => void generate('monthly', 'previous')}>
            <RefreshCw size={16} />补生成上月
          </button>
        </div>
        <p className="text-sm text-secondary">上一个完整周和上一个完整月会由服务器自动生成。</p>
      </div>

      {selectedReport ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="space-y-2">
              {reports.map((report) => (
                <button
                  key={report.id}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    selectedReport.id === report.id ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface-strong text-strong hover:border-line-strong'
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
                  <p className="flex items-center gap-2 text-sm font-semibold text-accent"><CalendarDays size={16} />{kindLabel[selectedReport.kind]}</p>
                  <h2 className="mt-1 text-xl font-semibold text-primary">{selectedReport.title}</h2>
                  <p className="mt-1 text-sm text-secondary">生成时间：{new Date(selectedReport.generatedAt).toLocaleString()}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-soft" onClick={() => void copyText(selectedReportMarkdown, '报告 Markdown 已复制')}>
                    <Clipboard size={16} />复制报告
                  </button>
                  <button className="btn btn-soft" onClick={() => downloadTextFile(`${selectedReport.periodStart}-${selectedReport.periodEnd}-${selectedReport.kind}.md`, selectedReportMarkdown)}>
                    <Download size={16} />下载 Markdown
                  </button>
                  <button className="btn btn-primary" onClick={() => void copyText(selectedAiPrompt, 'AI 总结提示词已复制')}>
                    <Sparkles size={16} />复制 AI 总结提示词
                  </button>
                </div>
              </div>

              <dl className="mt-5 grid gap-4 border-y border-line py-4 md:grid-cols-4">
                <div>
                  <dt className="text-xs font-semibold text-secondary">累计学习</dt>
                  <dd className="mt-1 text-lg font-semibold text-primary">{minutesToHoursText(selectedReport.summary.totalMinutes)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-secondary">学习天数</dt>
                  <dd className="mt-1 text-lg font-semibold text-primary">{selectedReport.summary.studyDays} 天</dd>
                  <p className="mt-1 text-xs text-secondary">学习日均 {minutesToHoursText(selectedReport.summary.averageStudyDayMinutes)}</p>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-secondary">复盘均分</dt>
                  <dd className="mt-1 text-lg font-semibold text-primary">{selectedReport.summary.averageReviewScore ? `${selectedReport.summary.averageReviewScore}/10` : '暂无'}</dd>
                  <p className="mt-1 text-xs text-secondary">{selectedReport.summary.reviewCount} 篇复盘</p>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-secondary">短期目标</dt>
                  <dd className="mt-1 text-lg font-semibold text-primary">{selectedReport.summary.totalTasks ? `${selectedReport.summary.completedTasks}/${selectedReport.summary.totalTasks}` : '暂无'}</dd>
                  <p className="mt-1 text-xs text-secondary">{selectedReport.summary.taskCompletionRate !== null ? `完成率 ${selectedReport.summary.taskCompletionRate}%` : '本周期无目标'}</p>
                </div>
              </dl>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="text-sm font-semibold text-primary">本期摘要</h3>
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-secondary">
                    {selectedReport.highlights.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-primary">共性错误总结</h3>
                  {selectedReport.commonProblems?.length ? (
                    <div className="mt-3 space-y-3">
                      {selectedReport.commonProblems.map((problem) => (
                        <article key={problem.id} className="rounded-lg border border-danger bg-danger-soft p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-danger">{problem.label}</p>
                            <span className="rounded bg-surface-strong px-2 py-1 text-xs font-semibold text-danger">{problem.count} 天提到</span>
                          </div>
                          <p className="mt-2 text-xs leading-5 text-danger">出现日期：{problem.dates.join('、')}</p>
                          <div className="mt-2 space-y-2">
                            {problem.examples.map((example) => (
                              <p key={`${example.date}-${example.field}-${example.text}`} className="rounded bg-surface-strong p-2 text-xs leading-5 text-secondary">
                                <span className="font-semibold text-strong">{example.date} · {example.field}：</span>{example.text}
                              </p>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg border border-line bg-surface-muted p-3 text-sm leading-6 text-secondary">
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-primary">AI 总结报告助手</h2>
                <p className="mt-1 text-sm text-secondary">这里会把报告整理成可直接交给 AI 的上下文，用于生成下一周期行动计划。</p>
              </div>
              <button className="btn btn-primary" onClick={() => void copyText(selectedAiPrompt, 'AI 总结提示词已复制')}>
                <Sparkles size={16} />复制提示词
              </button>
            </div>
            <textarea className="field mt-4 min-h-48 font-mono text-xs leading-5" readOnly value={selectedAiPrompt} />
          </section>

          <section className="mt-5 card p-5">
            <h2 className="text-base font-semibold text-primary">复盘摘录</h2>
            <div className="mt-4 space-y-3">
              {selectedReport.reviews.length ? selectedReport.reviews.map((review) => (
                <article key={review.date} className="rounded-lg border border-line bg-surface-strong p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-primary">{review.date}</h3>
                    <span className="rounded border border-line px-2 py-1 text-xs font-semibold text-secondary">{review.score}/10</span>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm leading-6 text-secondary md:grid-cols-2">
                    <p><span className="font-semibold text-strong">总结：</span>{review.summary || '未填写'}</p>
                    <p><span className="font-semibold text-strong">做得好：</span>{review.wins || '未填写'}</p>
                    <p><span className="font-semibold text-strong">问题：</span>{review.problems || '未填写'}</p>
                    <p><span className="font-semibold text-strong">下一步：</span>{review.tomorrowPlan || '未填写'}</p>
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
