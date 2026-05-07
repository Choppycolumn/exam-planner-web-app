import type { ConfusingWordsExport } from './types';

export interface ConfusingWordsBackup extends ConfusingWordsExport {
  backedUpAt?: string;
}

export interface BackupSettings {
  baseUrl: string;
  password: string;
}

const endpoint = (baseUrl: string) => `${baseUrl.replace(/\/$/, '')}/api/confusing-words/backup`;

export async function backupConfusingWords(payload: ConfusingWordsExport, settings: BackupSettings) {
  const response = await fetch(endpoint(settings.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, password: settings.password || undefined }),
  });
  if (!response.ok) {
    throw new Error('Backup failed');
  }
  return response.json() as Promise<{ ok: true; backedUpAt: string }>;
}

export async function fetchConfusingWordsBackup(settings: BackupSettings) {
  const response = await fetch(endpoint(settings.baseUrl), {
    headers: settings.password ? { 'x-backup-password': settings.password } : undefined,
  });
  if (!response.ok) {
    throw new Error('Backup fetch failed');
  }
  return response.json() as Promise<ConfusingWordsBackup | null>;
}
