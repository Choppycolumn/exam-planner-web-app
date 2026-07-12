from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


class BreakGuardStore:
    def __init__(self, database_file: Path):
        self.database_file = database_file
        self.lock = threading.RLock()
        self.database_file.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(self.database_file, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=5000")
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self.lock, self._connection() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS runtime_state (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS event_outbox (
                    event_id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at REAL NOT NULL,
                    last_error TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL,
                    sent_at REAL
                );
                CREATE INDEX IF NOT EXISTS idx_event_outbox_due ON event_outbox(status, next_attempt_at);
                CREATE TABLE IF NOT EXISTS lesson_records (
                    session_id TEXT PRIMARY KEY,
                    lesson_date TEXT NOT NULL,
                    lesson_number INTEGER NOT NULL,
                    started_at REAL NOT NULL,
                    ended_at REAL NOT NULL,
                    duration_seconds INTEGER NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_lesson_records_date ON lesson_records(lesson_date, lesson_number);
                CREATE TABLE IF NOT EXISTS daily_schedule_state (
                    lesson_date TEXT PRIMARY KEY,
                    paused_label TEXT NOT NULL DEFAULT '',
                    selected_lesson INTEGER NOT NULL DEFAULT 1,
                    last_lag_lesson INTEGER NOT NULL DEFAULT 0,
                    last_lag_at REAL,
                    updated_at REAL NOT NULL
                );
            """)
            columns = {row[1] for row in connection.execute("PRAGMA table_info(daily_schedule_state)")}
            if "selected_lesson" not in columns:
                connection.execute("ALTER TABLE daily_schedule_state ADD COLUMN selected_lesson INTEGER NOT NULL DEFAULT 1")

    def load_runtime_state(self, key: str) -> dict | None:
        with self.lock, self._connection() as connection:
            row = connection.execute("SELECT value_json FROM runtime_state WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def save_runtime_state(self, key: str, payload: dict) -> None:
        with self.lock, self._connection() as connection:
            connection.execute(
                "INSERT INTO runtime_state(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
                (key, json.dumps(payload, ensure_ascii=False), time.time()),
            )

    def clear_runtime_state(self, key: str) -> None:
        with self.lock, self._connection() as connection:
            connection.execute("DELETE FROM runtime_state WHERE key = ?", (key,))

    def load_session(self) -> dict | None:
        return self.load_runtime_state("active_session")

    def save_session(self, payload: dict) -> None:
        self.save_runtime_state("active_session", payload)

    def clear_session(self) -> None:
        self.clear_runtime_state("active_session")

    def load_course_session(self) -> dict | None:
        return self.load_runtime_state("active_course")

    def save_course_session(self, payload: dict) -> None:
        self.save_runtime_state("active_course", payload)

    def clear_course_session(self) -> None:
        self.clear_runtime_state("active_course")

    def add_lesson_record(self, payload: dict) -> None:
        with self.lock, self._connection() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO lesson_records(session_id,lesson_date,lesson_number,started_at,ended_at,duration_seconds,created_at) VALUES(?,?,?,?,?,?,?)",
                (
                    payload["session_id"], payload["lesson_date"], payload["lesson_number"],
                    payload["started_at"], payload["ended_at"], payload["duration_seconds"], time.time(),
                ),
            )

    def daily_lesson_summary(self, lesson_date: str) -> dict:
        with self.lock, self._connection() as connection:
            row = connection.execute(
                "SELECT COUNT(DISTINCT lesson_number) AS completed_lessons, COALESCE(SUM(duration_seconds),0) AS study_seconds FROM lesson_records WHERE lesson_date = ?",
                (lesson_date,),
            ).fetchone()
        return {"completed_lessons": int(row[0]), "study_seconds": int(row[1])}

    def completed_lesson_numbers(self, lesson_date: str) -> set[int]:
        with self.lock, self._connection() as connection:
            rows = connection.execute(
                "SELECT DISTINCT lesson_number FROM lesson_records WHERE lesson_date = ?",
                (lesson_date,),
            ).fetchall()
        return {int(row[0]) for row in rows}

    def list_daily_lessons(self, lesson_date: str) -> list[dict]:
        with self.lock, self._connection() as connection:
            rows = connection.execute(
                "SELECT session_id,lesson_number,started_at,ended_at,duration_seconds FROM lesson_records WHERE lesson_date = ? ORDER BY lesson_number,started_at",
                (lesson_date,),
            ).fetchall()
        return [dict(row) for row in rows]

    def daily_schedule_state(self, lesson_date: str) -> dict:
        with self.lock, self._connection() as connection:
            row = connection.execute(
                "SELECT paused_label,selected_lesson,last_lag_lesson,last_lag_at FROM daily_schedule_state WHERE lesson_date = ?",
                (lesson_date,),
            ).fetchone()
        return dict(row) if row else {"paused_label": "", "selected_lesson": 1, "last_lag_lesson": 0, "last_lag_at": None}

    def update_daily_schedule_state(self, lesson_date: str, **changes) -> None:
        current = {**self.daily_schedule_state(lesson_date), **changes}
        with self.lock, self._connection() as connection:
            connection.execute(
                "INSERT INTO daily_schedule_state(lesson_date,paused_label,selected_lesson,last_lag_lesson,last_lag_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(lesson_date) DO UPDATE SET paused_label=excluded.paused_label,selected_lesson=excluded.selected_lesson,last_lag_lesson=excluded.last_lag_lesson,last_lag_at=excluded.last_lag_at,updated_at=excluded.updated_at",
                (lesson_date, current["paused_label"], current["selected_lesson"], current["last_lag_lesson"], current["last_lag_at"], time.time()),
            )

    def enqueue_event(self, event_type: str, payload: dict, event_id: str | None = None) -> str:
        event_id = event_id or uuid.uuid4().hex
        body = {"eventId": event_id, "eventType": event_type, "source": "desktop-break-guard", **payload}
        now = time.time()
        with self.lock, self._connection() as connection:
            connection.execute("INSERT OR IGNORE INTO event_outbox(event_id,event_type,payload_json,next_attempt_at,created_at) VALUES(?,?,?,?,?)", (event_id, event_type, json.dumps(body, ensure_ascii=False), now, now))
        return event_id

    def next_due_event(self, now: float | None = None) -> dict | None:
        with self.lock, self._connection() as connection:
            row = connection.execute("SELECT * FROM event_outbox WHERE status='pending' AND next_attempt_at<=? ORDER BY created_at LIMIT 1", (now or time.time(),)).fetchone()
        return dict(row) if row else None

    def mark_sent(self, event_id: str) -> None:
        with self.lock, self._connection() as connection:
            connection.execute("UPDATE event_outbox SET status='sent',sent_at=?,last_error='' WHERE event_id=?", (time.time(), event_id))
            connection.execute("DELETE FROM event_outbox WHERE status='sent' AND sent_at<?", (time.time() - 7 * 86400,))

    def mark_retry(self, event_id: str, attempts: int, delay_seconds: int, error: str) -> None:
        status = "failed" if attempts >= 6 else "pending"
        with self.lock, self._connection() as connection:
            connection.execute("UPDATE event_outbox SET status=?,attempt_count=?,next_attempt_at=?,last_error=? WHERE event_id=?", (status, attempts, time.time() + delay_seconds, error[:500], event_id))

    def mark_failed(self, event_id: str, error: str) -> None:
        with self.lock, self._connection() as connection:
            connection.execute(
                "UPDATE event_outbox SET status='failed',attempt_count=attempt_count+1,last_error=? WHERE event_id=?",
                (error[:500], event_id),
            )

    def pending_count(self) -> int:
        with self.lock, self._connection() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM event_outbox WHERE status='pending'").fetchone()[0])

    def failed_count(self) -> int:
        with self.lock, self._connection() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM event_outbox WHERE status='failed'").fetchone()[0])
