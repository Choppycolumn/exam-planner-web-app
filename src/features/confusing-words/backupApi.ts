import type { ConfusingWordsExport } from './types';

export interface ConfusingWordsBackup extends ConfusingWordsExport {
  backedUpAt?: string;
}

export interface ConfusingWordsBackupSummary {
  groupCount: number;
  wordCount: number;
  payloadBytes: number;
  payloadHash?: string;
}

export interface ConfusingWordsBackupVersion extends ConfusingWordsBackupSummary {
  id: number;
  schemaVersion: number;
  exportedAt?: string;
  backedUpAt: string;
  source: string;
  createdAt: string;
}

export interface BackupSettings {
  baseUrl: string;
  syncToken: string;
}

export interface BackupWriteOptions {
  force?: boolean;
  source?: string;
}

const endpoint = (baseUrl: string) => `${baseUrl.replace(/\/$/, '')}/api/confusing-words/backup`;
const versionEndpoint = (baseUrl: string) => `${endpoint(baseUrl)}/versions`;
const restoreEndpoint = (baseUrl: string) => `${endpoint(baseUrl)}/restore`;

export class ConfusingWordsBackupConflictError extends Error {
  server?: ConfusingWordsBackupSummary;
  incoming?: ConfusingWordsBackupSummary;

  constructor(server?: ConfusingWordsBackupSummary, incoming?: ConfusingWordsBackupSummary) {
    super('Server backup is larger than incoming backup');
    this.name = 'ConfusingWordsBackupConflictError';
    this.server = server;
    this.incoming = incoming;
  }
}

export async function backupConfusingWords(payload: ConfusingWordsExport, settings: BackupSettings, options: BackupWriteOptions = {}) {
  const response = await fetch(endpoint(settings.baseUrl), {
    method: 'POST',
    credentials: settings.baseUrl ? 'omit' : 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      syncToken: settings.syncToken || undefined,
      force: options.force || undefined,
      source: options.source || undefined,
    }),
  });
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    throw new ConfusingWordsBackupConflictError(body.server, body.incoming);
  }
  if (!response.ok) {
    throw new Error('Backup failed');
  }
  return response.json() as Promise<{ ok: true; backedUpAt: string } & ConfusingWordsBackupSummary>;
}

export async function fetchConfusingWordsBackup(settings: BackupSettings) {
  const response = await fetch(endpoint(settings.baseUrl), {
    credentials: settings.baseUrl ? 'omit' : 'same-origin',
    headers: settings.syncToken ? { 'x-backup-token': settings.syncToken } : undefined,
  });
  if (!response.ok) {
    throw new Error('Backup fetch failed');
  }
  return response.json() as Promise<ConfusingWordsBackup | null>;
}

export async function fetchConfusingWordsBackupVersions(settings: BackupSettings) {
  const response = await fetch(versionEndpoint(settings.baseUrl), {
    credentials: settings.baseUrl ? 'omit' : 'same-origin',
    headers: settings.syncToken ? { 'x-backup-token': settings.syncToken } : undefined,
  });
  if (!response.ok) {
    throw new Error('Backup versions fetch failed');
  }
  return response.json() as Promise<{ items: ConfusingWordsBackupVersion[] }>;
}

export async function restoreConfusingWordsBackupVersion(versionId: number, settings: BackupSettings) {
  const response = await fetch(restoreEndpoint(settings.baseUrl), {
    method: 'POST',
    credentials: settings.baseUrl ? 'omit' : 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ versionId, syncToken: settings.syncToken || undefined }),
  });
  if (!response.ok) {
    throw new Error('Backup version restore failed');
  }
  return response.json() as Promise<{ ok: true; backedUpAt: string } & ConfusingWordsBackupSummary>;
}
