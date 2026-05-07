import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cloud, Download, FileText, Plus, Printer, Search, Trash2, UploadCloud } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { backupConfusingWords, fetchConfusingWordsBackup } from '../features/confusing-words/backupApi';
import { queryDictionary } from '../features/confusing-words/dictionaryApi';
import { openPrintWindow } from '../features/confusing-words/print';
import { buildExport, createGroup, createWord, defaultTags, loadGroups, masteryLabel, parseWords, saveGroups } from '../features/confusing-words/storage';
import type { ConfusingWordEntry, ConfusingWordGroup, PrintMode, WordMastery } from '../features/confusing-words/types';

const nowISO = () => new Date().toISOString();
const todayKey = () => new Date().toISOString().slice(0, 10);
const BACKUP_META_KEY = 'examPlanner.confusingWords.lastBackupAt';
const BACKUP_BASE_URL_KEY = 'examPlanner.confusingWords.backupBaseUrl';
const BACKUP_PASSWORD_KEY = 'examPlanner.confusingWords.backupPassword';
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;

const printModeLabel: Record<PrintMode, string> = {
  'meaning-to-word': '模式 A：中文释义默写英文',
  'word-to-meaning': '模式 B：英文默写中文',
  'comparison-table': '模式 C：对比表',
  blank: '模式 D：完全空白',
};

