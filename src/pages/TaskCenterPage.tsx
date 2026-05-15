import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Archive, BarChart3, Cpu, Download, HardDrive, RefreshCw, Sparkles } from 'lucide-react';
import { Page } from '../components/Page';
import { EmptyState } from '../components/EmptyState';
import { Toast } from '../components/Toast';
import { serverApi } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
import { usePwaInstall } from '../hooks/usePwaInstall';

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '暂无';
  return new Date(value).toLocaleString();
}

function formatHours(seconds = 0) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
}

function statusTone(status?: string | null) {
  if (status === 'running' || status === 'queued') return 'border-blue-200 bg-blue-50 text-blue-700';
  if (status === 'failed') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

export function TaskCenterPage() {
  const [toast, setToast] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const { canInstall, installed, install, secureContext } = usePwaInstall();
  const { data: status, isFetching } = useQuery({
    queryKey: queryKeys.taskCenter,
    queryFn: serverApi.getTaskCenterStatus,
    refetchInterval: (query) => {
      const jobStatus = query.state.data?.errorThemes.job?.status;
      return jobStatus === 'queued' || jobStatus === 'running' ? 5000 : 30000;
    },
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.taskCenter });
  };

  const runAction = async (name: string, action: () => Promise<unknown>, success: string) => {
    if (status?.readOnly) return;
    setBusyAction(name);
    try {
      await action();
      await refresh();
      setToast(success);
    } catch {
      setToast('操作失败，请稍后重试');
    } finally {
      setBusyAction('');
      window.setTimeout(() => setToast(''), 2400);
    }
  };

  const installApp = async () => {
    const accepted = await install();
    setToast(accepted ? '已开始安装桌面应用' : '浏览器暂时没有安装');
    window.setTimeout(() => setToast(''), 2200);
  };

  return (
    <Page title="后台任务中心" subtitle="查看备份、报告、规则整理和服务器资源状态。">
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-500">服务状态</p>
            <Activity size={18} className={isFetching ? 'animate-pulse text-blue-600' : 'text-emerald-600'} />
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-950">运行中</p>
          <p className="mt-2 text-sm text-slate-500">系统已运行 {formatHours(status?.runtime.uptimeSeconds ?? 0)}</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-500">CPU 负载</p>
            <Cpu size={18} className="text-slate-500" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{status?.runtime.loadAverage?.[0]?.toFixed(2) ?? '--'}</p>
          <p className="mt-2 text-sm text-slate-500">{status?.runtime.cpuCount ?? '--'} 核心，CPU 仍有余量</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-500">内存</p>
            <BarChart3 size={18} className="text-slate-500" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{formatBytes(status?.runtime.memory.processRssBytes ?? 0)}</p>
          <p className="mt-2 text-sm text-slate-500">可用 {formatBytes(status?.runtime.memory.freeBytes ?? 0)}</p>
        </div>
        <div className="card p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-500">磁盘</p>
            <HardDrive size={18} className="text-slate-500" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{status?.runtime.disk?.usedPercent ?? '--'}</p>
          <p className="mt-2 text-sm text-slate-500">剩余 {formatBytes(status?.runtime.disk?.availableBytes ?? 0)}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">备份任务</h2>
              <p className="mt-1 text-sm text-slate-500">每周自动备份，也可以手动创建安全快照。</p>
            </div>
            <button
              className="btn btn-soft"
              disabled={status?.readOnly || busyAction === 'backup'}
              onClick={() => void runAction('backup', serverApi.runServerBackup, '服务器备份已创建')}
            >
              <Archive size={16} />立即备份
            </button>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs font-semibold text-slate-500">最近备份</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800">{formatDateTime(status?.backup.lastBackup?.createdAt)}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs font-semibold text-slate-500">下次周备份</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800">{formatDateTime(status?.backup.nextWeeklyBackupAt)}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs font-semibold text-slate-500">备份数量</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800">{status?.backup.backupCount ?? '--'} 个</dd>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <dt className="text-xs font-semibold text-slate-500">SQLite 大小</dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800">{formatBytes(status?.backup.sqliteSizeBytes ?? 0)}</dd>
            </div>
          </dl>
        </section>

        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">周报 / 月报</h2>
              <p className="mt-1 text-sm text-slate-500">手动生成会使用最新的错误主题库结果。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-soft" disabled={status?.readOnly || busyAction === 'weekly'} onClick={() => void runAction('weekly', () => serverApi.generateReport('weekly'), '周报已刷新')}>
                生成周报
              </button>
              <button className="btn btn-soft" disabled={status?.readOnly || busyAction === 'monthly'} onClick={() => void runAction('monthly', () => serverApi.generateReport('monthly'), '月报已刷新')}>
                生成月报
              </button>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">最近周报</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{status?.reports.latestWeeklyReport?.title ?? '暂无'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500">最近月报</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">{status?.reports.latestMonthlyReport?.title ?? '暂无'}</p>
            </div>
          </div>
        </section>
      </div>

      <section className="mt-5 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">规则分类与错误主题库</h2>
            <p className="mt-1 text-sm text-slate-500">夜间 3 点自动按规则整理，也可以手动刷新错误主题库。</p>
          </div>
          <button
            className="btn btn-primary"
            disabled={status?.readOnly || Boolean(status?.errorThemes.job && ['queued', 'running'].includes(status.errorThemes.job.status)) || busyAction === 'rules'}
            onClick={() => void runAction('rules', () => serverApi.runErrorThemeBatch(undefined, undefined, 'rules'), '规则整理已进入后台')}
          >
            <Sparkles size={16} />启动规则整理
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className={`rounded-lg border p-3 ${statusTone(status?.errorThemes.job?.status)}`}>
            <p className="text-xs font-semibold opacity-80">后台任务</p>
            <p className="mt-1 text-sm font-semibold">{status?.errorThemes.job?.status ?? '空闲'}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">下次夜间整理</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{formatDateTime(status?.errorThemes.nextNightlyBatchAt)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">纠错样本</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{status?.errorThemes.correctionCount ?? 0} 条</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">向量缓存</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{status?.embedding.embeddingRows ?? 0} 条</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          当前策略：规则分类；备用模型：{status?.embedding.smallModelName ?? status?.embedding.modelName ?? '--'}；最近批处理：
          {status?.errorThemes.latestBatch
            ? `${formatDateTime(status.errorThemes.latestBatch.completedAt)}，${status.errorThemes.latestBatch.status}，${status.errorThemes.latestBatch.occurrenceCount} 条证据`
            : '暂无'}。
        </p>
      </section>

      <section className="mt-5 card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">桌面应用</h2>
            <p className="mt-1 text-sm text-slate-500">安装后可以像本地软件一样从桌面或开始菜单打开。</p>
          </div>
          <button className="btn btn-soft" disabled={!canInstall || installed} onClick={() => void installApp()}>
            <Download size={16} />{installed ? '已安装' : '安装到桌面'}
          </button>
        </div>
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
          {secureContext ? (
            canInstall || installed ? '浏览器已经允许安装。若按钮不可用，说明当前设备已经安装或浏览器暂未触发安装提示。' : 'PWA 文件已就绪，浏览器可能需要你访问几次后才显示安装入口。'
          ) : (
            '当前访问不是安全上下文。用服务器 IP 的 HTTP 访问时，浏览器通常不会开放真正的 PWA 安装；绑定域名并启用 HTTPS 后即可使用安装按钮。'
          )}
        </div>
      </section>

      {!status ? <div className="mt-5"><EmptyState title="正在读取后台状态" /></div> : null}
      <Toast message={toast} />
      <button className="fixed bottom-5 right-5 rounded-full border border-slate-200 bg-white p-3 text-slate-600 shadow-lg hover:text-blue-700" onClick={() => void refresh()} aria-label="刷新后台状态">
        <RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} />
      </button>
    </Page>
  );
}
