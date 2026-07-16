import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteCli, runSqliteFile, sqliteIntegrityCheck, sqlitePath } from '../core/sqlite-cli.mjs';
import { createSqliteRepository } from '../modules/sqlite-repository.mjs';
import { createDictionaryRepository } from '../repositories/dictionary-repository.mjs';
import { createDictionaryService } from './dictionary-service.mjs';

const directories = [];
afterEach(() => { while (directories.length) rmSync(directories.pop(), { recursive: true, force: true }); });

describe('dictionary service', () => {
  it('moves legacy dictionary rows into a dedicated database before dropping the old table', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'exam-planner-dictionary-'));
    directories.push(dataDir);
    const primaryFile = join(dataDir, 'primary.sqlite');
    const dictionaryFile = join(dataDir, 'dictionary.sqlite');
    const primary = createSqliteRepository({ sqliteFile: primaryFile, dataDir });
    primary.run(`CREATE TABLE dictionary_entries (
word TEXT PRIMARY KEY, phonetic TEXT, english_definition TEXT, chinese_definition TEXT,
part_of_speech TEXT, collins INTEGER, oxford INTEGER, tag TEXT, bnc INTEGER,
frequency INTEGER, exchange TEXT, detail TEXT, audio TEXT, updated_at TEXT);
INSERT INTO dictionary_entries(word,english_definition,chinese_definition,updated_at) VALUES('focus','attention','专注',datetime('now'));`);
    const dictionaryDatabase = createSqliteRepository({ sqliteFile: dictionaryFile, dataDir });
    const repository = createDictionaryRepository(dictionaryDatabase);
    const backup = vi.fn(() => ({ filePath: 'safety.sqlite' }));
    const service = createDictionaryService({
      repository,
      primaryDatabase: primary,
      dictionarySqliteFile: dictionaryFile,
      sourceCsv: '',
      runSqliteFile,
      sqlitePath,
      sqliteIntegrityCheck,
      nowISO: () => '2026-07-16T00:00:00.000Z',
      createSafetyBackup: backup,
    });
    const result = service.ensureReady();
    expect(result.count).toBe(1);
    expect(service.find('focus')).toMatchObject({ word: 'focus', chinese_definition: '专注' });
    expect(Number(primary.scalar("SELECT COUNT(*) FROM sqlite_master WHERE name='dictionary_entries';"))).toBe(0);
    expect(backup).toHaveBeenCalledOnce();
    createSqliteCli({ repository: primary }).closeSqlite();
    dictionaryDatabase.close();
  });
});
