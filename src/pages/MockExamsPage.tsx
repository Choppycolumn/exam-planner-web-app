import { useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { ChartBox, TrendLine } from '../components/Charts';
import { ColorPicker } from '../components/ColorPicker';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { subjectsRepository } from '../db/repositories/subjectsRepository';
import { useAppData } from '../hooks/useAppData';
import type { MockExamRecord, Subject } from '../types/models';
import { todayISO } from '../utils/date';
import { getSubjectExamStats, getSubjectScoreTrend } from '../utils/statistics';

export function MockExamsPage() {
  const { subjects, activeSubjects, exams } = useAppData();
  const [subjectDraft, setSubjectDraft] = useState<Partial<Subject>>({ name: '', color: '#2563eb' });
  const [filter, setFilter] = useState<number | 'all'>('all');
  const firstSubject = activeSubjects[0];
  const [draft, setDraft] = useState<Partial<MockExamRecord>>({ date: todayISO(), subjectId: firstSubject?.id, fullScore: 150, score: 0, paperName: '', durationMinutes: 0, wrongCount: 0, note: '' });
  const [toast, setToast] = useState('');
  const scoped = useMemo(() => exams.filter((exam) => filter === 'all' || exam.subjectId === filter), [exams, filter]);
  const stats = getSubjectExamStats(exams, filter === 'all' ? undefined : filter);
  const trend = getSubjectScoreTrend(exams, filter === 'all' ? undefined : filter);

  const selectSubject = (subjectId: number | 'all') => {
    setFilter(subjectId);
    if (subjectId !== 'all') {
      setDraft((current) => ({ ...current, subjectId }));
    }
  };

  const saveExam = async () => {
    const selectedSubjectId = Number(draft.subjectId ?? firstSubject?.id);
    const subject = activeSubjects.find((item) => item.id === selectedSubjectId);
    if (!subject?.id) return alert('请先选择科目');
    if (!draft.paperName?.trim()) return alert('请填写试卷名称');
    if (Number(draft.score) > Number(draft.fullScore)) return alert('分数不能超过满分');
    await subjectsRepository.saveExam({ ...draft, subjectId: subject.id, subjectNameSnapshot: subject.name });
    setDraft({ date: todayISO(), subjectId: subject.id, fullScore: draft.fullScore ?? 150, score: 0, paperName: '', durationMinutes: 0, wrongCount: 0, note: '' });
    setToast('模考记录已保存');
    setTimeout(() => setToast(''), 1800);
  };

  const saveSubject = async () => {
    if (!subjectDraft.name?.trim()) return alert('请填写科目名称');
    const subjectId = await subjectsRepository.saveSubject(subjectDraft);
    setFilter(subjectId);
    setDraft((current) => ({ ...current, subjectId }));
    setSubjectDraft({ name: '', color: '#2563eb' });
  };

  return (
    <Page title="模考成绩" subtitle="记录每套卷子的成绩、用时和错题数量。">
      <div className="card mb-5 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">科目选择</h2>
            <p className="mt-1 text-sm text-slate-500">可以自由新增科目；选择后，图表、历史记录和新增成绩会同步到该科目。</p>
          </div>
          <div className="grid w-full gap-3 md:w-auto md:grid-cols-[150px_280px_auto_auto]">
            <input className="field" placeholder="新增科目" value={subjectDraft.name ?? ''} onChange={(e) => setSubjectDraft({ ...subjectDraft, name: e.target.value })} />
            <ColorPicker value={subjectDraft.color} onChange={(color) => setSubjectDraft({ ...subjectDraft, color })} />
            <button className="btn btn-primary" onClick={saveSubject}><Plus size={16} />添加科目</button>
            <button className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-soft'}`} onClick={() => selectSubject('all')}>全部记录</button>
          </div>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {activeSubjects.map((subject) => (
            <button
              key={subject.id}
              className={`inline-flex min-w-28 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition ${
                filter === subject.id ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50'
              }`}
              onClick={() => subject.id && selectSubject(subject.id)}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: filter === subject.id ? '#ffffff' : subject.color }} />
              {subject.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-4">
            <MetricCard label="最近一次" value={stats.latest ? `${stats.latest.score}/${stats.latest.fullScore}` : '暂无'} hint={stats.latest?.paperName} />
            <MetricCard label="最高分" value={stats.highest || '暂无'} />
            <MetricCard label="平均分" value={stats.average || '暂无'} />
            <MetricCard label="最低分" value={stats.lowest || '暂无'} />
          </div>
          <ChartBox title="成绩趋势折线图">{trend.length ? <TrendLine data={trend} dataKey="score" label="分数" /> : <EmptyState title="暂无成绩数据" />}</ChartBox>
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
              <h2 className="font-semibold">历史记录</h2>
              <select className="field w-48" value={filter} onChange={(e) => selectSubject(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                <option value="all">全部科目</option>
                {activeSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
              </select>
            </div>
            {scoped.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">日期</th><th className="p-3">科目</th><th className="p-3">试卷</th><th className="p-3">分数</th><th className="p-3">用时</th><th className="p-3">错题</th><th className="p-3">操作</th></tr></thead>
                  <tbody>
                    {scoped.map((exam) => (
                      <tr key={exam.id} className="border-t border-slate-100">
                        <td className="p-3">{exam.date}</td><td className="p-3">{exam.subjectNameSnapshot}</td><td className="p-3">{exam.paperName}</td><td className="p-3 font-semibold">{exam.score}/{exam.fullScore}</td><td className="p-3">{exam.durationMinutes} 分钟</td><td className="p-3">{exam.wrongCount}</td>
                        <td className="p-3"><button className="btn btn-danger" onClick={() => exam.id && confirm('确定删除这条模考记录吗？') && subjectsRepository.removeExam(exam.id)}><Trash2 size={15} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="p-5"><EmptyState title="暂无模考记录" /></div>}
          </div>
        </div>

        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-base font-semibold">添加模考记录</h2>
            <div className="mt-4 space-y-3">
              <label><span className="label">考试日期</span><input className="field" type="date" value={draft.date ?? todayISO()} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></label>
              <label>
                <span className="label">考试科目</span>
                <select className="field" value={draft.subjectId ?? firstSubject?.id ?? ''} onChange={(e) => setDraft({ ...draft, subjectId: Number(e.target.value) })}>
                  {activeSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                </select>
              </label>
              <label><span className="label">试卷名称</span><input className="field" placeholder="例如：张宇八套卷第 1 套" value={draft.paperName ?? ''} onChange={(e) => setDraft({ ...draft, paperName: e.target.value })} /></label>
              <div className="grid grid-cols-2 gap-3">
                <label><span className="label">总分</span><input className="field" type="number" min={1} value={draft.fullScore ?? 150} onChange={(e) => setDraft({ ...draft, fullScore: Number(e.target.value) })} /></label>
                <label><span className="label">本次考试得分</span><input className="field" type="number" min={0} max={draft.fullScore ?? undefined} value={draft.score ?? 0} onChange={(e) => setDraft({ ...draft, score: Number(e.target.value) })} /></label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label><span className="label">用时（分钟）</span><input className="field" type="number" min={0} value={draft.durationMinutes ?? 0} onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) })} /></label>
                <label><span className="label">错题数量</span><input className="field" type="number" min={0} value={draft.wrongCount ?? 0} onChange={(e) => setDraft({ ...draft, wrongCount: Number(e.target.value) })} /></label>
              </div>
              <label><span className="label">备注</span><textarea className="field min-h-20" placeholder="题型问题、时间分配、复盘重点" value={draft.note ?? ''} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
              <button className="btn btn-primary w-full" onClick={saveExam}><Save size={16} />保存记录</button>
            </div>
          </div>
          <div className="card p-5">
            <h2 className="text-base font-semibold">科目管理</h2>
            <p className="mt-1 text-sm text-slate-500">点击科目名称可载入编辑；删除不会影响历史模考记录。</p>
            <div className="mt-4 space-y-2">{subjects.map((subject) => <div key={subject.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"><button className="flex items-center gap-2" onClick={() => setSubjectDraft(subject)}><span className="h-3 w-3 rounded-full" style={{ background: subject.color }} />{subject.name}</button>{subject.isActive && <button onClick={() => subject.id && confirm('删除后历史模考记录会保留科目名称快照，确定删除吗？') && subjectsRepository.removeSubject(subject.id)}><Trash2 size={16} /></button>}</div>)}</div>
          </div>
        </div>
      </div>
      <Toast message={toast} />
    </Page>
  );
}
