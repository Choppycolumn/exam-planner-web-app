import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const backupsDir = resolve(process.argv[2] || 'data/backups');
const files = readdirSync(backupsDir).filter((name) => /^exam-planner-[a-z-]+-.+\.sqlite$/.test(name));

const results = files.map((fileName) => {
  const filePath = join(backupsDir, fileName);
  const result = spawnSync('sqlite3', [filePath, 'PRAGMA integrity_check;'], { encoding: 'utf8', timeout: 30_000 });
  return {
    fileName,
    sizeBytes: statSync(filePath).size,
    ok: result.status === 0 && result.stdout.trim() === 'ok',
    output: (result.stderr || result.stdout || '').trim(),
  };
});

console.log(JSON.stringify({ backupsDir, count: results.length, failed: results.filter((item) => !item.ok), results }, null, 2));
process.exit(results.every((item) => item.ok) ? 0 : 1);
