UPDATE notification_events
SET status = 'notified',
    updated_at = datetime('now')
WHERE status IN ('open', 'acknowledged');
