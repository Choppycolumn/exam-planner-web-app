import { useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Page } from '../components/Page';
import { legacyIndexedDb } from '../legacy/indexedDb/database';
import type { ServerState } from '../api/client';

async function readLocalIndexedDb(): Promise<ServerState> {
  return {
    goals: await legacyIndexedDb.goals.toArray(),
    dailyReviews: await legacyIndexedDb.dailyReviews.toArray(),
    studyProjects: await legacyIndexedDb.studyProjects.toArray(),
    studyTimeRecords: await legacyIndexedDb.studyTimeRecords.toArray(),
    subjects: await legacyIndexedDb.subjects.toArray(),
    mockExamRecords: await legacyIndexedDb.mockExamRecords.toArray(),
    shortTermTasks: await legacyIndexedDb.shortTermTasks.toArray(),
    waterIntakeRecords: [],
  };
}

export function MigrateLocalDataPage() {
  const [serverUrl, setServerUrl] = useState('');
  const [importToken, setImportToken] = useState('');
  const [status, setStatus] = useState('等待开始迁移');
  const [counts, setCounts] = useState<Partial<Record<keyof ServerState, number>>>({});

  const migrate = async () => {
    setStatus('正在读取本地 IndexedDB...');
    const state = await readLocalIndexedDb();
    setCounts(Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value.length])) as Partial<Record<keyof ServerState, number>>);
    setStatus('正在上传到服务器...');
    const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/import`, {
      method: 'POST',
      credentials: serverUrl ? 'omit' : 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ importToken: importToken || undefined, state }),
    });
    if (!response.ok) throw new Error(`迁移失败（HTTP ${response.status}）`);
    setStatus('迁移完成，可以返回首页核对数据。');
  };

  return (
    <Page title="本地数据迁移" subtitle="把当前浏览器中的旧 IndexedDB 数据安全迁移到服务器。">
      <div className="card max-w-2xl p-5">
        <div className="grid gap-3">
          <label><span className="label">目标服务器地址</span><input className="field" placeholder="同一网站留空" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} /></label>
          {serverUrl ? <label><span className="label">数据迁移令牌</span><input className="field" type="password" value={importToken} onChange={(event) => setImportToken(event.target.value)} autoComplete="off" /></label> : null}
        </div>
        <button className="btn btn-primary mt-4" onClick={() => void migrate().catch((error) => setStatus(error instanceof Error ? error.message : String(error)))}>
          <UploadCloud size={16} />上传本地数据
        </button>
        <p className="mt-4 text-sm text-secondary">{status}</p>
        {Object.keys(counts).length ? <div className="mt-4 grid gap-2 text-sm text-secondary md:grid-cols-2">{Object.entries(counts).map(([key, value]) => <div key={key} className="rounded bg-surface-muted px-3 py-2">{key}: {value} 条</div>)}</div> : null}
      </div>
    </Page>
  );
}
