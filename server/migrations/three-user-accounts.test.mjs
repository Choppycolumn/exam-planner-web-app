import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('three-user accounts migration', () => {
  it('preserves existing accounts and settings while allowing a second learner', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON;');
    database.exec(`
      CREATE TABLE app_metadata(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
      CREATE TABLE study_projects(id INTEGER PRIMARY KEY,name TEXT,color TEXT,is_active INTEGER,sort_order INTEGER,schema_version INTEGER,created_at TEXT,updated_at TEXT);
      CREATE TABLE study_time_records(id INTEGER PRIMARY KEY,date TEXT,project_id INTEGER,project_name_snapshot TEXT,minutes INTEGER,note TEXT,schema_version INTEGER,created_at TEXT,updated_at TEXT,UNIQUE(date,project_id));
    `);
    database.exec(readFileSync(new URL('./023_two_user_learning.sql', import.meta.url), 'utf8'));
    database.prepare(`INSERT INTO user_accounts
(id,account_type,display_name,password_hash,is_active,created_at,updated_at)
VALUES(2,'learner','学习伙伴','hash',1,'now','now')`).run();
    database.prepare('INSERT INTO user_study_settings(user_id,target_minutes,updated_at) VALUES(2,90,?)').run('now');

    database.exec('BEGIN IMMEDIATE;');
    database.exec(readFileSync(new URL('./026_three_user_accounts.sql', import.meta.url), 'utf8'));
    database.exec('COMMIT;');
    database.prepare(`INSERT INTO user_accounts
(id,account_type,display_name,password_hash,is_active,created_at,updated_at)
VALUES(3,'learner','学习伙伴 2','hash-2',1,'now','now')`).run();

    expect(database.prepare('SELECT id,account_type AS accountType FROM user_accounts ORDER BY id').all()).toEqual([
      { id: 1, accountType: 'admin' },
      { id: 2, accountType: 'learner' },
      { id: 3, accountType: 'learner' },
    ]);
    expect(database.prepare('SELECT user_id AS userId,target_minutes AS targetMinutes FROM user_study_settings ORDER BY user_id').all()).toEqual([
      { userId: 1, targetMinutes: 0 },
      { userId: 2, targetMinutes: 90 },
    ]);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(() => database.prepare(`INSERT INTO user_accounts
(id,account_type,display_name,password_hash,is_active,created_at,updated_at)
VALUES(4,'admin','另一管理员','hash-3',1,'now','now')`).run()).toThrow();
    database.close();
  });
});
