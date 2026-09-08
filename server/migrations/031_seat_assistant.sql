CREATE TABLE IF NOT EXISTS seat_assistant_profiles (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  venue TEXT NOT NULL DEFAULT 'main',
  date_mode TEXT NOT NULL DEFAULT 'tomorrow',
  start_time TEXT NOT NULL DEFAULT '08:30',
  end_time TEXT NOT NULL DEFAULT '22:00',
  area_preference_json TEXT NOT NULL DEFAULT '[]',
  seat_preference_json TEXT NOT NULL DEFAULT '["17","18","19","20","21","22","23","24","25","26","27","28"]',
  poll_interval_seconds INTEGER NOT NULL DEFAULT 240,
  jitter_seconds INTEGER NOT NULL DEFAULT 30,
  near_interval_seconds INTEGER NOT NULL DEFAULT 60,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seat_assistant_session_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL DEFAULT 'disabled',
  provider_name TEXT NOT NULL DEFAULT 'disabled',
  message TEXT NOT NULL DEFAULT '',
  last_checked_at TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  next_check_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_notified_status TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seat_assistant_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at TEXT NOT NULL,
  target_date TEXT NOT NULL,
  venue TEXT NOT NULL,
  total_seats INTEGER NOT NULL DEFAULT 0,
  free_seats INTEGER NOT NULL DEFAULT 0,
  available_seats_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  error_code TEXT NOT NULL DEFAULT '',
  provider_name TEXT NOT NULL DEFAULT 'unknown'
);

CREATE INDEX IF NOT EXISTS idx_seat_assistant_observations_time
ON seat_assistant_observations(observed_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS seat_assistant_notification_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_key TEXT NOT NULL DEFAULT '',
  episode_key TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  notify_count INTEGER NOT NULL DEFAULT 0,
  last_notified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seat_assistant_pairings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  session_id INTEGER,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seat_assistant_pairings_pending
ON seat_assistant_pairings(status, expires_at, id);

CREATE TABLE IF NOT EXISTS seat_assistant_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pairing_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  origin TEXT NOT NULL,
  cookie_domain TEXT NOT NULL,
  cookie_count INTEGER NOT NULL DEFAULT 0,
  cookie_expires_at TEXT,
  local_expires_at TEXT NOT NULL,
  bundle_version INTEGER NOT NULL DEFAULT 1,
  bundle_nonce TEXT NOT NULL,
  bundle_tag TEXT NOT NULL,
  bundle_ciphertext TEXT NOT NULL,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(pairing_id) REFERENCES seat_assistant_pairings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_seat_assistant_sessions_active
ON seat_assistant_sessions(status, local_expires_at, id);

CREATE TABLE IF NOT EXISTS seat_assistant_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  actor_role TEXT NOT NULL DEFAULT 'system',
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seat_assistant_audit_time
ON seat_assistant_audit(created_at DESC, id DESC);

INSERT OR IGNORE INTO seat_assistant_profiles
(id, enabled, venue, date_mode, start_time, end_time, area_preference_json, seat_preference_json,
 poll_interval_seconds, jitter_seconds, near_interval_seconds, created_at, updated_at)
VALUES
(1, 0, 'main', 'tomorrow', '08:30', '22:00', '[]',
 '["17","18","19","20","21","22","23","24","25","26","27","28"]',
 240, 30, 60, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO seat_assistant_session_status
(id, status, provider_name, message, consecutive_failures, last_notified_status, created_at, updated_at)
VALUES (1, 'disabled', 'disabled', '只读座位提醒默认关闭；未发起官方查询', 0, '', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO seat_assistant_notification_state
(id, state_key, notify_count, created_at, updated_at)
VALUES (1, '', 0, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO user_capabilities(user_id, capability, enabled, updated_at)
SELECT id, 'seat_assistant.manage', CASE WHEN role = 'owner' THEN 1 ELSE 0 END, datetime('now')
FROM user_accounts;
