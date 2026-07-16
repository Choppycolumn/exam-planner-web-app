CREATE TABLE IF NOT EXISTS notification_channel_health (
  channel_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'normal',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_failure_at TEXT,
  circuit_open_until TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_channel_health_status
ON notification_channel_health(status, circuit_open_until);
