ALTER TABLE goals ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE subjects ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mock_exam_records ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE short_term_tasks ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE problem_inbox_items ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS idx_daily_reviews_date;
ALTER TABLE daily_reviews RENAME TO daily_reviews_legacy_024;
CREATE TABLE daily_reviews (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL DEFAULT 1,
  date TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  wins TEXT NOT NULL DEFAULT '',
  problems TEXT NOT NULL DEFAULT '',
  tomorrow_plan TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 6,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(user_id, date)
);
INSERT INTO daily_reviews
(id, user_id, date, summary, wins, problems, tomorrow_plan, score, schema_version, created_at, updated_at)
SELECT id, 1, date, summary, wins, problems, tomorrow_plan, score, schema_version, created_at, updated_at
FROM daily_reviews_legacy_024;
DROP TABLE daily_reviews_legacy_024;

DROP INDEX IF EXISTS idx_water_intake_records_date;
ALTER TABLE water_intake_records RENAME TO water_intake_records_legacy_024;
CREATE TABLE water_intake_records (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL DEFAULT 1,
  date TEXT NOT NULL,
  cups INTEGER NOT NULL DEFAULT 0 CHECK (cups >= 0),
  cup_ml INTEGER NOT NULL DEFAULT 500 CHECK (cup_ml > 0),
  target_cups INTEGER NOT NULL DEFAULT 6 CHECK (target_cups > 0),
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(user_id, date)
);
INSERT INTO water_intake_records
(id, user_id, date, cups, cup_ml, target_cups, schema_version, created_at, updated_at)
SELECT id, 1, date, cups, cup_ml, target_cups, schema_version, created_at, updated_at
FROM water_intake_records_legacy_024;
DROP TABLE water_intake_records_legacy_024;

DROP INDEX IF EXISTS idx_learning_reports_period;
ALTER TABLE learning_reports RENAME TO learning_reports_legacy_024;
CREATE TABLE learning_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL CHECK (kind IN ('weekly', 'monthly')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, kind, period_start, period_end)
);
INSERT INTO learning_reports
(id, user_id, kind, period_start, period_end, title, payload_json, generated_at, updated_at)
SELECT id, 1, kind, period_start, period_end, title, payload_json, generated_at, updated_at
FROM learning_reports_legacy_024;
DROP TABLE learning_reports_legacy_024;

CREATE TABLE IF NOT EXISTS user_confusing_words_backup (
  user_id INTEGER PRIMARY KEY,
  schema_version INTEGER NOT NULL DEFAULT 1,
  exported_at TEXT,
  backed_up_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_confusing_words_backup_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  exported_at TEXT,
  backed_up_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'sync',
  group_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  payload_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_goals_user_active ON goals(user_id, is_active, deadline);
CREATE INDEX IF NOT EXISTS idx_daily_reviews_user_date ON daily_reviews(user_id, date);
CREATE INDEX IF NOT EXISTS idx_subjects_user_active_sort ON subjects(user_id, is_active, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_mock_exam_records_user_date ON mock_exam_records(user_id, date, id);
CREATE INDEX IF NOT EXISTS idx_short_term_tasks_user_due ON short_term_tasks(user_id, due_date, due_time, is_completed);
CREATE INDEX IF NOT EXISTS idx_water_intake_records_user_date ON water_intake_records(user_id, date);
CREATE INDEX IF NOT EXISTS idx_problem_inbox_user_date_status ON problem_inbox_items(user_id, date, status);
CREATE INDEX IF NOT EXISTS idx_learning_reports_user_period ON learning_reports(user_id, kind, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_user_confusing_words_versions_user_created
ON user_confusing_words_backup_versions(user_id, created_at DESC);
