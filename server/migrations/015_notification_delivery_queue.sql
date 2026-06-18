ALTER TABLE notification_deliveries ADD COLUMN mode TEXT NOT NULL DEFAULT 'proactive';
ALTER TABLE notification_deliveries ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_deliveries ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 4;
ALTER TABLE notification_deliveries ADD COLUMN next_attempt_at TEXT;
ALTER TABLE notification_deliveries ADD COLUMN last_attempt_at TEXT;

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_queue
ON notification_deliveries(status, next_attempt_at, id);
