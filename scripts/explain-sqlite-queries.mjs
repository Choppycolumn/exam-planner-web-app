import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const sqliteFile = resolve(process.argv[2] || 'data/exam-planner.sqlite');
if (!existsSync(sqliteFile)) {
  console.error(`SQLite file not found: ${sqliteFile}`);
  process.exit(1);
}

const queries = {
  dashboardToday: `SELECT COALESCE(total_minutes, 0) FROM study_daily_summaries WHERE date = date('now');`,
  reviewsByDate: `SELECT * FROM daily_reviews WHERE date BETWEEN '2026-01-01' AND '2026-12-31' ORDER BY date DESC LIMIT 20;`,
  projectTotals: `SELECT project_name_snapshot, SUM(minutes) FROM study_time_records WHERE date BETWEEN '2026-01-01' AND '2026-12-31' GROUP BY project_name_snapshot;`,
  visitSummary: `SELECT path, COUNT(*) FROM visit_events WHERE substr(created_at, 1, 10) >= date('now', '-14 day') GROUP BY path ORDER BY COUNT(*) DESC LIMIT 8;`,
};

for (const [name, sql] of Object.entries(queries)) {
  const result = spawnSync('sqlite3', [sqliteFile], { input: `.headers on\n.mode table\nEXPLAIN QUERY PLAN ${sql}`, encoding: 'utf8' });
  console.log(`\n== ${name} ==`);
  console.log(result.stdout || result.stderr);
}
