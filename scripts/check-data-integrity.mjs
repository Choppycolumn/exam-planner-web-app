import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const sqliteFile = resolve(process.argv[2] || 'data/exam-planner.sqlite');
const fix = process.argv.includes('--fix');

function runSqlite(sql) {
  const result = spawnSync('sqlite3', [sqliteFile], { input: `.mode json\n${sql}`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : [];
}

if (!existsSync(sqliteFile)) {
  console.error(`SQLite file not found: ${sqliteFile}`);
  process.exit(1);
}

const checks = [
  {
    name: 'duplicate_study_records',
    sql: `SELECT date, project_id AS projectId, COUNT(*) AS count FROM study_time_records GROUP BY date, project_id HAVING COUNT(*) > 1;`,
  },
  {
    name: 'negative_minutes',
    sql: `SELECT id, date, minutes FROM study_time_records WHERE minutes < 0;`,
  },
  {
    name: 'invalid_review_score',
    sql: `SELECT id, date, score FROM daily_reviews WHERE score < 1 OR score > 10;`,
  },
  {
    name: 'orphan_library_chunks',
    sql: `SELECT c.id, c.book_id AS bookId FROM library_text_chunks c LEFT JOIN library_books b ON b.id = c.book_id WHERE b.id IS NULL LIMIT 100;`,
  },
  {
    name: 'orphan_error_occurrences',
    sql: `SELECT o.id, o.theme_id AS themeId FROM error_theme_occurrences o LEFT JOIN error_themes t ON t.id = o.theme_id WHERE t.id IS NULL LIMIT 100;`,
  },
];

const findings = checks.map((check) => ({ name: check.name, rows: runSqlite(check.sql) }));
const issueCount = findings.reduce((sum, item) => sum + item.rows.length, 0);
console.log(JSON.stringify({ sqliteFile, fix, issueCount, findings }, null, 2));

if (fix && issueCount) {
  runSqlite(`UPDATE study_time_records SET minutes = 0 WHERE minutes < 0;
UPDATE daily_reviews SET score = 1 WHERE score < 1;
UPDATE daily_reviews SET score = 10 WHERE score > 10;
DELETE FROM library_text_chunks WHERE book_id NOT IN (SELECT id FROM library_books);
DELETE FROM error_theme_occurrences WHERE theme_id NOT IN (SELECT id FROM error_themes);`);
  console.log(JSON.stringify({ fixed: true }, null, 2));
}

process.exit(issueCount ? 2 : 0);
