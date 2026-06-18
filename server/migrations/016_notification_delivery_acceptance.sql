ALTER TABLE notification_deliveries ADD COLUMN accepted_at TEXT;

UPDATE notification_deliveries
SET status = 'accepted', accepted_at = COALESCE(delivered_at, attempted_at)
WHERE status = 'delivered' AND mode = 'proactive';
