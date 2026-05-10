import { Cloud, Download, Hourglass, RotateCcw, ShieldCheck, Trash2, UploadCloud } from 'lucide-react';
import { Page } from '../components/Page';
import { MetricCard } from '../components/MetricCard';
import { useAppData } from '../hooks/useAppData';
import { DB_SCHEMA_VERSION } from '../db/schema';
import { Toast } from '../components/Toast';
import { GoalsManager } from '../components/GoalsManager';
import { useEffect, useState } from 'react';
import { notifyDataChanged, serverApi, type BackupStatus } from '../api/client';
import { backupConfusingWords, fetchConfusingWordsBackup } from '../features/confusing-words/backupApi';
import { buildExport, loadGroups, saveGroups } from '../features/confusing-words/storage';
import type { ConfusingWordGroup } from '../features/confusing-words/types';

const BACKUP_META_KEY = 'examPlanner.confusingWords.lastBackupAt';
const BACKUP_BASE_URL_KEY = 'examPlanner.confusingWords.backupBaseUrl';
const BACKUP_PASSWORD_KEY = 'examPlanner.confusingWords.backupPassword';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const backupKindLabel: Record<string, string> = {
  manual: '手动',
  weekly: '每周',
  'pre-tables': '拆表前',
  'pre-restore': '恢复前',
  restore: '恢复记录',
};

