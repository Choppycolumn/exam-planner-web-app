import { describe, expect, it } from 'vitest';
import { backupKind, resolveBackupPath } from './backup-validation.mjs';

describe('backup restore validation', () => {
  it('allows a valid backup inside the backup directory', () => {
    expect(resolveBackupPath('/srv/backups', 'exam-planner-weekly-1.sqlite')).toContain('exam-planner-weekly-1.sqlite');
    expect(backupKind('exam-planner-weekly-1.sqlite')).toBe('weekly');
  });

  it('rejects path traversal before restore', () => {
    expect(() => resolveBackupPath('/srv/backups', '../secret.sqlite')).toThrow('Invalid backup file name');
  });
});
