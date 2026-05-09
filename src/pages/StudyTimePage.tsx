/* eslint-disable react-hooks/set-state-in-effect -- Date/project switches should reset the editable day grid from IndexedDB. */
import { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { ColorPicker } from '../components/ColorPicker';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { studyRepository } from '../db/repositories/studyRepository';
import { useStudyTimeData } from '../hooks/useStudyTimeData';
import type { StudyProject } from '../types/models';
import { minutesToHoursText, todayISO } from '../utils/date';

type StudyTimeRow = { hours: number | ''; minutes: number | ''; note: string };

const splitMinutes = (totalMinutes = 0): Pick<StudyTimeRow, 'hours' | 'minutes'> => ({
  hours: totalMinutes ? Math.floor(totalMinutes / 60) : '',
  minutes: totalMinutes ? totalMinutes % 60 : '',
});

const combineTime = (row?: StudyTimeRow) => Math.max(0, Number(row?.hours || 0) * 60 + Number(row?.minutes || 0));

export function StudyTimePage() {
  const [date, setDate] = useState(todayISO());
  const { projects, activeProjects, recordsForDate } = useStudyTimeData(date);
  const [rows, setRows] = useState<Record<number, StudyTimeRow>>({});
  const [projectDraft, setProjectDraft] = useState<Partial<StudyProject>>({ name: '', color: '#2563eb' });
  const [toast, setToast] = useState('');

  useEffect(() => {
    const next: Record<number, StudyTimeRow> = {};
    for (const project of activeProjects) {
      if (!project.id) continue;
      const found = recordsForDate.find((record) => record.projectId === project.id);
      next[project.id] = { ...splitMinutes(found?.minutes), note: found?.note ?? '' };
    }
    setRows(next);
  }, [activeProjects, recordsForDate]);

  const total = Object.values(rows).reduce((sum, row) => sum + combineTime(row), 0);

  const saveRecords = async () => {
    await studyRepository.saveDayRecords(
      date,
      activeProjects.filter((project) => project.id).map((project) => ({
        projectId: project.id!,
        projectNameSnapshot: project.name,
        minutes: combineTime(rows[project.id!]),
        note: rows[project.id!]?.note ?? '',
      })),
    );
    setToast('学习时间已保存');
    setTimeout(() => setToast(''), 1800);
  };

  const saveProject = async () => {
    if (!projectDraft.name?.trim()) return alert('请填写项目名称');
    await studyRepository.saveProject(projectDraft);
    setProjectDraft({ name: '', color: '#2563eb' });
  };

  return (
    <Page title="学习时间记录" subtitle="按日期记录每个学习项目的投入时间。">
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="card p-5">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <label><span className="label">选择日期</span><input className="field w-52" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <div className="text-right"><p className="text-sm text-slate-500">当天总学习时长</p><p className="text-2xl font-semibold text-slate-950">{minutesToHoursText(total)}</p></div>
          </div>
          {activeProjects.length ? (
            <div className="space-y-3">
              {activeProjects.map((project) => (
                <div key={project.id} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 md:grid-cols-[160px_190px_1fr]">
                  <div className="flex items-center gap-2 font-medium"><span className="h-3 w-3 rounded-full" style={{ background: project.color }} />{project.name}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="relative">
                      <input
                        className="field pr-8 placeholder:text-slate-300"
                        type="number"
                        min={0}
                        placeholder="0"
                        value={rows[project.id!]?.hours ?? ''}
                        onChange={(e) => setRows({ ...rows, [project.id!]: { ...rows[project.id!], hours: e.target.value === '' ? '' : Number(e.target.value) } })}
                      />
                      <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-slate-400">时</span>
                    </label>
                    <label className="relative">
                      <input
                        className="field pr-8 placeholder:text-slate-300"
                        type="number"
                        min={0}
                        max={59}
                        placeholder="0"
                        value={rows[project.id!]?.minutes ?? ''}
                        onChange={(e) => setRows({ ...rows, [project.id!]: { ...rows[project.id!], minutes: e.target.value === '' ? '' : Math.min(59, Number(e.target.value)) } })}
                      />
                      <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-slate-400">分</span>
                    </label>
                  </div>
                  <input className="field" placeholder="备注" value={rows[project.id!]?.note ?? ''} onChange={(e) => setRows({ ...rows, [project.id!]: { ...rows[project.id!], note: e.target.value } })} />
                </div>
              ))}
              <button className="btn btn-primary" onClick={saveRecords}><Save size={16} />保存当天记录</button>
            </div>
          ) : <EmptyState title="还没有启用的学习项目" description="先在右侧新增一个项目。" />}
        </div>

        <div className="card p-5">
          <h2 className="text-base font-semibold">学习项目管理</h2>
          <div className="mt-4 space-y-3">
            <input className="field" placeholder="项目名称" value={projectDraft.name ?? ''} onChange={(e) => setProjectDraft({ ...projectDraft, name: e.target.value })} />
            <div>
              <span className="label">项目颜色</span>
              <ColorPicker value={projectDraft.color} onChange={(color) => setProjectDraft({ ...projectDraft, color })} />
            </div>
            <button className="btn btn-primary w-full" onClick={saveProject}>保存项目</button>
          </div>
          <div className="mt-5 space-y-2">
            {projects.map((project) => (
              <div key={project.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${project.isActive ? 'border-slate-200' : 'border-slate-100 opacity-50'}`}>
                <button className="flex items-center gap-2 text-left" onClick={() => setProjectDraft(project)}><span className="h-3 w-3 rounded-full" style={{ background: project.color }} />{project.name}</button>
                {project.isActive && <button title="删除项目" onClick={() => project.id && confirm('删除后历史记录会保留项目名称快照，确定删除吗？') && studyRepository.removeProject(project.id)}><Trash2 size={16} /></button>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <Toast message={toast} />
    </Page>
  );
}
