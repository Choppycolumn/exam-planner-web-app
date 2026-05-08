import type { ConfusingWordEntry } from './types';

type FreeDictionaryResponse = Array<{
  phonetic?: string;
  phonetics?: Array<{ text?: string }>;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string; example?: string }>;
  }>;
}>;

type TranslationResponse = {
  responseData?: {
    translatedText?: string;
  };
};

async function queryServerDictionary(word: string): Promise<Partial<ConfusingWordEntry> | null> {
  try {
    const response = await fetch(`/api/dictionary/lookup?word=${encodeURIComponent(word)}`);
    if (!response.ok) return null;
    const data = await response.json() as Partial<ConfusingWordEntry>;
    if (!data.chineseDefinition) return null;
    return {
      phonetic: data.phonetic || '',
      partOfSpeech: data.partOfSpeech || '',
      englishDefinition: data.englishDefinition || '',
      chineseDefinition: data.chineseDefinition,
      queryStatus: 'success',
    };
  } catch {
    return null;
  }
}

async function translateToChinese(text: string) {
  if (!text.trim()) return '';
  try {
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|zh-CN`);
    if (!response.ok) return '';
    const data = (await response.json()) as TranslationResponse;
    return data.responseData?.translatedText?.trim() || '';
  } catch {
    return '';
  }
}

export async function queryDictionary(word: string): Promise<Partial<ConfusingWordEntry>> {
  const serverResult = await queryServerDictionary(word);
  if (serverResult) return serverResult;

  const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!response.ok) {
    throw new Error('Dictionary lookup failed');
  }
  const data = (await response.json()) as FreeDictionaryResponse;
  const first = data[0];
  const meaning = first?.meanings?.[0];
  const definition = meaning?.definitions?.[0];
  const englishDefinition = definition?.definition || '';
  const chineseDefinition = await translateToChinese(englishDefinition || word);

  return {
    phonetic: first?.phonetic || first?.phonetics?.find((item) => item.text)?.text || '',
    partOfSpeech: meaning?.partOfSpeech || '',
    englishDefinition,
    chineseDefinition,
    example: definition?.example || '',
    usage: meaning?.partOfSpeech ? `Commonly used as ${meaning.partOfSpeech}.` : '',
    queryStatus: 'success',
  };
}
