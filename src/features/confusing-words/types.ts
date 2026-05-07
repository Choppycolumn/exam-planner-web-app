export type WordMastery = 'unknown' | 'vague' | 'familiar' | 'mastered';
export type GroupStatus = 'review' | 'mastered';
export type PrintMode = 'meaning-to-word' | 'word-to-meaning' | 'comparison-table' | 'blank';

export interface ConfusingWordEntry {
  id: string;
  word: string;
  phonetic: string;
  partOfSpeech: string;
  englishDefinition: string;
  chineseDefinition: string;
  example: string;
  usage: string;
  mastery: WordMastery;
  queryStatus: 'idle' | 'loading' | 'success' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface ConfusingWordGroup {
  id: string;
  title: string;
  note: string;
  confusionSummary: string;
  tags: string[];
  status: GroupStatus;
  words: ConfusingWordEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface ConfusingWordsExport {
  schemaVersion: number;
  exportedAt: string;
  groups: ConfusingWordGroup[];
}
