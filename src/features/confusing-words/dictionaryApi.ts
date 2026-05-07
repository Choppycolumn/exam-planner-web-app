import type { ConfusingWordEntry } from './types';

type FreeDictionaryResponse = Array<{
  phonetic?: string;
  phonetics?: Array<{ text?: string }>;
  meanings?: Array<{
    partOfSpeech?: string;
    definitions?: Array<{ definition?: string; example?: string }>;
  }>;
}>;

export async function queryDictionary(word: string): Promise<Partial<ConfusingWordEntry>> {
  const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
  if (!response.ok) {
    throw new Error('Dictionary lookup failed');
  }
  const data = (await response.json()) as FreeDictionaryResponse;
  const first = data[0];
  const meaning = first?.meanings?.[0];
  const definition = meaning?.definitions?.[0];

  return {
    phonetic: first?.phonetic || first?.phonetics?.find((item) => item.text)?.text || '',
    partOfSpeech: meaning?.partOfSpeech || '',
    englishDefinition: definition?.definition || '',
    example: definition?.example || '',
    usage: meaning?.partOfSpeech ? `Commonly used as ${meaning.partOfSpeech}.` : '',
    queryStatus: 'success',
  };
}
