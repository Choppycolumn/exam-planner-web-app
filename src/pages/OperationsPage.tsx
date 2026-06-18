import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Archive, Bell, Clock3, Database, FileWarning, HardDrive, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
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

function formatDuration(ms?: number | null) {
  return ms == null ? '--' : `${Math.round(ms / 100) / 10}s`;
}

function statusTone(ok: boolean) {
  return ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700';
}

function taskStatusTone(status?: string | null) {
  if (status === 'running' || status === 'queued') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (status === 'failed') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export function OperationsPage() {
  const { readOnly } = useDashboardData();
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState('');
  const [selectedBackup, setSelectedBackup] = useState('');

  const taskQuery = useQuery({
    queryKey: queryKeys.taskCenter,
    queryFn: serverApi.getTaskCenterStatus,
    refetchInterval: (query) => {
      const jobStatus = query.state.data?.errorThemes.job?.status;
      return jobStatus === 'queued' || jobStatus === 'running' ? 5000 : 30000;
    },
  });
  const visitsQuery = useQuery({ queryKey: queryKeys.visitStats, queryFn: serverApi.getVisitStats, refetchInterval: 60_000 });
  const logsQuery = useQuery({ queryKey: queryKeys.opsLogs, queryFn: serverApi.getOpsLogsSummary, refetchInterval: 60_000 });
  const notificationsQuery = useQuery({ queryKey: queryKeys.notifications('all'), queryFn: () => serverApi.getNotificationCenter('all'), refetchInterval: 60_000 });

  const status = taskQuery.data;
  const logs = logsQuery.data;
  const notifications = notificationsQuery.data;
  const unifiedHealth = status?.unifiedHealth;
  const wechatReady = Boolean(notifications?.wechatClawbot?.enabled && notifications.wechatClawbot.configured && notifications.wechatClawbot.targetConfigured && notifications.wechatClawbot.hasContextToken);
  const diskAvailable = status?.runtime.disk?.availableBytes ?? 0;
  const diskOk = !status?.runtime.disk || diskAvailable >= 2 * 1024 * 1024 * 1024;
  const taskOk = (status?.tasks?.metrics?.failed ?? 0) === 0 && !(status?.maintenance.lastError || status?.maintenance.lastPrecomputeError);
  const logOk = (logs?.apiMetrics?.serverErrors ?? 0) === 0 && (logs?.sources ?? []).every((source) => source.errorCount === 0);
  const briefOk = !status?.dailyBrief.latest || status.dailyBrief.latest.status !== 'failed';

  const visitTrend = useMemo(() => (visitsQuery.data?.daily ?? []).map((item) => ({ date: item.date, minutes: item.visits })), [visitsQuery.data?.daily]);

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.taskCenter }),
      queryClient.invalidateQueries({ queryKey: queryKeys.visitStats }),
      queryClient.invalidateQueries({ queryKey: queryKeys.opsLogs }),
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications('all') }),
    ]);
  };

  const runAction = async (name: string, action: () => Promise<unknown>, success: string) => {
    if (readOnly || status?.readOnly) return;
    setBusy(name);
    try {
      await action();
      await refreshAll();
      setToast(success);
    } catch (error) {
      setToast(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy('');
      window.setTimeout(() => setToast(''), 2600);
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
    await runAction('restore', () => serverApi.restoreServerBackup(selectedBackup), '备份已恢复，建议刷新页面确认数据');
  };

  const healthItems = [
    { label: '网站服务', ok: Boolean(status), detail: status ? `运行 ${Math.floor((status.runtime.uptimeSeconds ?? 0) / 3600)} 小时` : '状态读取中' },
    { label: 'SQLite', ok: Boolean(status?.backup.sqliteSizeBytes), detail: `数据库 ${formatBytes(status?.backup.sqliteSizeBytes ?? 0)}` },
    { label: '磁盘空间', ok: diskOk, detail: status?.runtime.disk ? `剩余 ${formatBytes(diskAvailable)}，已用 ${status.runtime.disk.usedPercent}` : '未读取到磁盘信息' },
    { label: '微信推送', ok: wechatReady, detail: wechatReady ? `下次简报 ${formatDateTime(notifications?.wechatClawbot?.nextPushAt)}` : 'ClawBot 微信链路需检查' },
    { label: '每日简报', ok: briefOk, detail: status?.dailyBrief.latest ? `${status.dailyBrief.latest.date} · ${status.dailyBrief.latest.status}` : '暂无简报' },
    { label: '后台任务', ok: taskOk, detail: `失败 ${status?.tasks?.metrics?.failed ?? 0} 次，运行中 ${status?.tasks?.metrics?.running ?? 0}` },
    { label: '日志健康', ok: logOk, detail: `5xx ${logs?.apiMetrics?.serverErrors ?? 0} 次，日志源 ${logs?.sources.filter((source) => source.available).length ?? 0}/${logs?.sources.length ?? 0}` },
    { label: '访问入口', ok: Boolean(visitsQuery.data), detail: `今日 ${visitsQuery.data?.today ?? 0} 次，近 7 天 ${visitsQuery.data?.last7 ?? 0} 次` },
  ];

  return (
    <Page title="运维与健康中心" subtitle="一个地方确认网站、任务、备份、通知和日志是否正常。">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-soft" onClick={() => void refreshAll()}>
            <RefreshCw size={16} className={taskQuery.isFetching || logsQuery.isFetching || visitsQuery.isFetching ? 'animate-spin' : ''} />刷新
          </button>
          <button className="btn btn-soft" disabled={readOnly || busy === 'backup'} onClick={() => void runAction('backup', serverApi.runServerBackup, '服务器备份已创建')}>
            <Archive size={16} />立即备份
          </button>
          <button className="btn btn-soft" disabled={readOnly || busy === 'wechat'} onClick={() => void runAction('wechat', serverApi.testWechatNotification, '微信测试推送已发送')}>
            <Bell size={16} />测试微信
          </button>
        </div>
        <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600">
          更新时间 {formatDateTime(status?.generatedAt ?? logs?.generatedAt)}
        </span>
      </div>

      <section className={`mt-5 rounded-lg border p-5 ${unifiedHealth?.status === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-800' : unifiedHealth?.status === 'degraded' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold opacity-75">统一健康状态</p>
            <h2 className="mt-1 text-lg font-semibold">{unifiedHealth?.status === 'failed' ? '故障' : unifiedHealth?.status === 'degraded' ? '降级' : '正常'}</h2>
            <p className="mt-1 text-sm opacity-85">{unifiedHealth?.summary || '正在汇总关键服务状态'}</p>
          </div>
          {unifiedHealth?.status === 'normal' ? <ShieldCheck size={24} /> : <AlertTriangle size={24} />}
        </div>
        {unifiedHealth?.actions?.length ? (
          <div className="mt-4 space-y-2">
            {unifiedHealth.actions.map((item) => (
              <div key={item.id} className="rounded-lg border border-current/20 bg-white/70 px-3 py-2 text-sm">
                <span className="font-semibold">{item.title}：</span>{item.action}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {healthItems.map((item) => (
          <article key={item.label} className={`rounded-lg border p-4 ${statusTone(item.ok)}`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">{item.label}</h2>
              {item.ok ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
            </div>
            <p className="mt-2 text-sm opacity-90">{item.detail}</p>
          </article>
        ))}
      </section>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="CPU 负载" value={status?.runtime.loadAverage?.[0]?.toFixed(2) ?? '--'} hint={`${status?.runtime.cpuCount ?? '--'} 核心`} icon={<Activity size={20} />} />
        <MetricCard label="进程内存" value={formatBytes(status?.runtime.memory.processRssBytes ?? 0)} hint={`可用 ${formatBytes(status?.runtime.memory.freeBytes ?? 0)}`} icon={<HardDrive size={20} />} />
        <MetricCard label="任务运行" value={status?.tasks?.metrics?.total ?? 0} hint={`近 24 小时 ${status?.tasks?.metrics?.last24h ?? 0} 次`} icon={<Clock3 size={20} />} />
        <MetricCard label="慢/错接口" value={logs?.apiMetrics?.logged ?? 0} hint={`平均 ${logs?.apiMetrics?.averageDurationMs ?? '--'}ms`} icon={<FileWarning size={20} />} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">备份与恢复</h2>
              <p className="mt-1 text-sm text-slate-500">保留恢复入口，但恢复前必须确认。</p>
            </div>
            <button className="btn btn-primary" disabled={readOnly || busy === 'backup'} onClick={() => void runAction('backup', serverApi.runServerBackup, '服务器备份已创建')}>
              <Archive size={16} />立即备份
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">最近备份</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{formatDateTime(status?.backup.lastBackup?.createdAt)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">最近校验</p>
              <p className={`mt-1 text-sm font-semibold ${status?.backup.latestVerification?.ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                {status?.backup.latestVerification?.ok ? '通过' : '待处理'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">下次日备份</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{formatDateTime(status?.backup.nextDailyBackupAt)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">下次周备份</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{formatDateTime(status?.backup.nextWeeklyBackupAt)}</p>
            </div>
          </div>
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            {(status?.backup.backups ?? []).slice(0, 8).map((backup) => (
              <label key={backup.fileName} className="grid cursor-pointer grid-cols-[24px_1fr_90px] items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                <input type="radio" name="backup-file" value={backup.fileName} checked={selectedBackup === backup.fileName} onChange={() => setSelectedBackup(backup.fileName)} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-800">{backup.fileName}</span>
                  <span className="text-xs text-slate-500">{backup.kind} · {formatDateTime(backup.createdAt)}</span>
                </span>
                <span className="text-right text-xs text-slate-500">{formatBytes(backup.sizeBytes)}</span>
              </label>
            ))}
            {status?.backup.backups.length ? null : <div className="p-4"><EmptyState title="暂无备份文件" /></div>}
          </div>
          <div className="mt-4 flex justify-end">
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
            <h2 className="text-base font-semibold text-slate-900">后台任务</h2>
            <p className="mt-1 text-sm text-slate-500">备份、报告、简报、预计算和维护任务都会在这里留下状态。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-soft" disabled={readOnly || busy === 'precompute'} onClick={() => void runAction('precompute', serverApi.runPrecompute, '预计算已完成')}>
              <RefreshCw size={16} />预计算
            </button>
            <button className="btn btn-soft" disabled={readOnly || busy === 'sqlite'} onClick={() => void runAction('sqlite', serverApi.runSqliteMaintenance, 'SQLite 维护已完成')}>
              <Database size={16} />SQLite 维护
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">总运行</p>
            <p className="mt-1 text-lg font-semibold text-slate-950">{status?.tasks?.metrics?.total ?? 0}</p>
          </div>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-emerald-700">
            <p className="text-xs font-semibold opacity-80">成功</p>
            <p className="mt-1 text-lg font-semibold">{status?.tasks?.metrics?.completed ?? 0}</p>
          </div>
          <div className="rounded-lg border border-rose-100 bg-rose-50 p-3 text-rose-700">
            <p className="text-xs font-semibold opacity-80">失败</p>
            <p className="mt-1 text-lg font-semibold">{status?.tasks?.metrics?.failed ?? 0}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">平均耗时</p>
            <p className="mt-1 text-lg font-semibold text-slate-950">{formatDuration(status?.tasks?.metrics?.averageDurationMs)}</p>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
          {(status?.tasks?.latestRuns ?? []).map((task) => (
            <div key={task.id} className="grid gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0 md:grid-cols-[1fr_90px_150px_90px]">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{task.taskName}</p>
                {task.error ? <p className="mt-1 truncate text-xs text-rose-600">{task.error}</p> : null}
              </div>
              <span className={`w-fit rounded-lg border px-2 py-1 text-xs font-semibold ${taskStatusTone(task.status)}`}>{task.status}</span>
              <span className="text-xs text-slate-500">{formatDateTime(task.startedAt)}</span>
              <span className="text-xs text-slate-500">{formatDuration(task.durationMs)}</span>
            </div>
          ))}
          {status?.tasks?.latestRuns?.length ? null : <div className="p-4"><EmptyState title="暂无后台任务记录" /></div>}
        </div>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">慢接口 / 错误接口</h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            {(logs?.slowApi ?? []).map((item) => (
              <div key={`${item.createdAt}-${item.method}-${item.path}`} className="border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-slate-900">{item.method} {item.path}</span>
                  <span className="text-xs text-slate-500">{item.durationMs}ms</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{item.statusCode} · {formatDateTime(item.createdAt)}</p>
                {item.error ? <p className="mt-1 truncate text-xs text-rose-600">{item.error}</p> : null}
              </div>
            ))}
            {logs?.slowApi?.length ? null : <div className="p-4"><EmptyState title="暂无慢接口记录" /></div>}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="text-base font-semibold text-slate-900">最近访问</h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            {(visitsQuery.data?.latest ?? []).map((item) => (
              <div key={`${item.createdAt}-${item.path}`} className="border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-slate-900">{item.path}</span>
                  <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{item.role}</span>
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">{formatDateTime(item.createdAt)} · {item.userAgent}</p>
              </div>
            ))}
            {visitsQuery.data?.latest.length ? null : <div className="p-4"><EmptyState title="暂无最近访问" /></div>}
          </div>
        </div>
      </section>

      <section className="mt-5 card p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900"><FileWarning size={18} />服务日志摘要</h2>
        <div className="mt-4 grid gap-4 xl:grid-cols-3">
          {(logs?.sources ?? []).map((source) => (
            <article key={source.name} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900">{source.name}</h3>
                <span className={`rounded-lg border px-2 py-1 text-xs font-semibold ${source.available ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                  {source.available ? '可用' : '不可用'}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500">错误 {source.errorCount} · 警告 {source.warningCount}</p>
              {source.action ? <p className="mt-3 rounded bg-white p-3 text-xs font-medium text-slate-700">{source.action}</p> : <p className="mt-3 text-xs font-medium text-emerald-700">无需处理</p>}
            </article>
          ))}
        </div>
      </section>

      {!status ? <div className="mt-5"><EmptyState title="正在读取运维状态" /></div> : null}
      <Toast message={toast} />
    </Page>
  );
}
