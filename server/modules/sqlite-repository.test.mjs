import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { createSqliteRepository } from './sqlite-repository.mjs';

const temporaryDirectories = [];

function repositoryFixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'exam-planner-sqlite-'));
  temporaryDirectories.push(dataDir);
  return createSqliteRepository({ sqliteFile: join(dataDir, 'test.sqlite'), dataDir });
}

afterEach(() => {
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

describe('persistent sqlite repository', () => {
  test('executes parameterized reads and writes on one reusable connection', () => {
    const repository = repositoryFixture();
    repository.run('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT NOT NULL);');
    repository.execute('INSERT INTO sample(value) VALUES (?);', ["user's value"]);

    expect(repository.scalar('SELECT COUNT(*) FROM sample;')).toBe('1');
    expect(repository.json('SELECT value FROM sample;')).toEqual([{ value: "user's value" }]);
    const metrics = repository.metrics();
    expect(repository.open()).toBe(repository.open());
    repository.close();
    expect(metrics).toMatchObject({ calls: 4, open: true, slowCalls: 0 });
  });

  test('reopens after close and rolls back failed transactions', () => {
    const repository = repositoryFixture();
    repository.run('CREATE TABLE sample (id INTEGER PRIMARY KEY, value TEXT UNIQUE); INSERT INTO sample(value) VALUES (\'one\');');
    repository.close();

    expect(repository.scalar('SELECT value FROM sample LIMIT 1;')).toBe('one');
    expect(() => repository.transaction([
      "INSERT INTO sample(value) VALUES ('two');",
      "INSERT INTO sample(value) VALUES ('one');",
    ])).toThrow();
    expect(repository.json('SELECT value FROM sample ORDER BY id;')).toEqual([{ value: 'one' }]);
    repository.close();
  });
});
