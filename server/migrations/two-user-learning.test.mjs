import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('two-user learning migration', () => {
  it('keeps existing learning data assigned to the primary account', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(`
      CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
      INSERT INTO app_metadata VALUES('study_target_minutes','480','now');
      CREATE TABLE study_projects(id INTEGER PRIMARY KEY,name TEXT,color TEXT,is_active INTEGER,sort_order INTEGER,schema_version INTEGER,created_at TEXT,updated_at TEXT);
      CREATE TABLE study_time_records(id INTEGER PRIMARY KEY,date TEXT,project_id INTEGER,project_name_snapshot TEXT,minutes INTEGER,note TEXT,schema_version INTEGER,created_at TEXT,updated_at TEXT,UNIQUE(date,project_id));
      INSERT INTO study_projects VALUES(1,'英一','#2563eb',1,1,1,'now','now');
      INSERT INTO study_time_records VALUES(1,'2026-07-13',1,'英一',60,'fixture',1,'now','now');
    `);
    database.exec(readFileSync(new URL('./023_two_user_learning.sql', import.meta.url), 'utf8'));

    expect(database.prepare('SELECT id,account_type AS accountType FROM user_accounts').all()).toEqual([{ id: 1, accountType: 'admin' }]);
    expect(database.prepare('SELECT user_id AS userId FROM study_projects').get().userId).toBe(1);
    expect(database.prepare('SELECT user_id AS userId FROM study_time_records').get().userId).toBe(1);
    expect(database.prepare('SELECT target_minutes AS targetMinutes FROM user_study_settings WHERE user_id=1').get().targetMinutes).toBe(480);
    database.close();
  });
});
