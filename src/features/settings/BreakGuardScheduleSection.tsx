import { useEffect, useState } from 'react';
import { Clock3, GraduationCap, Save } from 'lucide-react';
import { serverApi, type BreakGuardScheduleConfig, type BreakGuardScheduleResponse } from '../../api/client';

const defaults: BreakGuardScheduleConfig = {
  dailyTargetMinutes: 400,
  longStudyMinutes: 180,
  breakMinutes: 10,
  lagGraceMinutes: 20,
  lagRepeatMinutes: 30,
};

interface BreakGuardScheduleSectionProps {
  visible: boolean;
  readOnly?: boolean;
}

export function BreakGuardScheduleSection({ visible, readOnly }: BreakGuardScheduleSectionProps) {
  const [data, setData] = useState<BreakGuardScheduleResponse>({ config: defaults, projects: [] });
  const [status, setStatus] = useState('正在读取学习设置…');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void serverApi.getBreakGuardSchedule()
      .then((result) => {
        setData({ ...result, config: { ...defaults, ...result.config } });
        setStatus('Break Guard 会每分钟同步一次课程与目标');
      })
      .catch(() => setStatus('学习设置读取失败，请稍后重试'));
  }, [visible]);

  const update = (patch: Partial<BreakGuardScheduleConfig>) => {
    setData((current) => ({ ...current, config: { ...current.config, ...patch } }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await serverApi.saveBreakGuardSchedule(data.config);
      setData(result);
      setStatus('学习设置已保存，桌面端将在一分钟内同步');
    } catch {
      setStatus('保存失败，请检查填写内容');
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;
  return (
    <section className="mt-5 card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><GraduationCap size={18} />Break Guard 学习设置</h2>
          <p className="mt-2 text-sm leading-6 text-secondary">桌面端直接展示下方学习项目，不再安排固定节数。结束学习后，实际分钟会累计到所选项目。</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-lg border border-accent bg-accent-soft px-3 py-2 text-xs font-semibold text-accent"><Clock3 size={14} />{status}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label><span className="label">每日目标（分钟）</span><input className="field" type="number" min={30} max={960} step={30} value={data.config.dailyTargetMinutes} onChange={(event) => update({ dailyTargetMinutes: Math.max(30, Math.min(960, Number(event.target.value) || 30)) })} /></label>
        <label><span className="label">课间休息（分钟）</span><input className="field" type="number" min={1} max={60} value={data.config.breakMinutes} onChange={(event) => update({ breakMinutes: Number(event.target.value) })} /></label>
        <label><span className="label">进度宽限（分钟）</span><input className="field" type="number" min={0} max={180} step={5} value={data.config.lagGraceMinutes} onChange={(event) => update({ lagGraceMinutes: Number(event.target.value) })} /></label>
        <label><span className="label">超长计时核对（分钟）</span><input className="field" type="number" min={60} max={720} step={30} value={data.config.longStudyMinutes} onChange={(event) => update({ longStudyMinutes: Math.max(60, Math.min(720, Number(event.target.value) || 180)) })} /></label>
      </div>
      <div className="mt-5">
        <p className="label">桌面端可选课程</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {data.projects.map((project) => (
            <span key={project.id} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm font-semibold text-strong">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: project.color }} />
              {project.name}
            </span>
          ))}
          {!data.projects.length && <span className="text-sm text-secondary">暂无学习项目，请先在学习时间页面添加。</span>}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-secondary">进度条按“今日已学时长 / {Math.floor(data.config.dailyTargetMinutes / 60)} 小时 {data.config.dailyTargetMinutes % 60} 分钟”计算。</p>
        <button className="btn btn-primary" disabled={readOnly || saving} onClick={() => void save()}><Save size={16} />保存学习设置</button>
      </div>
    </section>
  );
}
