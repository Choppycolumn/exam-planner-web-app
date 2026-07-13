CREATE TABLE IF NOT EXISTS user_accounts (
  id INTEGER PRIMARY KEY CHECK (id BETWEEN 1 AND 2),
  account_type TEXT NOT NULL UNIQUE CHECK (account_type IN ('admin', 'learner')),
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO user_accounts
(id, account_type, display_name, password_hash, is_active, created_at, updated_at)
VALUES (1, 'admin', '我', '', 1, datetime('now'), datetime('now'));

ALTER TABLE study_projects ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE study_time_records ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS user_study_settings (
  user_id INTEGER PRIMARY KEY,
  target_minutes INTEGER NOT NULL DEFAULT 0 CHECK (target_minutes >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO user_study_settings (user_id, target_minutes, updated_at)
SELECT 1, COALESCE((SELECT CAST(value AS INTEGER) FROM app_metadata WHERE key = 'study_target_minutes'), 0), datetime('now');

CREATE INDEX IF NOT EXISTS idx_study_projects_user_active_sort
ON study_projects(user_id, is_active, sort_order, id);

CREATE INDEX IF NOT EXISTS idx_study_time_records_user_date
ON study_time_records(user_id, date, project_id);

CREATE INDEX IF NOT EXISTS idx_study_time_records_user_project_date
ON study_time_records(user_id, project_id, date);
