CREATE TABLE IF NOT EXISTS notification_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  enabled INTEGER NOT NULL DEFAULT 1,
  channel_keys_json TEXT NOT NULL DEFAULT '[]',
  quiet_hours_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  scheduled_at TEXT,
  acknowledged_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  channel_key TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempted_at TEXT,
  delivered_at TEXT,
  error TEXT,
  response_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_events_status_created ON notification_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_events_source_created ON notification_events(source, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_event ON notification_deliveries(event_id);

INSERT OR IGNORE INTO notification_channels (channel_key, type, name, enabled, config_json, created_at, updated_at)
VALUES
  ('in_app', 'in_app', '站内通知', 1, '{}', datetime('now'), datetime('now')),
  ('email_default', 'email', '默认邮件渠道', 0, '{}', datetime('now'), datetime('now')),
  ('telegram_default', 'telegram', 'Telegram Bot 预留渠道', 0, '{"botTokenEnv":"TELEGRAM_BOT_TOKEN","chatIdEnv":"TELEGRAM_CHAT_ID"}', datetime('now'), datetime('now')),
  ('wecom_default', 'wecom_webhook', '企业微信/微信通知预留渠道', 0, '{"webhookUrlEnv":"WECOM_WEBHOOK_URL"}', datetime('now'), datetime('now')),
  ('webhook_default', 'webhook', '通用 Webhook 预留渠道', 0, '{}', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO notification_rules (rule_key, name, source, severity, enabled, channel_keys_json, quiet_hours_json, created_at, updated_at)
VALUES
  ('daily_brief_ready', '每日简报生成完成', 'brief', 'info', 1, '["in_app"]', '{}', datetime('now'), datetime('now')),
  ('ops_disk_warning', '磁盘空间预警', 'ops', 'warning', 1, '["in_app"]', '{}', datetime('now'), datetime('now')),
  ('ops_task_failed', '后台任务失败', 'ops', 'warning', 1, '["in_app"]', '{}', datetime('now'), datetime('now')),
  ('ops_slow_api', '慢接口过多', 'ops', 'warning', 1, '["in_app"]', '{}', datetime('now'), datetime('now')),
  ('report_ready', '周报/月报生成完成', 'report', 'info', 1, '["in_app"]', '{}', datetime('now'), datetime('now'));
