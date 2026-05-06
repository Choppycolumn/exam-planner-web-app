import { useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { Toast } from '../components/Toast';
import { Page } from '../components/Page';
import { goalsRepository } from '../db/repositories/goalsRepository';
import { useAppData } from '../hooks/useAppData';
import type { Goal } from '../types/models';
import { todayISO } from '../utils/date';

const emptyGoal: Partial<Goal> = { name: '', description: '', deadline: todayISO(), isActive: true, type: '考研', notes: '' };

export function GoalsPage() {
  const { goals } = useAppData();
  const [draft, setDraft] = useState<Partial<Goal>>(emptyGoal);
  const [toast, setToast] = useState('');

  const save = async () => {
    if (!draft.name?.trim() || !draft.deadline) return alert('请填写目标名称和截止日期');
    await goalsRepository.save(draft);
    setDraft(emptyGoal);
    setToast('目标已保存');
    setTimeout(() => setToast(''), 1800);
  };

  return (
    <Page title="长期目标" subtitle="管理启用目标、分数目标和考研截止日期。">
      <div className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <div className="card p-5">
          <h2 className="text-base font-semibold">{draft.id ? '编辑目标' : '新建目标'}</h2>
          <div className="mt-4 space-y-4">
            <label><span className="label">目标名称 *</span><input className="field" value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label><span className="label">目标描述</span><textarea className="field min-h-24" value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
            <label><span className="label">截止日期 *</span><input className="field" type="date" value={draft.deadline ?? ''} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} /></label>
            <label><span className="label">目标类型</span><select className="field" value={draft.type ?? '考研'} onChange={(e) => setDraft({ ...draft, type: e.target.value as Goal['type'] })}><option>考研</option><option>课程</option><option>项目</option></select></label>
            <label><span className="label">备注</span><textarea className="field min-h-20" value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} /> 设为当前启用目标</label>
            <div className="flex gap-2"><button className="btn btn-primary" onClick={save}><Save size={16} />保存</button><button className="btn btn-soft" onClick={() => setDraft(emptyGoal)}><Plus size={16} />新建</button></div>
          </div>
        </div>

        <div className="space-y-3">
          {goals.map((goal) => (
            <div key={goal.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2"><h3 className="text-lg font-semibold">{goal.name}</h3>{goal.isActive ? <span className="rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">启用中</span> : null}</div>
                  <p className="mt-1 text-sm text-slate-500">{goal.description}</p>
                  <p className="mt-2 text-sm text-slate-600">截止日期：{goal.deadline} · 类型：{goal.type}</p>
                  {goal.notes ? <p className="mt-2 text-sm text-slate-500">{goal.notes}</p> : null}
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-soft" onClick={() => setDraft(goal)}>编辑</button>
                  {!goal.isActive && <button className="btn btn-soft" onClick={() => goal.id && goalsRepository.activate(goal.id)}>启用</button>}
                  <button className="btn btn-danger" onClick={() => goal.id && confirm('确定删除这个目标吗？') && goalsRepository.remove(goal.id)}><Trash2 size={16} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <Toast message={toast} />
    </Page>
  );
}
