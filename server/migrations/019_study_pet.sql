CREATE TABLE IF NOT EXISTS study_pet_daily_reports (
  date TEXT PRIMARY KEY,
  timezone TEXT,
  device_id TEXT,
  total_computer_seconds INTEGER NOT NULL DEFAULT 0,
  study_seconds INTEGER NOT NULL DEFAULT 0,
  entertainment_seconds INTEGER NOT NULL DEFAULT 0,
  tool_seconds INTEGER NOT NULL DEFAULT 0,
  social_seconds INTEGER NOT NULL DEFAULT 0,
  unknown_seconds INTEGER NOT NULL DEFAULT 0,
  entertainment_overtime_count INTEGER NOT NULL DEFAULT 0,
  strong_reminder_count INTEGER NOT NULL DEFAULT 0,
  target_study_seconds INTEGER NOT NULL DEFAULT 0,
  goal_completed INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_pet_site_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  device_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  category TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(date, device_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_study_pet_daily_reports_date ON study_pet_daily_reports(date);
CREATE INDEX IF NOT EXISTS idx_study_pet_site_usage_date ON study_pet_site_usage(date);
CREATE INDEX IF NOT EXISTS idx_study_pet_site_usage_domain ON study_pet_site_usage(domain);
