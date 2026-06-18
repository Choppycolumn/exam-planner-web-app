import { basename, join, resolve } from 'node:path';

export function resolveBackupPath(backupsDir, fileName) {
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName || '')) throw new Error('Invalid backup file name');
  const root = resolve(backupsDir);
  const filePath = resolve(join(root, fileName));
  if (!filePath.startsWith(`${root}\\`) && !filePath.startsWith(`${root}/`)) throw new Error('Backup path escapes backup directory');
  return filePath;
}

export function backupKind(fileName) {
  return basename(fileName).match(/^exam-planner-([a-z-]+)-.+\.sqlite$/)?.[1] || 'unknown';
}
