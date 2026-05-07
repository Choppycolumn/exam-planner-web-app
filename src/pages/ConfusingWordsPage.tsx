import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { backupConfusingWords } from '../features/confusing-words/backupApi';
import { queryDictionary } from '../features/confusing-words/dictionaryApi';
import { openPrintWindow } from '../features/confusing-words/print';
import { buildExport, createGroup, createWord, loadGroups, parseWords, saveGroups } from '../features/confusing-words/storage';
import type { ConfusingWordEntry, ConfusingWordGroup, PrintMode } from '../features/confusing-words/types';

const nowISO = () => new Date().toISOString();
const todayKey = () => new Date().toISOString().slice(0, 10);
const BACKUP_META_KEY = 'examPlanner.confusingWords.lastBackupAt';
const BACKUP_BASE_URL_KEY = 'examPlanner.confusingWords.backupBaseUrl';
const BACKUP_PASSWORD_KEY = 'examPlanner.confusingWords.backupPassword';
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;

const printModeLabel: Record<PrintMode, string> = {
  'meaning-to-word': '中文释义默写英文',
  'word-to-meaning': '英文默写中文',
  'comparison-table': '对比表默写',
  blank: '完全空白',
};

export function ConfusingWordsPage() {
  const [initialGroups] = useState(() => loadGroups());
  const [groups, setGroups] = useState<ConfusingWordGroup[]>(initialGroups);
  const [selectedId, setSelectedId] = useState(initialGroups[0]?.id ?? '');
  const [wordInput, setWordInput] = useState('');
  const [query, setQuery] = useState('');
  const [printMode, setPrintMode] = useState<PrintMode>('word-to-meaning');
  const [printScope, setPrintScope] = useState<'current' | 'all'>('current');
  const [toast, setToast] = useState('');
  const [lastBackupAt, setLastBackupAt] = useState(() => localStorage.getItem(BACKUP_META_KEY) || '');

  const selectedGroup = groups.find((group) => group.id === selectedId);
  const totalWords = groups.reduce((sum, group) => sum + group.words.length, 0);
  const todayWords = groups.reduce((sum, group) => sum + group.words.filter((word) => word.createdAt.slice(0, 10) === todayKey()).length, 0);

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return groups
      .filter((group) => !normalized || group.title.toLowerCase().includes(normalized) || group.words.some((word) => word.word.toLowerCase().includes(normalized)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [groups, query]);

  const persist = (next: ConfusingWordGroup[], message?: string) => {
    setGroups(next);
    saveGroups(next);
    if (message) {
      setToast(message);
      window.setTimeout(() => setToast(''), 1600);
    }
  };

  const updateGroup = (id: string, updater: (group: ConfusingWordGroup) => ConfusingWordGroup) => {
    persist(groups.map((group) => group.id === id ? updater(group) : group));
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

  const lookupWords = async (groupId: string, wordsToLookup: Array<{ id: string; word: string }>) => {
    for (const entry of wordsToLookup) {
      updateWord(groupId, entry.id, { queryStatus: 'loading' });
      try {
        const result = await queryDictionary(entry.word);
        updateWord(groupId, entry.id, { ...result, queryStatus: 'success' });
      } catch {
        updateWord(groupId, entry.id, { queryStatus: 'failed' });
      }
    }
  };

  const createNewGroup = () => {
    const words = parseWords(wordInput);
    if (words.length < 2) return alert('请输入至少两个易混单词');
    const group = createGroup(words);
    const next = [group, ...groups];
    persist(next, '已创建单词组');
    setSelectedId(group.id);
    setWordInput('');
    void lookupWords(group.id, group.words.map((word) => ({ id: word.id, word: word.word })));
  };

  const addWordsToCurrentGroup = () => {
    if (!selectedGroup) return;
    const words = parseWords(wordInput).filter((word) => !selectedGroup.words.some((item) => item.word.toLowerCase() === word));
    if (!words.length) return alert('请输入要添加的单词');
    const newWords = words.map(createWord);
    updateGroup(selectedGroup.id, (group) => ({
      ...group,
      title: [...group.words, ...newWords].map((word) => word.word).join(' / '),
      words: [...group.words, ...newWords],
      updatedAt: nowISO(),
    }));
    setWordInput('');
    void lookupWords(selectedGroup.id, newWords.map((word) => ({ id: word.id, word: word.word })));
  };

  const removeWord = (groupId: string, wordId: string) => {
    if (!confirm('确定删除这个单词吗？')) return;
    updateGroup(groupId, (group) => {
      const words = group.words.filter((word) => word.id !== wordId);
      return { ...group, title: words.map((word) => word.word).join(' / ') || group.title, words, updatedAt: nowISO() };
    });
  };

  const deleteGroup = (id: string) => {
    if (!confirm('确定删除这个单词组吗？')) return;
    const next = groups.filter((group) => group.id !== id);
    persist(next, '已删除单词组');
    setSelectedId(next[0]?.id ?? '');
  };

  const printGroups = () => {
    const targets = printScope === 'all' ? groups : selectedGroup ? [selectedGroup] : [];
    if (!targets.length) return alert('请选择要打印的单词组');
    openPrintWindow(targets, printMode);
  };

  const performBackup = useCallback(async () => {
    if (!groups.length) return;
    if (lastBackupAt && Date.now() - new Date(lastBackupAt).getTime() < BACKUP_INTERVAL_MS) return;
    try {
      const result = await backupConfusingWords(buildExport(groups), {
        baseUrl: localStorage.getItem(BACKUP_BASE_URL_KEY) || '',
        password: localStorage.getItem(BACKUP_PASSWORD_KEY) || '',
      });
      localStorage.setItem(BACKUP_META_KEY, result.backedUpAt);
      setLastBackupAt(result.backedUpAt);
    } catch {
      // 本地优先：备份失败不打断当前学习记录。
    }
  }, [groups, lastBackupAt]);

  useEffect(() => {
    const firstRun = window.setTimeout(() => void performBackup(), 0);
    const timer = window.setInterval(() => void performBackup(), BACKUP_INTERVAL_MS);
    return () => {
      window.clearTimeout(firstRun);
      window.clearInterval(timer);
    };
  }, [performBackup]);

  return (
    <Page title="易混单词" subtitle="左侧输入一组单词，中间整理成英文和中文释义卡片。">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="单词组" value={`${groups.length} 组`} />
        <MetricCard label="单词数" value={`${totalWords} 个`} />
        <MetricCard label="今日新增" value={`${todayWords} 个`} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[320px_1fr_260px]">
        <aside className="space-y-5">
          <div className="card p-5">
            <h2 className="text-base font-semibold">输入单词</h2>
            <textarea
              className="field mt-4 min-h-28"
              placeholder="affect, effect&#10;adapt adopt"
              value={wordInput}
              onChange={(event) => setWordInput(event.target.value)}
            />
            <div className="mt-3 grid gap-2">
              <button className="btn btn-primary" onClick={createNewGroup}><Plus size={16} />新建这一组</button>
              <button className="btn btn-soft" onClick={addWordsToCurrentGroup}>加入当前组</button>
            </div>
          </div>

          <div className="card p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 text-slate-400" size={16} />
              <input className="field pl-9" placeholder="搜索组或单词" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </div>

          <div className="space-y-3">
            {filteredGroups.length ? filteredGroups.map((group) => (
              <button
                key={group.id}
                className={`card w-full p-4 text-left transition hover:border-blue-200 ${selectedId === group.id ? 'ring-2 ring-blue-200' : ''}`}
                onClick={() => setSelectedId(group.id)}
              >
                <span className="block font-semibold text-slate-950">{group.title}</span>
                <span className="mt-2 block text-sm text-slate-500">{group.words.length} 个单词 · {group.updatedAt.slice(0, 10)}</span>
              </button>
            )) : <EmptyState title="没有匹配的单词组" />}
          </div>
        </aside>

        <section className="space-y-4">
          {selectedGroup ? (
            <>
              <div className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <input
                    className="min-w-0 flex-1 border-0 bg-transparent text-xl font-semibold outline-none"
                    value={selectedGroup.title}
                    onChange={(event) => updateGroup(selectedGroup.id, (group) => ({ ...group, title: event.target.value, updatedAt: nowISO() }))}
                  />
                  <button className="btn btn-danger" onClick={() => deleteGroup(selectedGroup.id)}><Trash2 size={16} />删除组</button>
                </div>
              </div>

              <div className="grid gap-3">
                {selectedGroup.words.map((word) => (
                  <div key={word.id} className="card grid gap-3 p-4 md:grid-cols-[220px_1fr_auto]">
                    <input
                      className="field text-lg font-semibold"
                      value={word.word}
                      onChange={(event) => updateWord(selectedGroup.id, word.id, { word: event.target.value })}
                    />
                    <input
                      className="field"
                      placeholder={word.queryStatus === 'loading' ? '正在查询词义...' : word.queryStatus === 'failed' ? '查询失败，请手动填写中文释义' : '填写中文释义'}
                      value={word.chineseDefinition}
                      onChange={(event) => updateWord(selectedGroup.id, word.id, { chineseDefinition: event.target.value })}
                    />
                    <div className="flex gap-2">
                      <button className="btn btn-soft" onClick={() => lookupWords(selectedGroup.id, [{ id: word.id, word: word.word }])}>查询</button>
                      <button className="btn btn-danger" onClick={() => removeWord(selectedGroup.id, word.id)}><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : <EmptyState title="先在左侧新建一个单词组" />}
        </section>

        <aside className="card h-fit p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Printer size={18} />打印</h2>
          <select className="field mt-4" value={printMode} onChange={(event) => setPrintMode(event.target.value as PrintMode)}>
            {Object.entries(printModeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="field mt-3" value={printScope} onChange={(event) => setPrintScope(event.target.value as 'current' | 'all')}>
            <option value="current">打印当前组</option>
            <option value="all">打印全部组</option>
          </select>
          <button className="btn btn-primary mt-4 w-full" onClick={printGroups}><FileText size={16} />预览并打印</button>
        </aside>
      </div>
      <Toast message={toast} />
    </Page>
  );
}