export function SettingsPage() {
  const { goals, projects, studyRecords, reviews, subjects, exams, shortTermTasks, readOnly } = useAppData();
  const [toast, setToast] = useState('');
  const [studyTargetHours, setStudyTargetHours] = useState('');
  const [backupBaseUrl, setBackupBaseUrl] = useState(() => localStorage.getItem(BACKUP_BASE_URL_KEY) || '');
  const [backupPassword, setBackupPassword] = useState(() => localStorage.getItem(BACKUP_PASSWORD_KEY) || '');
  const [confusingGroups, setConfusingGroups] = useState(() => loadGroups());
  const [backupStatus, setBackupStatus] = useState<BackupStatus | null>(null);

  const refreshBackupStatus = async () => {
    try {
      setBackupStatus(await serverApi.getBackupStatus());
    } catch {
      setBackupStatus(null);
    }
  };

  useEffect(() => {
    let mounted = true;
    const timeoutId = window.setTimeout(() => {
      Promise.allSettled([serverApi.getBackupStatus(), serverApi.getStudyTarget()])
        .then(([backupResult, targetResult]) => {
          if (!mounted) return;
          if (backupResult.status === 'fulfilled') setBackupStatus(backupResult.value);
          else setBackupStatus(null);
          if (targetResult.status === 'fulfilled') setStudyTargetHours(targetResult.value.targetHours ? String(targetResult.value.targetHours) : '');
        })
    }, 0);
    return () => {
      mounted = false;
      window.clearTimeout(timeoutId);
    };
  }, []);

  const exportData = () => {
    const data = { exportedAt: new Date().toISOString(), dbSchemaVersion: DB_SCHEMA_VERSION, goals, projects, studyRecords, reviews, subjects, exams, shortTermTasks };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `exam-planner-export-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveStudyTarget = async () => {
    const nextTarget = studyTargetHours.trim() ? Number(studyTargetHours) : 0;
    if (!Number.isFinite(nextTarget) || nextTarget < 0) return alert('目标时长不能小于 0');
    try {
      const result = await serverApi.saveStudyTarget(nextTarget);
      setStudyTargetHours(result.targetHours ? String(result.targetHours) : '');
      notifyDataChanged();
      setToast('学习总时长目标已保存');
    } catch {
      setToast('保存失败，请稍后重试');
    }
    setTimeout(() => setToast(''), 1800);
  };

  const exportConfusingWords = () => {
    const blob = new Blob([JSON.stringify(buildExport(confusingGroups), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `confusing-words-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importConfusingWords = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const payload = JSON.parse(text) as { groups?: ConfusingWordGroup[] };
    if (!Array.isArray(payload.groups)) return alert('导入文件格式不正确');
    const shouldMerge = confirm('点击“确定”合并导入；点击“取消”覆盖当前易混单词数据。');
    const next = shouldMerge ? [...confusingGroups, ...payload.groups] : payload.groups;
    saveGroups(next);
    setConfusingGroups(next);
    setToast('易混单词导入完成');
    setTimeout(() => setToast(''), 1800);
  };

  const saveBackupSettings = () => {
    localStorage.setItem(BACKUP_BASE_URL_KEY, backupBaseUrl.trim());
    localStorage.setItem(BACKUP_PASSWORD_KEY, backupPassword);
    setToast('易混单词备份设置已保存');
    setTimeout(() => setToast(''), 1800);
  };

  const backupNow = async () => {
    try {
      const result = await backupConfusingWords(buildExport(loadGroups()), { baseUrl: backupBaseUrl, password: backupPassword });
      localStorage.setItem(BACKUP_META_KEY, result.backedUpAt);
      setToast('易混单词已备份到服务器');
    } catch {
      setToast('备份失败，请检查服务器地址和密码');
    }
    setTimeout(() => setToast(''), 2200);
  };

  const restoreConfusingWordsBackup = async () => {
    if (!confirm('确定从服务器备份恢复易混单词吗？这会覆盖当前浏览器中的易混单词数据。')) return;
    try {
      const backup = await fetchConfusingWordsBackup({ baseUrl: backupBaseUrl, password: backupPassword });
      if (!backup?.groups?.length) return alert('服务器上还没有可恢复的易混单词备份');
      saveGroups(backup.groups);
      setConfusingGroups(backup.groups);
      if (backup.backedUpAt) localStorage.setItem(BACKUP_META_KEY, backup.backedUpAt);
      setToast('已从服务器恢复易混单词');
    } catch {
      setToast('恢复失败，请检查服务器地址和密码');
    }
    setTimeout(() => setToast(''), 2200);
  };

  const clearAllData = async () => {
    const firstConfirm = confirm('确定要清空所有本地数据吗？这会删除目标、复盘、学习时间、模考记录和短期目标。');
    if (!firstConfirm) return;
    const secondConfirm = confirm('请再次确认：清空后无法恢复。建议先导出 JSON 备份。仍然继续吗？');
    if (!secondConfirm) return;

    await serverApi.reset();
    notifyDataChanged();
    setToast('服务器数据已清空，并已恢复默认项目');
    setTimeout(() => setToast(''), 2200);
  };

  const runServerBackup = async () => {
    try {
      await serverApi.runServerBackup();
      await refreshBackupStatus();
      setToast('服务器备份已创建');
    } catch {
      setToast('服务器备份失败，请稍后重试');
    }
    setTimeout(() => setToast(''), 2200);
  };

  const restoreServerBackup = async (fileName: string) => {
    const firstConfirm = confirm(`确定要恢复这个服务器备份吗？\n${fileName}`);
    if (!firstConfirm) return;
    const secondConfirm = confirm('恢复会用该备份覆盖当前服务器数据。系统会先自动创建一份恢复前安全备份。仍然继续吗？');
    if (!secondConfirm) return;
    try {
      await serverApi.restoreServerBackup(fileName);
      await refreshBackupStatus();
      notifyDataChanged();
      setToast('服务器备份已恢复');
    } catch {
      setToast('恢复失败，请稍后重试');
    }
    setTimeout(() => setToast(''), 2600);
  };

  return (
    <Page title="设置" subtitle="本地数据、版本和后续扩展入口。">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="数据库版本" value={`v${DB_SCHEMA_VERSION}`} hint="已预留迁移机制" icon={<ShieldCheck size={18} />} />
        <MetricCard label="学习记录" value={`${studyRecords.length} 条`} />
        <MetricCard label="模考记录" value={`${exams.length} 条`} />
      </div>
      <div className="mt-5 card p-5">
        <h2 className="text-base font-semibold">数据保存说明</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">学习计划数据已统一保存在服务器 SQLite 中，多端登录后读取同一份数据。删除学习项目和科目时，历史记录会保留名称快照；后续新增 AI 计划、番茄钟、导出报告时可以继续扩展表结构和迁移逻辑。</p>
        <button className="btn btn-soft mt-4" onClick={exportData}><Download size={16} />导出当前数据 JSON</button>
      </div>
      <div className="mt-5 card p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold"><Hourglass size={18} />学习总时长目标</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">这里设置的是到当前长期目标截止日期前，希望累计完成的总学习小时数。首页会自动显示已完成总时长、距离目标还差多少，以及平均每天还需要学多久。</p>
        <div className="mt-4 grid gap-3 md:grid-cols-[240px_auto]">
          <label>
            <span className="label">目标总时长（小时）</span>
            <input
              className="field"
              type="number"
              min={0}
              step={0.5}
              placeholder="例如 1500"
              value={studyTargetHours}
              onChange={(event) => setStudyTargetHours(event.target.value)}
            />
          </label>
          <div className="flex items-end">
            <button className="btn btn-primary" disabled={readOnly} onClick={() => void saveStudyTarget()}>保存目标时长</button>
          </div>
        </div>
      </div>
      <div className="mt-5 card p-5">
        <h2 className="text-base font-semibold">服务器备份系统</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">服务器会每周自动创建一次 SQLite 快照，并保留最近 12 个周备份。词典已建立本地 SQLite 索引，查询时不依赖外部 API。</p>
        <dl className="mt-4 grid gap-4 border-y border-slate-100 py-4 md:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold text-slate-500">存储方式</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">{backupStatus?.storage === 'sqlite-tables' ? '结构化 SQLite' : backupStatus?.storage ?? '读取中'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">数据库大小</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">{backupStatus ? formatBytes(backupStatus.sqliteSizeBytes) : '--'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">备份数量</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">{backupStatus ? `${backupStatus.backupCount} 个` : '--'}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">词典词条</dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">{backupStatus ? `${backupStatus.dictionaryCount.toLocaleString()} 条` : '--'}</dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-500">
          <span>最近周备份：{backupStatus?.lastWeeklyBackupAt ? new Date(backupStatus.lastWeeklyBackupAt).toLocaleString() : '暂无'}</span>
          <span>词典索引：{backupStatus?.dictionaryIndexedAt ? new Date(backupStatus.dictionaryIndexedAt).toLocaleString() : '暂无'}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="btn btn-soft" onClick={() => void runServerBackup()}><Cloud size={16} />立即创建服务器备份</button>
          <button className="btn btn-soft" onClick={() => void refreshBackupStatus()}>刷新状态</button>
        </div>
        <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
          <div className="grid grid-cols-[1fr_90px_110px_92px] bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
            <span>备份文件</span>
            <span>类型</span>
            <span>大小</span>
            <span className="text-right">操作</span>
          </div>
          {backupStatus?.backups?.length ? backupStatus.backups.slice(0, 12).map((backup) => (
            <div key={backup.fileName} className="grid grid-cols-[1fr_90px_110px_92px] items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">{backup.fileName}</p>
                <p className="mt-0.5 text-xs text-slate-500">{new Date(backup.createdAt).toLocaleString()}</p>
              </div>
              <span className="text-slate-600">{backupKindLabel[backup.kind] ?? backup.kind}</span>
              <span className="text-slate-600">{formatBytes(backup.sizeBytes)}</span>
              <button className="justify-self-end rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700" onClick={() => void restoreServerBackup(backup.fileName)}>
                <RotateCcw size={13} className="mr-1 inline" />恢复
              </button>
            </div>
          )) : (
            <div className="border-t border-slate-100 px-3 py-6 text-center text-sm text-slate-500">还没有可恢复的服务器备份</div>
          )}
        </div>
      </div>
      <div className="mt-5">
        <div className="mb-3">
          <h2 className="text-base font-semibold text-slate-900">长期目标管理</h2>
          <p className="mt-1 text-sm text-slate-500">长期目标入口已收纳到设置页，首页仍会显示当前启用目标倒计时。</p>
        </div>
        <GoalsManager />
      </div>
      <div className="mt-5 card p-5">
        <h2 className="text-base font-semibold">易混单词数据</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">易混单词保存在当前浏览器本地，共 {confusingGroups.length} 组。可以导出 JSON，也可以设置服务器地址用于每小时备份。</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="btn btn-soft" onClick={exportConfusingWords}><Download size={16} />导出易混单词 JSON</button>
          <label className="btn btn-soft cursor-pointer"><UploadCloud size={16} />导入易混单词 JSON<input className="hidden" type="file" accept="application/json" onChange={(event) => void importConfusingWords(event.target.files?.[0])} /></label>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-[1fr_220px]">
          <label><span className="label">服务器备份地址</span><input className="field" placeholder="部署版同源可留空；本地可填 http://服务器IP" value={backupBaseUrl} onChange={(event) => setBackupBaseUrl(event.target.value)} /></label>
          <label><span className="label">备份密码</span><input className="field" type="password" value={backupPassword} onChange={(event) => setBackupPassword(event.target.value)} /></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button className="btn btn-soft" onClick={saveBackupSettings}>保存备份设置</button>
          <button className="btn btn-soft" onClick={() => void backupNow()}><Cloud size={16} />立即备份</button>
          <button className="btn btn-soft" onClick={() => void restoreConfusingWordsBackup()}>从服务器恢复</button>
        </div>
      </div>
      <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50 p-5">
        <h2 className="text-base font-semibold text-rose-800">危险操作</h2>
        <p className="mt-2 text-sm leading-6 text-rose-700">一键清空会删除当前浏览器中的所有本地数据，包括复盘、学习时间、模考成绩、目标和短期任务。操作会进行二次确认，清空后会自动恢复默认学习项目和默认科目。</p>
        <button className="btn btn-danger mt-4" onClick={clearAllData}><Trash2 size={16} />一键清空所有数据</button>
      </div>
      <Toast message={toast} />
    </Page>
  );
}
