import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Printer, Search, Trash2 } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { backupConfusingWords } from '../features/confusing-words/backupApi';
import { queryDictionary } from '../features/confusing-words/dictionaryApi';
import { openPrintWindow } from '../features/confusing-words/print';
import { buildExport, createGroup, loadGroups, parseWords, saveGroups } from '../features/confusing-words/storage';
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

  const selectedGroup = groups.find((group) => group.id === selectedId) ?? groups[0];
  const totalWords = groups.reduce((sum, group) => sum + group.words.length, 0);
  const todayWords = groups.reduce((sum, group) => sum + group.words.filter((word) => word.createdAt.slice(0, 10) === todayKey()).length, 0);

  const filteredGroups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return groups
      .filter((group) => !normalized || group.words.some((word) => word.word.toLowerCase().includes(normalized) || word.chineseDefinition.includes(query.trim())))
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

  const updateWord = (groupId: string, wordId: string, patch: Partial<ConfusingWordEntry>) => {
    setGroups((current) => {
      const next = current.map((group) => group.id === groupId ? {
        ...group,
        title: group.words.map((word) => word.word).join(' / '),
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
    persist(next, '已创建单词卡');
    setSelectedId(group.id);
    setWordInput('');
    void lookupWords(group.id, group.words.map((word) => ({ id: word.id, word: word.word })));
  };

  const deleteGroup = (id: string) => {
    if (!confirm('确定删除整张单词卡吗？')) return;
    const next = groups.filter((group) => group.id !== id);
    persist(next, '已删除单词卡');
    setSelectedId(next[0]?.id ?? '');
  };

  const printGroups = () => {
    const targets = printScope === 'all' ? groups : selectedGroup ? [selectedGroup] : [];
    if (!targets.length) return alert('请选择要打印的单词卡');
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
    <Page title="易混单词" subtitle="输入一组易混词，生成英文和中文释义对照卡。">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="单词卡" value={`${groups.length} 张`} />
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
            <button className="btn btn-primary mt-3 w-full" onClick={createNewGroup}><Plus size={16} />生成单词卡</button>
          </div>

          <div className="card p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 text-slate-400" size={16} />
              <input className="field pl-9" placeholder="搜索英文或中文" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </div>
        </aside>

        <section className="space-y-4">
          {filteredGroups.length ? filteredGroups.map((group) => (
            <article
              key={group.id}
              className={`card p-5 transition ${selectedGroup?.id === group.id ? 'ring-2 ring-blue-200' : ''}`}
              onClick={() => setSelectedId(group.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {group.words.map((word) => <span key={word.id} className="rounded bg-slate-100 px-2.5 py-1 text-sm font-semibold text-slate-700">{word.word}</span>)}
                </div>
                <button className="btn btn-danger shrink-0" onClick={(event) => { event.stopPropagation(); deleteGroup(group.id); }}><Trash2 size={16} />删除卡片</button>
              </div>

              <div className="mt-4 divide-y divide-slate-100">
                {group.words.map((word) => (
                  <div key={word.id} className="grid gap-3 py-3 md:grid-cols-[220px_1fr]">
                    <input
                      className="field text-lg font-semibold"
                      value={word.word}
                      onChange={(event) => updateWord(group.id, word.id, { word: event.target.value })}
                    />
                    <input
                      className="field"
                      placeholder={word.queryStatus === 'loading' ? '正在查询中文释义...' : word.queryStatus === 'failed' ? '查询失败，请手动填写中文释义' : '中文释义'}
                      value={word.chineseDefinition}
                      onChange={(event) => updateWord(group.id, word.id, { chineseDefinition: event.target.value })}
                    />
                  </div>
                ))}
              </div>
            </article>
          )) : <EmptyState title="还没有单词卡" description="在左侧输入至少两个单词后生成。" />}
        </section>

        <aside className="card h-fit p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Printer size={18} />打印</h2>
          <select className="field mt-4" value={printMode} onChange={(event) => setPrintMode(event.target.value as PrintMode)}>
            {Object.entries(printModeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="field mt-3" value={printScope} onChange={(event) => setPrintScope(event.target.value as 'current' | 'all')}>
            <option value="current">打印选中卡片</option>
            <option value="all">打印全部卡片</option>
          </select>
          <button className="btn btn-primary mt-4 w-full" onClick={printGroups}><FileText size={16} />预览并打印</button>
        </aside>
      </div>
      <Toast message={toast} />
    </Page>
  );
}
