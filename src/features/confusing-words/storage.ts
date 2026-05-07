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
      { words: [{ word: 'affect', chineseDefinition: '影响' }, { word: 'effect', chineseDefinition: '结果；效果' }] },
      { words: [{ word: 'adapt', chineseDefinition: '适应；改编' }, { word: 'adopt', chineseDefinition: '采纳；收养' }] },
    ];
    const groups = examples.map((example) => {
      const group = createGroup(example.words.map((item) => item.word));
      return {
        ...group,
        words: group.words.map((word) => ({
          ...word,
          chineseDefinition: example.words.find((item) => item.word === word.word)?.chineseDefinition || '',
        })),
      };
    });
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
