import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Archive, DatabaseBackup, FileWarning, RefreshCw, RotateCcw, ShieldCheck, UsersRound } from 'lucide-react';
import { ChartBox, TrendLine } from '../components/Charts';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { serverApi } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
import { useDashboardData } from '../hooks/useDashboardData';
import { confirmAction } from '../utils/confirm';

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '暂无';
}

export function OperationsPage() {
  const { readOnly } = useDashboardData();
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState('');
  const [selectedBackup, setSelectedBackup] = useState('');
  const backupQuery = useQuery({ queryKey: ['server', 'backups', 'status'], queryFn: serverApi.getBackupStatus });
  const visitsQuery = useQuery({ queryKey: queryKeys.visitStats, queryFn: serverApi.getVisitStats });
  const logsQuery = useQuery({ queryKey: queryKeys.opsLogs, queryFn: serverApi.getOpsLogsSummary, refetchInterval: 60_000 });

  const visitTrend = useMemo(() => (visitsQuery.data?.daily ?? []).map((item) => ({ date: item.date, minutes: item.visits })), [visitsQuery.data?.daily]);

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['server', 'backups', 'status'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.visitStats }),
      queryClient.invalidateQueries({ queryKey: queryKeys.opsLogs }),
    ]);
  };

  const runBackup = async () => {
    if (readOnly) return;
    setBusy('backup');
    try {
      await serverApi.runServerBackup();
      await refreshAll();
      setToast('服务器备份已创建');
    } catch (error) {
      setToast(error instanceof Error ? error.message : '备份失败');
    } finally {
      setBusy('');
      window.setTimeout(() => setToast(''), 2400);
    }
  };

  const restoreBackup = async () => {
    if (readOnly || !selectedBackup) return;
    const confirmed = confirmAction({
      title: '确认恢复备份',
      message: `确认恢复备份 ${selectedBackup}？服务器会先自动创建恢复前安全备份。`,
      danger: true,
    });
    if (!confirmed) return;
    setBusy('restore');
    try {
      await serverApi.restoreServerBackup(selectedBackup);
      await refreshAll();
      setToast('备份已恢复，建议刷新页面确认数据');
    } catch (error) {
      setToast(error instanceof Error ? error.message : '恢复失败');
    } finally {
      setBusy('');
      window.setTimeout(() => setToast(''), 3200);
    }
  };

  return (
    <Page title="运维观察台" subtitle="集中查看备份、访问统计和服务日志，适合上线后日常巡检。">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="备份数量" value={`${backupQuery.data?.backupCount ?? 0} 个`} hint={`SQLite ${formatBytes(backupQuery.data?.sqliteSizeBytes ?? 0)}`} icon={<DatabaseBackup size={20} />} />
        <MetricCard label="今日访问" value={visitsQuery.data?.today ?? 0} hint={`近 7 天 ${visitsQuery.data?.last7 ?? 0} 次`} icon={<UsersRound size={20} />} />
        <MetricCard label="近 7 天访客" value={visitsQuery.data?.uniqueVisitors7 ?? 0} hint="按 IP 与浏览器指纹哈希去重" icon={<Activity size={20} />} />
        <MetricCard label="日志源" value={`${logsQuery.data?.sources.filter((source) => source.available).length ?? 0}/${logsQuery.data?.sources.length ?? 0}`} hint={logsQuery.isFetching ? '正在刷新' : '每分钟自动刷新'} icon={<FileWarning size={20} />} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="慢/错接口记录" value={logsQuery.data?.apiMetrics?.logged ?? 0} hint={`服务端错误 ${logsQuery.data?.apiMetrics?.serverErrors ?? 0} 次`} icon={<FileWarning size={20} />} />
        <MetricCard label="平均接口耗时" value={logsQuery.data?.apiMetrics?.averageDurationMs == null ? '--' : `${logsQuery.data.apiMetrics.averageDurationMs}ms`} hint={`最长 ${logsQuery.data?.apiMetrics?.maxDurationMs ?? '--'}ms`} icon={<Activity size={20} />} />
        <MetricCard label="客户端错误" value={logsQuery.data?.apiMetrics?.clientErrors ?? 0} hint="4xx 请求计数" icon={<ShieldCheck size={20} />} />
        <MetricCard label="观测生成时间" value={logsQuery.data?.generatedAt ? new Date(logsQuery.data.generatedAt).toLocaleTimeString() : '--'} hint="来自 Repository 汇总接口" icon={<RefreshCw size={20} />} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.15fr]">
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">备份管理</h2>
              <p className="mt-1 text-sm text-slate-500">支持手动快照、查看历史备份，并在确认后恢复指定备份。</p>
            </div>
            <button className="btn btn-primary" disabled={readOnly || busy === 'backup'} onClick={() => void runBackup()}>
              <Archive size={16} />立即备份
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">最近备份</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{formatDateTime(backupQuery.data?.lastBackup?.createdAt)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">词典索引</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{backupQuery.data?.dictionaryCount ?? 0} 条</p>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            {(backupQuery.data?.backups ?? []).slice(0, 8).map((backup) => (
              <label key={backup.fileName} className="grid cursor-pointer grid-cols-[24px_1fr_90px] items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                <input type="radio" name="backup-file" value={backup.fileName} checked={selectedBackup === backup.fileName} onChange={() => setSelectedBackup(backup.fileName)} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-800">{backup.fileName}</span>
                  <span className="text-xs text-slate-500">{backup.kind} · {formatDateTime(backup.createdAt)}</span>
                </span>
                <span className="text-right text-xs text-slate-500">{formatBytes(backup.sizeBytes)}</span>
              </label>
            ))}
            {backupQuery.data?.backups.length ? null : <div className="p-4"><EmptyState title="暂无备份文件" /></div>}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs leading-5 text-slate-500">恢复会先创建 pre-restore 安全备份；仍建议只在确认数据异常时使用。</p>
            <button className="btn btn-danger" disabled={readOnly || !selectedBackup || busy === 'restore'} onClick={() => void restoreBackup()}>
              <RotateCcw size={16} />恢复所选备份
            </button>
          </div>
        </section>

        <ChartBox title="近 14 天访问趋势">
          {visitTrend.some((item) => item.minutes > 0) ? <TrendLine data={visitTrend} label="访问" /> : <EmptyState title="暂无访问统计" />}
        </ChartBox>
      </div>

      <section className="mt-5 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">访问入口</h2>
            <p className="mt-1 text-sm text-slate-500">仅保存路径、角色、脱敏访客哈希和浏览器摘要，不保存明文 IP。</p>
          </div>
          <button className="btn btn-soft" onClick={() => void refreshAll()}>
            <RefreshCw size={16} />刷新
          </button>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-slate-200">
            {(visitsQuery.data?.topPaths ?? []).map((item) => (
              <div key={item.path} className="grid grid-cols-[1fr_80px] border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                <span className="truncate text-slate-800">{item.path}</span>
                <span className="text-right font-semibold text-slate-900">{item.visits}</span>
              </div>
            ))}
            {visitsQuery.data?.topPaths.length ? null : <div className="p-4"><EmptyState title="暂无访问路径" /></div>}
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            {(visitsQuery.data?.latest ?? []).map((item) => (
              <div key={`${item.createdAt}-${item.path}`} className="border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{item.path}</span>
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{item.role}</span>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">{formatDateTime(item.createdAt)} · {item.userAgent}</p>
              </div>
            ))}
            {visitsQuery.data?.latest.length ? null : <div className="p-4"><EmptyState title="暂无最近访问" /></div>}
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">高风险操作审计</h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            {(logsQuery.data?.auditEvents ?? []).map((event) => (
              <div key={`${event.createdAt}-${event.action}`} className="border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{event.action}</span>
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{event.actorRole || 'system'}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(event.createdAt)}</p>
              </div>
            ))}
            {logsQuery.data?.auditEvents?.length ? null : <div className="p-4"><EmptyState title="暂无审计记录" /></div>}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">慢接口 / 错误接口</h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            {(logsQuery.data?.slowApi ?? []).map((item) => (
              <div key={`${item.createdAt}-${item.method}-${item.path}`} className="border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-slate-900">{item.method} {item.path}</span>
                  <span className="text-xs text-slate-500">{item.durationMs}ms</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{item.statusCode} · {formatDateTime(item.createdAt)}</p>
                {item.error ? <p className="mt-1 truncate text-xs text-rose-600">{item.error}</p> : null}
              </div>
            ))}
            {logsQuery.data?.slowApi?.length ? null : <div className="p-4"><EmptyState title="暂无慢接口记录" /></div>}
          </div>
        </div>
      </section>

      <section className="mt-5 card p-5">
        <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <ShieldCheck size={18} />
          服务日志摘要
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          {(logsQuery.data?.sources ?? []).map((source) => (
            <article key={source.name} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{source.name}</h3>
                <span className={`rounded-lg border px-2 py-1 text-xs font-semibold ${source.available ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                  {source.available ? '可用' : '不可用'}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">错误 {source.errorCount} · 警告 {source.warningCount}</p>
              {source.error ? <p className="mt-2 rounded bg-white p-2 text-xs text-amber-700">{source.error}</p> : null}
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-white p-3 text-xs leading-5 text-slate-700">{source.lines.slice(-16).join('\n') || '暂无日志'}</pre>
            </article>
          ))}
        </div>
      </section>

      <Toast message={toast} />
    </Page>
  );
}
