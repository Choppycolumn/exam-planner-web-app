import { Download, ShieldCheck } from 'lucide-react';
import { Page } from '../components/Page';
import { MetricCard } from '../components/MetricCard';
import { useAppData } from '../hooks/useAppData';
import { DB_SCHEMA_VERSION } from '../db/schema';

export function SettingsPage() {
  const { goals, projects, studyRecords, reviews, subjects, exams, shortTermTasks } = useAppData();
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

  return (
    <Page title="设置" subtitle="本地数据、版本和后续扩展入口。">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="数据库版本" value={`v${DB_SCHEMA_VERSION}`} hint="已预留迁移机制" icon={<ShieldCheck size={18} />} />
        <MetricCard label="学习记录" value={`${studyRecords.length} 条`} />
        <MetricCard label="模考记录" value={`${exams.length} 条`} />
      </div>
      <div className="mt-5 card p-5">
        <h2 className="text-base font-semibold">本地保存说明</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">所有数据只保存在当前浏览器的 IndexedDB 中，不需要登录、服务器或云同步。删除学习项目和科目时，历史记录会保留名称快照，后续新增 AI 计划、番茄钟、导出报告时可以通过新增表和迁移继续扩展。</p>
        <button className="btn btn-soft mt-4" onClick={exportData}><Download size={16} />导出当前数据 JSON</button>
      </div>
    </Page>
  );
}
