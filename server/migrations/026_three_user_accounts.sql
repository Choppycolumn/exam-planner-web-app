CREATE TEMP TABLE user_study_settings_backup AS
SELECT user_id, target_minutes, updated_at FROM user_study_settings;

CREATE TABLE user_accounts_v2 (
  id INTEGER PRIMARY KEY CHECK (id >= 1),
  account_type TEXT NOT NULL CHECK (account_type IN ('admin', 'learner')),
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO user_accounts_v2
(id, account_type, display_name, password_hash, is_active, created_at, updated_at)
SELECT id, account_type, display_name, password_hash, is_active, created_at, updated_at
FROM user_accounts;

DROP TABLE user_accounts;
ALTER TABLE user_accounts_v2 RENAME TO user_accounts;

CREATE UNIQUE INDEX idx_user_accounts_single_admin
ON user_accounts(account_type)
WHERE account_type = 'admin';

INSERT OR REPLACE INTO user_study_settings (user_id, target_minutes, updated_at)
SELECT user_id, target_minutes, updated_at FROM user_study_settings_backup;

DROP TABLE user_study_settings_backup;
