ALTER TABLE break_guard_events ADD COLUMN event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_break_guard_events_event_id
ON break_guard_events(event_id)
WHERE event_id IS NOT NULL AND event_id <> '';
