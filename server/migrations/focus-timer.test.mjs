import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('focus timer migration', () => {
  it('creates independent settings and state rows for every account', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys = ON;');
    database.exec(`
      CREATE TABLE user_accounts(
        id INTEGER PRIMARY KEY,
        account_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_active INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE study_projects(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,name TEXT,color TEXT,is_active INTEGER);
      INSERT INTO user_accounts VALUES
        (1,'admin','我','',1,'now','now'),
        (2,'learner','学习伙伴','',1,'now','now'),
        (3,'learner','学习伙伴 2','',1,'now','now');
    `);

    database.exec(readFileSync(new URL('./027_focus_timer.sql', import.meta.url), 'utf8'));
    expect(database.prepare(`SELECT user_id AS userId,focus_minutes AS focusMinutes,break_minutes AS breakMinutes
FROM focus_timer_settings ORDER BY user_id;`).all()).toEqual([
      { userId: 1, focusMinutes: 50, breakMinutes: 10 },
      { userId: 2, focusMinutes: 50, breakMinutes: 10 },
      { userId: 3, focusMinutes: 50, breakMinutes: 10 },
    ]);

    database.prepare(`INSERT INTO focus_timer_state(
user_id,mode,session_id,project_id,project_name_snapshot,pause_label,started_at,target_seconds,revision,updated_at
) VALUES(2,'meal','meal_user2',NULL,'','午饭','now',0,1,'now')`).run();
    expect(database.prepare('SELECT COUNT(*) AS count FROM focus_timer_state WHERE user_id = 3').get().count).toBe(0);
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    database.close();
  });
});
