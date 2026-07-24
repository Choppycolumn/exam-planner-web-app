CREATE TABLE IF NOT EXISTS focus_timer_settings (
  user_id INTEGER PRIMARY KEY,
  focus_minutes INTEGER NOT NULL DEFAULT 50 CHECK(focus_minutes BETWEEN 5 AND 180),
  break_minutes INTEGER NOT NULL DEFAULT 10 CHECK(break_minutes BETWEEN 1 AND 60),
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO focus_timer_settings(user_id, focus_minutes, break_minutes, updated_at)
SELECT id, 50, 10, datetime('now') FROM user_accounts WHERE account_type IN ('admin', 'learner');

CREATE TABLE IF NOT EXISTS focus_timer_state (
  user_id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'idle' CHECK(mode IN ('idle', 'focus', 'break', 'meal')),
  session_id TEXT,
  project_id INTEGER,
  project_name_snapshot TEXT NOT NULL DEFAULT '',
  pause_label TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  target_seconds INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS focus_timer_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  session_date TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  project_name_snapshot TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL CHECK(duration_seconds >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(user_id, session_id),
  FOREIGN KEY(user_id) REFERENCES user_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id) REFERENCES study_projects(id)
);

CREATE TABLE IF NOT EXISTS focus_timer_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, segment_id),
  FOREIGN KEY(user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS focus_timer_day_closures (
  user_id INTEGER NOT NULL,
  session_date TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, session_date),
  FOREIGN KEY(user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS focus_timer_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  action TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, operation_id),
  FOREIGN KEY(user_id) REFERENCES user_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_focus_timer_sessions_user_date
ON focus_timer_sessions(user_id, session_date, started_at);

CREATE INDEX IF NOT EXISTS idx_focus_timer_segments_session
ON focus_timer_segments(user_id, session_id, sequence_number);

CREATE INDEX IF NOT EXISTS idx_focus_timer_operations_created
ON focus_timer_operations(user_id, created_at);
