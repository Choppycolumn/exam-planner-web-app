import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('learner data isolation migration', () => {
  it('assigns existing rows to the primary account and supports duplicate dates per user', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE goals(id INTEGER PRIMARY KEY,name TEXT,description TEXT,deadline TEXT,is_active INTEGER,type TEXT,notes TEXT,schema_version INTEGER,created_at TEXT,updated_at TEXT);
      CREATE TABLE subjects(id INTEGER PRIMARY KEY,name TEXT,color TEXT,is_active INTEGER,sort_order INTEGER,schema_version INTEGER,created_at TEXT,updated_at TEXT);
      CREATE TABLE mock_exam_records(id INTEGER PRIMARY KEY,date TEXT,subject_id INTEGER,subject_name_snapshot TEXT,score REAL,full_score REAL,paper_name TEXT,duration_minutes INTEGER,wrong_count INTEGER,note TEXT,schema_version INTEGER,created_at TEXT,updated_at TEXT);
      CREATE TABLE short_term_tasks(id INTEGER PRIMARY KEY,title TEXT,due_date TEXT,due_time TEXT,urgency TEXT,is_completed INTEGER,completed_at TEXT,reminder_enabled INTEGER,reminder_sent_offsets TEXT,reminder_last_sent_at TEXT,note TEXT,schema_version INTEGER,created_at TEXT,updated_at TEXT);
      CREATE TABLE problem_inbox_items(id INTEGER PRIMARY KEY,date TEXT,text TEXT,status TEXT,source TEXT,created_at TEXT,updated_at TEXT,resolved_at TEXT);
      CREATE TABLE daily_reviews(id INTEGER PRIMARY KEY,date TEXT UNIQUE,summary TEXT,wins TEXT,problems TEXT,tomorrow_plan TEXT,score INTEGER,schema_version INTEGER,created_at TEXT,updated_at TEXT);
      CREATE TABLE water_intake_records(id INTEGER PRIMARY KEY,date TEXT UNIQUE,cups INTEGER,cup_ml INTEGER,target_cups INTEGER,schema_version INTEGER,created_at TEXT,updated_at TEXT);
      CREATE TABLE learning_reports(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT,period_start TEXT,period_end TEXT,title TEXT,payload_json TEXT,generated_at TEXT,updated_at TEXT,UNIQUE(kind,period_start,period_end));
      CREATE INDEX idx_daily_reviews_date ON daily_reviews(date);
      CREATE INDEX idx_water_intake_records_date ON water_intake_records(date);
      CREATE INDEX idx_learning_reports_period ON learning_reports(kind,period_start,period_end);
      INSERT INTO goals VALUES(1,'考研','','2026-12-20',1,'考研','',1,'now','now');
      INSERT INTO daily_reviews VALUES(1,'2026-07-14','admin','','','',8,1,'now','now');
      INSERT INTO water_intake_records VALUES(1,'2026-07-14',4,500,6,1,'now','now');
      INSERT INTO learning_reports(kind,period_start,period_end,title,payload_json,generated_at,updated_at) VALUES('weekly','2026-07-06','2026-07-12','周报','{}','now','now');
    `);

    database.exec(readFileSync(new URL('./024_isolate_learner_data.sql', import.meta.url), 'utf8'));
    database.exec(`
      INSERT INTO daily_reviews(id,user_id,date,summary,wins,problems,tomorrow_plan,score,schema_version,created_at,updated_at)
      VALUES(2,2,'2026-07-14','learner','','','',7,1,'now','now');
      INSERT INTO water_intake_records(id,user_id,date,cups,cup_ml,target_cups,schema_version,created_at,updated_at)
      VALUES(2,2,'2026-07-14',3,500,6,1,'now','now');
    `);

    expect(database.prepare('SELECT user_id AS userId FROM goals').get().userId).toBe(1);
    expect(database.prepare('SELECT user_id AS userId,summary FROM daily_reviews ORDER BY user_id').all()).toEqual([
      { userId: 1, summary: 'admin' },
      { userId: 2, summary: 'learner' },
    ]);
    expect(database.prepare('SELECT COUNT(*) AS count FROM water_intake_records').get().count).toBe(2);
    expect(database.prepare('SELECT user_id AS userId FROM learning_reports').get().userId).toBe(1);
    database.close();
  });
});
