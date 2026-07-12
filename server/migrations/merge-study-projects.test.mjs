import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('study project consolidation migration', () => {
  it('merges aliases without dropping accumulated minutes', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE study_projects(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER,sort_order INTEGER,updated_at TEXT);
      CREATE TABLE study_time_records(id INTEGER PRIMARY KEY,date TEXT,project_id INTEGER,project_name_snapshot TEXT,minutes INTEGER,note TEXT,schema_version INTEGER,created_at TEXT,updated_at TEXT,UNIQUE(date,project_id));
      CREATE TABLE study_daily_summaries(date TEXT PRIMARY KEY);
      CREATE TABLE study_project_daily_summaries(date TEXT,project_id INTEGER);
      CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
      INSERT INTO study_projects VALUES
        (1,'高等数学',1,1,NULL),(2,'1000题a组',1,2,NULL),(3,'英一',1,3,NULL),(4,'英语单词',1,4,NULL),
        (5,'信号与系统',1,5,NULL),(6,'专业课',1,6,NULL),(7,'复盘总结',1,7,NULL);
      INSERT INTO study_time_records VALUES
        (1,'2026-07-12',1,'高等数学',30,'高数',1,'now',NULL),
        (2,'2026-07-12',2,'1000题a组',20,'题组',1,'now',NULL),
        (3,'2026-07-12',3,'英一',40,'阅读',1,'now',NULL),
        (4,'2026-07-12',4,'英语单词',15,'单词',1,'now',NULL),
        (5,'2026-07-12',5,'信号与系统',50,'系统',1,'now',NULL),
        (6,'2026-07-12',6,'专业课',10,'专业',1,'now',NULL),
        (7,'2026-07-12',7,'复盘总结',5,'复盘',1,'now',NULL);
    `);
    database.exec(readFileSync(new URL('./022_merge_study_projects.sql', import.meta.url), 'utf8'));
    const projects = database.prepare('SELECT name FROM study_projects ORDER BY id').all().map((row) => row.name);
    const records = Object.fromEntries(database.prepare('SELECT project_name_snapshot AS name,minutes FROM study_time_records').all().map((row) => [row.name, row.minutes]));
    expect(projects).toEqual(['高等数学', '英一', '信号与系统']);
    expect(records).toEqual({ 高等数学: 50, 英一: 55, 信号与系统: 60 });
    database.close();
  });
});