export function ConfusingWordsPage() {
  const [initialGroups] = useState(() => loadGroups());
  const [groups, setGroups] = useState<ConfusingWordGroup[]>(initialGroups);
  const [selectedId, setSelectedId] = useState(initialGroups[0]?.id ?? '');
  const [wordInput, setWordInput] = useState('');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [sortBy, setSortBy] = useState<'updatedAt' | 'createdAt'>('updatedAt');
  const [printMode, setPrintMode] = useState<PrintMode>('meaning-to-word');
  const [printScope, setPrintScope] = useState<'current' | 'selected' | 'all'>('current');
  const [checkedGroupIds, setCheckedGroupIds] = useState<string[]>([]);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [toast, setToast] = useState('');
  const [lastBackupAt, setLastBackupAt] = useState(() => localStorage.getItem(BACKUP_META_KEY) || '');
  const [backupBaseUrl, setBackupBaseUrl] = useState(() => localStorage.getItem(BACKUP_BASE_URL_KEY) || '');
  const [backupPassword, setBackupPassword] = useState(() => localStorage.getItem(BACKUP_PASSWORD_KEY) || '');
  const [backupStatus, setBackupStatus] = useState('本地优先，每小时自动备份到服务器');

  const persist = (next: ConfusingWordGroup[], message?: string) => {
    setGroups(next);
    saveGroups(next);
    if (message) {
      setToast(message);
      setTimeout(() => setToast(''), 1800);
    }
  };

  const selectedGroup = groups.find((group) => group.id === selectedId);
  const totalWords = groups.reduce((sum, group) => sum + group.words.length, 0);
  const unknownWords = groups.reduce((sum, group) => sum + group.words.filter((word) => word.mastery !== 'mastered').length, 0);
  const todayWords = groups.reduce((sum, group) => sum + group.words.filter((word) => word.createdAt.slice(0, 10) === todayKey()).length, 0);
  const allTags = [...new Set([...defaultTags, ...groups.flatMap((group) => group.tags)])];

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return groups
      .filter((group) => {
        const matchesQuery = !normalized || group.title.toLowerCase().includes(normalized) || group.words.some((word) => word.word.toLowerCase().includes(normalized));
        const matchesTag = !tagFilter || group.tags.includes(tagFilter);
        return matchesQuery && matchesTag;
      })
      .sort((a, b) => b[sortBy].localeCompare(a[sortBy]));
  }, [groups, query, tagFilter, sortBy]);

  const performBackup = useCallback(async (manual = false) => {
    if (!groups.length) return;
    if (!manual && lastBackupAt && Date.now() - new Date(lastBackupAt).getTime() < BACKUP_INTERVAL_MS) return;
      setBackupStatus('正在备份到服务器...');
    try {
      const result = await backupConfusingWords(buildExport(groups), { baseUrl: backupBaseUrl, password: backupPassword });
      localStorage.setItem(BACKUP_META_KEY, result.backedUpAt);
      setLastBackupAt(result.backedUpAt);
      setBackupStatus(`已备份：${new Date(result.backedUpAt).toLocaleString()}`);
      if (manual) setToast('服务器备份完成');
    } catch {
      setBackupStatus('服务器备份失败，本地数据仍已保存');
      if (manual) setToast('备份失败，请确认已登录服务器版本');
    }
  }, [backupBaseUrl, backupPassword, groups, lastBackupAt]);

  useEffect(() => {
    const firstRun = window.setTimeout(() => void performBackup(false), 0);
    const timer = window.setInterval(() => void performBackup(false), BACKUP_INTERVAL_MS);
    return () => {
      window.clearTimeout(firstRun);
      window.clearInterval(timer);
    };
  }, [performBackup]);

  const updateGroup = (id: string, updater: (group: ConfusingWordGroup) => ConfusingWordGroup) => {
    persist(groups.map((group) => group.id === id ? updater(group) : group));
  };

  const createNewGroup = () => {
    const group = createGroup(parseWords(wordInput));
    const next = [group, ...groups];
    persist(next, '已新建单词组');
    setSelectedId(group.id);
    setWordInput('');
    void lookupWords(group.id, group.words.map((word) => ({ id: word.id, word: word.word })));
  };

  const addWordsToGroup = async () => {
    if (!selectedGroup) return;
    const words = parseWords(wordInput).filter((word) => !selectedGroup.words.some((item) => item.word.toLowerCase() === word));
    if (!words.length) return alert('请输入要添加的英文单词');
    const newWords = words.map(createWord);
    updateGroup(selectedGroup.id, (group) => ({
      ...group,
      title: group.title === '新的易混单词组' ? [...group.words, ...newWords].map((word) => word.word).join(' / ') : group.title,
      words: [...group.words, ...newWords],
      updatedAt: nowISO(),
    }));
    setWordInput('');
    await lookupWords(selectedGroup.id, newWords.map((word) => ({ id: word.id, word: word.word })));
  };

  const lookupWords = async (groupId: string, wordsToLookup: Array<{ id: string; word: string }>) => {
    for (const entry of wordsToLookup) {
      updateWord(groupId, entry.id, { queryStatus: 'loading' });
      try {
        const result = await queryDictionary(entry.word);
        updateWord(groupId, entry.id, { ...result, queryStatus: 'success', updatedAt: nowISO() });
      } catch {
        updateWord(groupId, entry.id, { queryStatus: 'failed', updatedAt: nowISO() });
      }
    }
  };

  const updateWord = (groupId: string, wordId: string, patch: Partial<ConfusingWordEntry>) => {
    setGroups((current) => {
      const next = current.map((group) => group.id === groupId ? {
        ...group,
        words: group.words.map((word) => word.id === wordId ? { ...word, ...patch, updatedAt: nowISO() } : word),
        updatedAt: nowISO(),
      } : group);
      saveGroups(next);
      return next;
    });
  };

  const removeWord = (groupId: string, wordId: string) => {
    if (!confirm('确定删除这个单词吗？')) return;
    updateGroup(groupId, (group) => ({ ...group, words: group.words.filter((word) => word.id !== wordId), updatedAt: nowISO() }));
  };

  const deleteGroup = (id: string) => {
    if (!confirm('确定删除这个易混单词组吗？')) return;
    const next = groups.filter((group) => group.id !== id);
    persist(next, '已删除单词组');
    setSelectedId(next[0]?.id ?? '');
  };

  const mergeIntoCurrentGroup = () => {
    if (!selectedGroup || !mergeTargetId) return;
    const target = groups.find((group) => group.id === mergeTargetId);
    if (!target || !confirm(`确定把「${target.title}」合并到当前组吗？`)) return;
    const mergedWords = [...selectedGroup.words];
    for (const word of target.words) {
      if (!mergedWords.some((item) => item.word === word.word)) mergedWords.push(word);
    }
    const next = groups
      .filter((group) => group.id !== target.id)
      .map((group) => group.id === selectedGroup.id ? {
        ...group,
        words: mergedWords,
        tags: [...new Set([...group.tags, ...target.tags])],
        note: [group.note, target.note].filter(Boolean).join('\n'),
        updatedAt: nowISO(),
      } : group);
    persist(next, '已合并单词组');
    setMergeTargetId('');
  };

  const generateSummary = () => {
    if (!selectedGroup) return;
    const lines = selectedGroup.words.map((word) => `${word.word}: ${word.partOfSpeech || '词性待补充'}，${word.chineseDefinition || word.englishDefinition || '释义待补充'}`);
    updateGroup(selectedGroup.id, (group) => ({ ...group, confusionSummary: lines.join('\n'), updatedAt: nowISO() }));
  };

  const toggleTag = (tag: string) => {
    if (!selectedGroup) return;
    updateGroup(selectedGroup.id, (group) => ({
      ...group,
      tags: group.tags.includes(tag) ? group.tags.filter((item) => item !== tag) : [...group.tags, tag],
      updatedAt: nowISO(),
    }));
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(buildExport(groups), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `confusing-words-${todayKey()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const restoreServerBackup = async () => {
    if (!confirm('确定从服务器备份恢复易混单词数据吗？这会覆盖当前浏览器里的易混单词数据。')) return;
    try {
      const backup = await fetchConfusingWordsBackup({ baseUrl: backupBaseUrl, password: backupPassword });
      if (!backup?.groups?.length) {
        alert('服务器上还没有可恢复的易混单词备份');
        return;
      }
      persist(backup.groups, '已从服务器备份恢复');
      setSelectedId(backup.groups[0]?.id ?? '');
      if (backup.backedUpAt) {
        localStorage.setItem(BACKUP_META_KEY, backup.backedUpAt);
        setLastBackupAt(backup.backedUpAt);
      }
    } catch {
      alert('读取服务器备份失败，请确认已登录服务器版本');
    }
  };

  const saveBackupSettings = () => {
    localStorage.setItem(BACKUP_BASE_URL_KEY, backupBaseUrl.trim());
    localStorage.setItem(BACKUP_PASSWORD_KEY, backupPassword);
    setToast('备份设置已保存在本机');
  };

  const importData = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const payload = JSON.parse(text) as { groups?: ConfusingWordGroup[] };
    if (!Array.isArray(payload.groups)) return alert('导入文件格式不正确');
    const shouldMerge = confirm('点击“确定”合并导入；点击“取消”覆盖当前数据。');
    const next = shouldMerge ? [...groups, ...payload.groups] : payload.groups;
    persist(next, '导入完成');
    setSelectedId(next[0]?.id ?? '');
  };

  const printGroups = () => {
    const targets = printScope === 'all'
      ? groups
      : printScope === 'selected'
        ? groups.filter((group) => checkedGroupIds.includes(group.id))
        : selectedGroup ? [selectedGroup] : [];
    if (!targets.length) return alert('请选择要打印的单词组');
    openPrintWindow(targets, printMode);
  };

  return (
    <Page title="易混单词整理" subtitle="记录字形相近但意义不同的英文单词，查询释义并生成默写版。">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="总单词组" value={`${groups.length} 组`} />
        <MetricCard label="总单词数" value={`${totalWords} 个`} />
        <MetricCard label="未掌握" value={`${unknownWords} 个`} />
        <MetricCard label="今日新增" value={`${todayWords} 个`} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[380px_1fr]">
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-base font-semibold">新建 / 搜索</h2>
            <textarea className="field mt-4 min-h-24" placeholder="affect, effect 或换行输入多个单词" value={wordInput} onChange={(event) => setWordInput(event.target.value)} />
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={createNewGroup}><Plus size={16} />新建组</button>
              <button className="btn btn-soft" onClick={addWordsToGroup}>加入当前组</button>
            </div>
            <div className="mt-4 grid gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 text-slate-400" size={16} />
                <input className="field pl-9" placeholder="按标题或单词搜索" value={query} onChange={(event) => setQuery(event.target.value)} />
              </div>
              <select className="field" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
                <option value="">全部标签</option>
                {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </select>
              <select className="field" value={sortBy} onChange={(event) => setSortBy(event.target.value as 'updatedAt' | 'createdAt')}>
                <option value="updatedAt">按更新时间</option>
                <option value="createdAt">按创建时间</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {filteredGroups.length ? filteredGroups.map((group) => {
              const mastered = group.words.filter((word) => word.mastery === 'mastered').length;
              return (
                <div key={group.id} className={`card cursor-pointer p-4 ${selectedId === group.id ? 'ring-2 ring-blue-200' : ''}`} onClick={() => setSelectedId(group.id)}>
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={checkedGroupIds.includes(group.id)} onChange={(event) => setCheckedGroupIds(event.target.checked ? [...checkedGroupIds, group.id] : checkedGroupIds.filter((id) => id !== group.id))} />
                      <span className="font-semibold">{group.title}</span>
                    </label>
                    <span className={`rounded px-2 py-1 text-xs ${group.status === 'mastered' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{group.status === 'mastered' ? '已掌握' : '需要复习'}</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">{group.words.map((word) => word.word).join(' / ')}</p>
                  <div className="mt-3 flex flex-wrap gap-2">{group.tags.map((tag) => <span key={tag} className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{tag}</span>)}</div>
                  <p className="mt-3 text-xs text-slate-500">掌握度：{mastered}/{group.words.length} · 更新：{group.updatedAt.slice(0, 10)}</p>
                </div>
              );
            }) : <EmptyState title="没有匹配的单词组" />}
          </div>
        </div>

        <div className="space-y-5">
          {selectedGroup ? (
            <>
              <div className="card p-5">
                <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                  <label><span className="label">组标题</span><input className="field" value={selectedGroup.title} onChange={(event) => updateGroup(selectedGroup.id, (group) => ({ ...group, title: event.target.value, updatedAt: nowISO() }))} /></label>
                  <label><span className="label">组状态</span><select className="field" value={selectedGroup.status} onChange={(event) => updateGroup(selectedGroup.id, (group) => ({ ...group, status: event.target.value as ConfusingWordGroup['status'], updatedAt: nowISO() }))}><option value="review">需要复习</option><option value="mastered">已掌握</option></select></label>
                </div>
                <label className="mt-3 block"><span className="label">备注</span><textarea className="field min-h-20" value={selectedGroup.note} onChange={(event) => updateGroup(selectedGroup.id, (group) => ({ ...group, note: event.target.value, updatedAt: nowISO() }))} /></label>
                <div className="mt-3">
                  <span className="label">标签</span>
                  <div className="flex flex-wrap gap-2">{allTags.map((tag) => <button key={tag} className={`rounded border px-3 py-1 text-sm ${selectedGroup.tags.includes(tag) ? 'border-blue-600 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`} onClick={() => toggleTag(tag)}>{tag}</button>)}</div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <select className="field w-56" value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)}>
                    <option value="">选择要合并的组</option>
                    {groups.filter((group) => group.id !== selectedGroup.id).map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
                  </select>
                  <button className="btn btn-soft" onClick={mergeIntoCurrentGroup}>合并到当前组</button>
                  <button className="btn btn-danger" onClick={() => deleteGroup(selectedGroup.id)}><Trash2 size={16} />删除组</button>
                </div>
              </div>

              <div className="card p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">易混点总结</h2>
                  <button className="btn btn-soft" onClick={generateSummary}>自动生成易混点</button>
                </div>
                <textarea className="field mt-3 min-h-28" value={selectedGroup.confusionSummary} onChange={(event) => updateGroup(selectedGroup.id, (group) => ({ ...group, confusionSummary: event.target.value, updatedAt: nowISO() }))} />
              </div>

              <div className="space-y-3">
                {selectedGroup.words.map((word) => (
                  <div key={word.id} className="card p-4">
                    <div className="grid gap-3 lg:grid-cols-[160px_130px_1fr]">
                      <label><span className="label">单词</span><input className="field" value={word.word} onChange={(event) => updateWord(selectedGroup.id, word.id, { word: event.target.value })} /></label>
                      <label><span className="label">熟练度</span><select className="field" value={word.mastery} onChange={(event) => updateWord(selectedGroup.id, word.id, { mastery: event.target.value as WordMastery })}>{Object.entries(masteryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <label><span className="label">中文释义</span><input className="field" value={word.chineseDefinition} onChange={(event) => updateWord(selectedGroup.id, word.id, { chineseDefinition: event.target.value })} /></label>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label><span className="label">音标</span><input className="field" value={word.phonetic} onChange={(event) => updateWord(selectedGroup.id, word.id, { phonetic: event.target.value })} /></label>
                      <label><span className="label">词性</span><input className="field" value={word.partOfSpeech} onChange={(event) => updateWord(selectedGroup.id, word.id, { partOfSpeech: event.target.value })} /></label>
                    </div>
                    <label className="mt-3 block"><span className="label">英文释义</span><textarea className="field min-h-20" value={word.englishDefinition} onChange={(event) => updateWord(selectedGroup.id, word.id, { englishDefinition: event.target.value })} /></label>
                    <label className="mt-3 block"><span className="label">例句</span><input className="field" value={word.example} onChange={(event) => updateWord(selectedGroup.id, word.id, { example: event.target.value })} /></label>
                    <label className="mt-3 block"><span className="label">常见用法</span><input className="field" value={word.usage} onChange={(event) => updateWord(selectedGroup.id, word.id, { usage: event.target.value })} /></label>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                      <span className={word.queryStatus === 'failed' ? 'text-rose-600' : word.queryStatus === 'loading' ? 'text-blue-600' : 'text-slate-500'}>{word.queryStatus === 'loading' ? '正在查询词义...' : word.queryStatus === 'failed' ? '查询失败，请手动填写' : word.queryStatus === 'success' ? '已自动填入，可继续编辑' : '未查询'}</span>
                      <button className="btn btn-soft" onClick={() => lookupWords(selectedGroup.id, [{ id: word.id, word: word.word }])}>重新查询</button>
                      <button className="btn btn-danger" onClick={() => removeWord(selectedGroup.id, word.id)}><Trash2 size={16} />删除单词</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : <EmptyState title="请选择或新建一个易混单词组" />}

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold"><Printer size={18} />打印设置</h2>
              <select className="field mt-4" value={printMode} onChange={(event) => setPrintMode(event.target.value as PrintMode)}>{Object.entries(printModeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <select className="field mt-3" value={printScope} onChange={(event) => setPrintScope(event.target.value as 'current' | 'selected' | 'all')}><option value="current">打印当前组</option><option value="selected">打印勾选的多个组</option><option value="all">打印全部组</option></select>
              <button className="btn btn-primary mt-4" onClick={printGroups}><FileText size={16} />预览并打印默写版</button>
            </div>
            <div className="card p-5">
              <h2 className="text-base font-semibold">数据导入导出</h2>
              <p className="mt-2 text-sm text-slate-500">{backupStatus}</p>
              <label className="mt-4 block">
                <span className="label">服务器备份地址</span>
                <input className="field" placeholder="部署版同源可留空；本地开发可填 http://服务器IP" value={backupBaseUrl} onChange={(event) => setBackupBaseUrl(event.target.value)} />
              </label>
              <label className="mt-3 block">
                <span className="label">备份密码</span>
                <input className="field" type="password" placeholder="本地开发跨服务器备份时填写访问密码" value={backupPassword} onChange={(event) => setBackupPassword(event.target.value)} />
              </label>
              <button className="btn btn-soft mt-3" onClick={saveBackupSettings}>保存备份设置</button>
              <button className="btn btn-soft mt-4" onClick={() => void performBackup(true)}><Cloud size={16} />立即备份到服务器</button>
              <button className="btn btn-soft mt-3" onClick={() => void restoreServerBackup()}>从服务器备份恢复</button>
              <button className="btn btn-soft mt-4" onClick={exportData}><Download size={16} />导出 JSON</button>
              <label className="btn btn-soft mt-3 w-fit cursor-pointer"><UploadCloud size={16} />导入 JSON<input className="hidden" type="file" accept="application/json" onChange={(event) => void importData(event.target.files?.[0])} /></label>
            </div>
          </div>
        </div>
      </div>
      <Toast message={toast} />
    </Page>
  );
}
