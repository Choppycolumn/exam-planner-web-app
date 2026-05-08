import { useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { Page } from '../components/Page';
import { db } from '../db/database';
import type { ServerState } from '../api/client';

const serverUrl = 'http://8.130.68.9';

async function readLocalIndexedDb(): Promise<ServerState> {
  return {
    goals: await db.goals.toArray(),
    dailyReviews: await db.dailyReviews.toArray(),
    studyProjects: await db.studyProjects.toArray(),
    studyTimeRecords: await db.studyTimeRecords.toArray(),
    subjects: await db.subjects.toArray(),
    mockExamRecords: await db.mockExamRecords.toArray(),
    shortTermTasks: await db.shortTermTasks.toArray(),
    waterIntakeRecords: [],
  };
}

export function MigrateLocalDataPage() {
  const [password, setPassword] = useState('123qwe');
  const [status, setStatus] = useState('等待开始迁移');
  const [counts, setCounts] = useState<Partial<Record<keyof ServerState, number>>>({});

  const migrate = async () => {
    setStatus('正在读取本地 IndexedDB...');
    const state = await readLocalIndexedDb();
    setCounts(Object.fromEntries(Object.entries(state).map(([key, value]) => [key, value.length])) as Partial<Record<keyof ServerState, number>>);

    setStatus('正在上传到服务器...');
    const response = await fetch(`${serverUrl}/api/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password, state }),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }
    setStatus('迁移完成。现在可以打开服务器地址查看数据。');
  };

  return (
    <Page title="本地数据迁移" subtitle="把当前浏览器里的旧 IndexedDB 数据上传到 ECS 服务器。">
      <div className="card max-w-2xl p-5">
        <label>
          <span className="label">服务器访问密码</span>
          <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="btn btn-primary mt-4" onClick={() => migrate().catch((error) => setStatus(`迁移失败：${error instanceof Error ? error.message : String(error)}`))}>
          <UploadCloud size={16} />上传本地数据到服务器
        </button>
        <p className="mt-4 text-sm text-slate-600">{status}</p>
        {Object.keys(counts).length ? (
          <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
            {Object.entries(counts).map(([key, value]) => <div key={key} className="rounded bg-slate-50 px-3 py-2">{key}: {value} 条</div>)}
          </div>
        ) : null}
      </div>
    </Page>
  );
}
