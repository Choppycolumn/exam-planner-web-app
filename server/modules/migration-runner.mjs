import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

function migrationVersion(fileName) {
  const match = /^(\d+)_/.exec(fileName);
  return match ? Number(match[1]) : 0;
}

export function runSqlMigrations({ sqlite, migrationsDir, currentVersion = 0, setVersion, shouldApply = () => true }) {
  const files = readdirSync(migrationsDir)
    .filter((file) => /^\d+_.+\.sql$/i.test(file))
    .sort((a, b) => migrationVersion(a) - migrationVersion(b));

  const applied = [];
  for (const file of files) {
    const version = migrationVersion(file);
    if (!version || version <= currentVersion) continue;
    if (!shouldApply(file, version)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    sqlite.run(`BEGIN IMMEDIATE;\n${sql}\nCOMMIT;`);
    setVersion(version);
    applied.push({ version, fileName: basename(file) });
  }
  return applied;
}
