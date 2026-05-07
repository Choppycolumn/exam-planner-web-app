import type { ConfusingWordEntry, ConfusingWordGroup, ConfusingWordsExport, WordMastery } from './types';

const STORAGE_KEY = 'examPlanner.confusingWords.v1';
const SCHEMA_VERSION = 1;

const nowISO = () => new Date().toISOString();
const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const masteryLabel: Record<WordMastery, string> = {
  unknown: '未掌握',
  vague: '模糊',
  familiar: '基本掌握',
  mastered: '已掌握',
};

export const defaultTags = ['拼写相近', '发音相近', '词义相近', '考研词汇', '四六级', 'GRE'];

export function createWord(word: string): ConfusingWordEntry {
  const timestamp = nowISO();
  return {
    id: id(),
    word,
    phonetic: '',
    partOfSpeech: '',
    englishDefinition: '',
    chineseDefinition: '',
    example: '',
    usage: '',
    mastery: 'unknown',
    queryStatus: 'idle',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function createGroup(words: string[] = []): ConfusingWordGroup {
  const timestamp = nowISO();
  const cleanWords = [...new Set(words.map((word) => word.trim().toLowerCase()).filter(Boolean))];
  return {
    id: id(),
    title: cleanWords.length ? cleanWords.join(' / ') : '新的易混单词组',
    note: '',
    confusionSummary: '',
    tags: [],
    status: 'review',
    words: cleanWords.map(createWord),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function parseWords(input: string) {
  return [...new Set(input.split(/[\s,，;；]+/).map((word) => word.trim().toLowerCase()).filter(Boolean))];
}

export function loadGroups(): ConfusingWordGroup[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const examples = [
      { words: ['affect', 'effect'], tags: ['考研词汇', '词义相近'], summary: 'affect 通常作动词，表示影响；effect 通常作名词，表示结果或效果。' },
      { words: ['adapt', 'adopt'], tags: ['拼写相近'], summary: 'adapt 表示适应或改编；adopt 表示采纳或收养。' },
    ];
    const groups = examples.map((example) => ({ ...createGroup(example.words), tags: example.tags, confusionSummary: example.summary }));
    saveGroups(groups);
    return groups;
  }
  try {
    const parsed = JSON.parse(raw) as ConfusingWordsExport;
    return Array.isArray(parsed.groups) ? parsed.groups : [];
  } catch {
    return [];
  }
}

export function saveGroups(groups: ConfusingWordGroup[]) {
  const payload: ConfusingWordsExport = { schemaVersion: SCHEMA_VERSION, exportedAt: nowISO(), groups };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function buildExport(groups: ConfusingWordGroup[]): ConfusingWordsExport {
  return { schemaVersion: SCHEMA_VERSION, exportedAt: nowISO(), groups };
}
