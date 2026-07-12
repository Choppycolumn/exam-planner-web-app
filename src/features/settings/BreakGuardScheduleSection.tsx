import { useEffect, useState } from 'react';
import { Clock3, GraduationCap, Save } from 'lucide-react';
import { serverApi, type BreakGuardScheduleConfig, type BreakGuardScheduleResponse } from '../../api/client';

const defaults: BreakGuardScheduleConfig = {
  dailyLessons: 8,
  lessonMinutes: 50,
  breakMinutes: 10,
  dayStart: '08:00',
  lagGraceMinutes: 20,
  lagRepeatMinutes: 30,
  lessonProjects: [],
};

interface BreakGuardScheduleSectionProps {
  visible: boolean;
  readOnly?: boolean;
}

export function BreakGuardScheduleSection({ visible, readOnly }: BreakGuardScheduleSectionProps) {
  const [data, setData] = useState<BreakGuardScheduleResponse>({ config: defaults, projects: [] });
  const [status, setStatus] = useState('正在读取桌面课表…');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void serverApi.getBreakGuardSchedule()
      .then((result) => {
        setData(result);
        setStatus('Break Guard 会每分钟同步一次网站课表');
      })
      .catch(() => setStatus('课表读取失败，请稍后重试'));
  }, [visible]);

  const update = (patch: Partial<BreakGuardScheduleConfig>) => {
    setData((current) => ({ ...current, config: { ...current.config, ...patch } }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await serverApi.saveBreakGuardSchedule(data.config);
      setData(result);
      setStatus('课表已保存，桌面端将在一分钟内同步');
    } catch {
      setStatus('保存失败，请检查填写内容');
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;
  const lessonProjects = Array.from({ length: data.config.dailyLessons }, (_, index) => data.config.lessonProjects[index] || data.projects[index % Math.max(1, data.projects.length)]?.id || 0);

  return (
    <section className="mt-5 card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><GraduationCap size={18} />Break Guard 每日课表</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">课程从网站学习项目中选择。桌面端完成一节课后，实际专注分钟会直接累计到对应学习项目。</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700"><Clock3 size={14} />{status}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label><span className="label">每天课程</span><input className="field" type="number" min={1} max={12} value={data.config.dailyLessons} onChange={(event) => update({ dailyLessons: Math.max(1, Math.min(12, Number(event.target.value) || 1)) })} /></label>
        <label><span className="label">单节时长（分钟）</span><input className="field" type="number" min={10} max={180} step={5} value={data.config.lessonMinutes} onChange={(event) => update({ lessonMinutes: Number(event.target.value) })} /></label>
        <label><span className="label">课间休息（分钟）</span><input className="field" type="number" min={1} max={60} value={data.config.breakMinutes} onChange={(event) => update({ breakMinutes: Number(event.target.value) })} /></label>
        <label><span className="label">首节开始</span><input className="field" type="time" value={data.config.dayStart} onChange={(event) => update({ dayStart: event.target.value })} /></label>
        <label><span className="label">进度宽限（分钟）</span><input className="field" type="number" min={0} max={180} step={5} value={data.config.lagGraceMinutes} onChange={(event) => update({ lagGraceMinutes: Number(event.target.value) })} /></label>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {lessonProjects.map((projectId, index) => (
          <label key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="label">第 {index + 1} 节</span>
            <select
              className="field"
              value={projectId}
              onChange={(event) => {
                const next = [...lessonProjects];
                next[index] = Number(event.target.value);
                update({ lessonProjects: next });
              }}
            >
              {data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">每日目标：{Math.floor(data.config.dailyLessons * data.config.lessonMinutes / 60)} 小时 {data.config.dailyLessons * data.config.lessonMinutes % 60} 分钟</p>
        <button className="btn btn-primary" disabled={readOnly || saving || !data.projects.length} onClick={() => void save()}><Save size={16} />保存桌面课表</button>
      </div>
    </section>
  );
}
