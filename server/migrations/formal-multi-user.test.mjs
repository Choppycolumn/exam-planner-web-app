import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

describe('formal multi-user migration', () => {
  it('preserves existing accounts and removes the historic learner-count ceiling', () => {
    const database = new DatabaseSync(':memory:');
    database.exec('PRAGMA foreign_keys=ON;');
    database.exec(`
      CREATE TABLE user_accounts(
        id INTEGER PRIMARY KEY CHECK(id>=1),
        account_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL DEFAULT '',
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_user_accounts_single_admin ON user_accounts(account_type) WHERE account_type='admin';
      INSERT INTO user_accounts VALUES
        (1,'admin','我','owner-hash',1,'now','now'),
        (2,'learner','学习伙伴','member-hash',1,'now','now'),
        (3,'learner','学习伙伴 2','member-hash-2',1,'now','now');
      CREATE TABLE confusing_words_backup(
        id INTEGER PRIMARY KEY,schema_version INTEGER,exported_at TEXT,backed_up_at TEXT,payload_json TEXT
      );
      CREATE TABLE confusing_words_backup_versions(
        id INTEGER PRIMARY KEY,schema_version INTEGER,exported_at TEXT,backed_up_at TEXT,payload_json TEXT,
        source TEXT,group_count INTEGER,word_count INTEGER,payload_hash TEXT,created_at TEXT
      );
      CREATE TABLE user_confusing_words_backup(
        user_id INTEGER PRIMARY KEY,schema_version INTEGER,exported_at TEXT,backed_up_at TEXT,payload_json TEXT
      );
      CREATE TABLE user_confusing_words_backup_versions(
        id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,schema_version INTEGER,exported_at TEXT,
        backed_up_at TEXT,payload_json TEXT,source TEXT,group_count INTEGER,word_count INTEGER,
        payload_hash TEXT,created_at TEXT
      );
    `);

    database.exec(readFileSync(new URL('./028_formal_multi_user.sql', import.meta.url), 'utf8'));
    database.prepare(`INSERT INTO user_accounts(
      id,account_type,display_name,password_hash,is_active,created_at,updated_at,
      public_id,role,status,session_version
    ) VALUES(4,'learner','学习伙伴 3','hash-3',1,'now','now','public-4','member','active',1)`).run();

    const accounts = database.prepare(`SELECT id,role,status,LENGTH(public_id)>0 AS hasPublicId
      FROM user_accounts ORDER BY id`).all();
    expect(accounts).toEqual([
      { id: 1, role: 'owner', status: 'active', hasPublicId: 1 },
      { id: 2, role: 'member', status: 'active', hasPublicId: 1 },
      { id: 3, role: 'member', status: 'active', hasPublicId: 1 },
      { id: 4, role: 'member', status: 'active', hasPublicId: 1 },
    ]);
    expect(database.prepare("SELECT enabled FROM user_capabilities WHERE user_id=2 AND capability='study.use'").get())
      .toEqual({ enabled: 1 });
    expect(database.prepare("SELECT enabled FROM user_capabilities WHERE user_id=2 AND capability='operations.manage'").get())
      .toEqual({ enabled: 0 });
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    database.close();
  });
});
