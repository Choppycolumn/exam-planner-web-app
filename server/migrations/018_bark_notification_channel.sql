INSERT OR IGNORE INTO notification_channels
(channel_key, type, name, enabled, config_json, created_at, updated_at)
VALUES
('bark_default', 'bark', 'Bark iOS', 1, '{"deviceKeyEnv":"BARK_DEVICE_KEY","serverUrlEnv":"BARK_SERVER_URL"}', datetime('now'), datetime('now'));
