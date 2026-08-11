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
                CREATE TABLE IF NOT EXISTS study_sessions (
                    session_id TEXT PRIMARY KEY,
                    session_date TEXT NOT NULL,
                    sequence_number INTEGER NOT NULL,
                    project_id INTEGER NOT NULL DEFAULT 0,
                    project_name TEXT NOT NULL DEFAULT '',
                    started_at REAL NOT NULL,
                    ended_at REAL NOT NULL,
                    duration_seconds INTEGER NOT NULL,
                    created_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_study_sessions_date ON study_sessions(session_date, sequence_number);
                CREATE TABLE IF NOT EXISTS daily_study_state (
                    session_date TEXT PRIMARY KEY,
                    paused_label TEXT NOT NULL DEFAULT '',
                    selected_project_id INTEGER NOT NULL DEFAULT 0,
                    last_lag_project_id INTEGER NOT NULL DEFAULT 0,
                    last_lag_at REAL,
                    pause_started_at REAL,
                    last_pause_started_at REAL,
                    last_pause_ended_at REAL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS study_day_closures (
                    session_date TEXT PRIMARY KEY,
                    ended_at REAL NOT NULL,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
            """)
            legacy_sessions = connection.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='lesson_records'"
            ).fetchone()[0]
            if legacy_sessions:
                connection.execute(
                    """INSERT OR IGNORE INTO study_sessions(
                        session_id,session_date,sequence_number,project_id,project_name,
                        started_at,ended_at,duration_seconds,created_at
                    )
                    SELECT session_id,lesson_date,lesson_number,0,'',
                        started_at,ended_at,duration_seconds,created_at
                    FROM lesson_records"""
                )
                connection.execute("DROP TABLE lesson_records")

            legacy_state = connection.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='daily_schedule_state'"
            ).fetchone()[0]
            if legacy_state:
                columns = {row[1] for row in connection.execute("PRAGMA table_info(daily_schedule_state)")}
                pause_started = "pause_started_at" if "pause_started_at" in columns else "NULL"
                last_pause_started = "last_pause_started_at" if "last_pause_started_at" in columns else "NULL"
                last_pause_ended = "last_pause_ended_at" if "last_pause_ended_at" in columns else "NULL"
                connection.execute(
                    f"""INSERT OR IGNORE INTO daily_study_state(
                        session_date,paused_label,selected_project_id,last_lag_project_id,last_lag_at,
                        pause_started_at,last_pause_started_at,last_pause_ended_at,updated_at
                    )
                    SELECT lesson_date,paused_label,0,0,last_lag_at,
                        {pause_started},{last_pause_started},{last_pause_ended},updated_at
                    FROM daily_schedule_state"""
                )
                connection.execute("DROP TABLE daily_schedule_state")

            # Versions before 2026-07-23 permanently failed transient network
            # errors after six attempts. Recover those rows on startup while
            # preserving explicit client/authentication rejections.
            connection.execute(
                """UPDATE event_outbox
                SET status='pending', next_attempt_at=?
                WHERE status='failed'
                  AND last_error NOT LIKE 'HTTP 400%'
                  AND last_error NOT LIKE 'HTTP 401%'
                  AND last_error NOT LIKE 'HTTP 403%'
                  AND last_error NOT LIKE 'HTTP 404%'""",
                (time.time(),),
            )

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

    def load_study_session(self) -> dict | None:
        current = self.load_runtime_state("active_study")
        if current:
            return current
        legacy = self.load_runtime_state("active_course")
        if legacy:
            self.save_runtime_state("active_study", legacy)
            self.clear_runtime_state("active_course")
        return legacy

    def save_study_session(self, payload: dict) -> None:
        self.save_runtime_state("active_study", payload)

    def clear_study_session(self) -> None:
        self.clear_runtime_state("active_study")
        self.clear_runtime_state("active_course")

    def add_study_session(self, payload: dict) -> None:
        with self.lock, self._connection() as connection:
            connection.execute(
                "INSERT OR IGNORE INTO study_sessions(session_id,session_date,sequence_number,project_id,project_name,started_at,ended_at,duration_seconds,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    payload["session_id"], payload["session_date"], payload["sequence_number"],
                    payload["project_id"], payload["project_name"],
                    payload["started_at"], payload["ended_at"], payload["duration_seconds"], time.time(),
                ),
            )

    def daily_study_summary(self, session_date: str) -> dict:
        with self.lock, self._connection() as connection:
            row = connection.execute(
                "SELECT COUNT(*) AS session_count, COALESCE(SUM(duration_seconds),0) AS study_seconds FROM study_sessions WHERE session_date = ?",
                (session_date,),
            ).fetchone()
        return {"session_count": int(row[0]), "study_seconds": int(row[1])}

    def daily_study_breakdown(self, session_date: str) -> list[dict]:
        with self.lock, self._connection() as connection:
            rows = connection.execute(
                """SELECT project_id,project_name,COUNT(*) AS session_count,
                    COALESCE(SUM(duration_seconds),0) AS study_seconds
                FROM study_sessions WHERE session_date = ?
                GROUP BY project_id,project_name
                ORDER BY study_seconds DESC,project_name""",
                (session_date,),
            ).fetchall()
        return [
            {
                "project_id": int(row["project_id"]),
                "project_name": str(row["project_name"] or "未命名课程"),
                "session_count": int(row["session_count"]),
                "study_seconds": int(row["study_seconds"]),
            }
            for row in rows
        ]

    def close_study_day(self, session_date: str, ended_at: float) -> None:
        now = time.time()
        with self.lock, self._connection() as connection:
            connection.execute(
                """INSERT INTO study_day_closures(session_date,ended_at,created_at,updated_at)
                VALUES(?,?,?,?) ON CONFLICT(session_date) DO UPDATE SET
                ended_at=excluded.ended_at,updated_at=excluded.updated_at""",
                (session_date, float(ended_at), now, now),
            )

    def reopen_study_day(self, session_date: str) -> None:
        with self.lock, self._connection() as connection:
            connection.execute("DELETE FROM study_day_closures WHERE session_date = ?", (session_date,))

    def study_day_closure(self, session_date: str) -> dict | None:
        with self.lock, self._connection() as connection:
            row = connection.execute(
                "SELECT session_date,ended_at FROM study_day_closures WHERE session_date = ?",
                (session_date,),
            ).fetchone()
        return dict(row) if row else None

    def close_unfinished_study_days_before(self, session_date: str) -> list[str]:
        """Close completed study days that were left open past midnight."""
        now = time.time()
        with self.lock, self._connection() as connection:
            rows = connection.execute(
                """SELECT sessions.session_date,MAX(sessions.ended_at) AS ended_at
                FROM study_sessions AS sessions
                LEFT JOIN study_day_closures AS closures
                  ON closures.session_date = sessions.session_date
                WHERE sessions.session_date < ? AND closures.session_date IS NULL
                GROUP BY sessions.session_date
                ORDER BY sessions.session_date""",
                (str(session_date),),
            ).fetchall()
            for row in rows:
                connection.execute(
                    """INSERT OR IGNORE INTO study_day_closures(
                        session_date,ended_at,created_at,updated_at
                    ) VALUES(?,?,?,?)""",
                    (row["session_date"], float(row["ended_at"]), now, now),
                )
        return [str(row["session_date"]) for row in rows]

    def next_study_sequence(self, session_date: str) -> int:
        with self.lock, self._connection() as connection:
            row = connection.execute(
                "SELECT COALESCE(MAX(sequence_number),0)+1 FROM study_sessions WHERE session_date = ?",
                (session_date,),
            ).fetchone()
        return max(1, int(row[0]))

    def list_daily_study_sessions(self, session_date: str) -> list[dict]:
        with self.lock, self._connection() as connection:
            rows = connection.execute(
                "SELECT session_id,sequence_number,project_id,project_name,started_at,ended_at,duration_seconds FROM study_sessions WHERE session_date = ? ORDER BY sequence_number,started_at",
                (session_date,),
            ).fetchall()
        return [dict(row) for row in rows]

    def study_session(self, session_id: str) -> dict | None:
        with self.lock, self._connection() as connection:
            row = connection.execute(
                "SELECT session_id,session_date,sequence_number,project_id,project_name,started_at,ended_at,duration_seconds FROM study_sessions WHERE session_id = ?",
                (str(session_id),),
            ).fetchone()
        return dict(row) if row else None

    def update_study_session_duration(self, session_id: str, duration_seconds: int) -> tuple[dict, dict]:
        duration = max(60, min(24 * 60 * 60, int(duration_seconds)))
        with self.lock, self._connection() as connection:
            row = connection.execute(
                "SELECT session_id,session_date,sequence_number,project_id,project_name,started_at,ended_at,duration_seconds FROM study_sessions WHERE session_id = ?",
                (str(session_id),),
            ).fetchone()
            if not row:
                raise KeyError("study session not found")
            before = dict(row)
            ended_at = float(before["started_at"]) + duration
            connection.execute(
                "UPDATE study_sessions SET ended_at = ?, duration_seconds = ? WHERE session_id = ?",
                (ended_at, duration, str(session_id)),
            )
        return before, {**before, "ended_at": ended_at, "duration_seconds": duration}

    def delete_study_session(self, session_id: str) -> dict:
        with self.lock, self._connection() as connection:
            row = connection.execute(
                "SELECT session_id,session_date,sequence_number,project_id,project_name,started_at,ended_at,duration_seconds FROM study_sessions WHERE session_id = ?",
                (str(session_id),),
            ).fetchone()
            if not row:
                raise KeyError("study session not found")
            record = dict(row)
            connection.execute("DELETE FROM study_sessions WHERE session_id = ?", (str(session_id),))
        return record

    def daily_study_state(self, session_date: str) -> dict:
        with self.lock, self._connection() as connection:
            row = connection.execute(
                "SELECT paused_label,selected_project_id,last_lag_project_id,last_lag_at,pause_started_at,last_pause_started_at,last_pause_ended_at FROM daily_study_state WHERE session_date = ?",
                (session_date,),
            ).fetchone()
        return dict(row) if row else {
            "paused_label": "",
            "selected_project_id": 0,
            "last_lag_project_id": 0,
            "last_lag_at": None,
            "pause_started_at": None,
            "last_pause_started_at": None,
            "last_pause_ended_at": None,
        }

    def update_daily_study_state(self, session_date: str, **changes) -> None:
        current = {**self.daily_study_state(session_date), **changes}
        with self.lock, self._connection() as connection:
            connection.execute(
                "INSERT INTO daily_study_state(session_date,paused_label,selected_project_id,last_lag_project_id,last_lag_at,pause_started_at,last_pause_started_at,last_pause_ended_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(session_date) DO UPDATE SET paused_label=excluded.paused_label,selected_project_id=excluded.selected_project_id,last_lag_project_id=excluded.last_lag_project_id,last_lag_at=excluded.last_lag_at,pause_started_at=excluded.pause_started_at,last_pause_started_at=excluded.last_pause_started_at,last_pause_ended_at=excluded.last_pause_ended_at,updated_at=excluded.updated_at",
                (
                    session_date,
                    current["paused_label"],
                    current["selected_project_id"],
                    current["last_lag_project_id"],
                    current["last_lag_at"],
                    current["pause_started_at"],
                    current["last_pause_started_at"],
                    current["last_pause_ended_at"],
                    time.time(),
                ),
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
        with self.lock, self._connection() as connection:
            connection.execute(
                """UPDATE event_outbox
                SET status='pending',attempt_count=?,next_attempt_at=?,last_error=?
                WHERE event_id=?""",
                (attempts, time.time() + delay_seconds, error[:500], event_id),
            )

    def mark_failed(self, event_id: str, error: str) -> None:
        with self.lock, self._connection() as connection:
            connection.execute(
                "UPDATE event_outbox SET status='failed',attempt_count=attempt_count+1,last_error=? WHERE event_id=?",
                (error[:500], event_id),
            )

    def cancel_pending_events(self, event_type: str, reason: str = "suppressed by pause") -> int:
        with self.lock, self._connection() as connection:
            cursor = connection.execute(
                "UPDATE event_outbox SET status='cancelled',next_attempt_at=0,last_error=? WHERE event_type=? AND status='pending'",
                (str(reason)[:500], str(event_type)),
            )
        return int(cursor.rowcount or 0)

    def cancel_schedule_lag_events_before(self, session_date: str) -> int:
        current_date = str(session_date)
        cancelled = 0
        with self.lock, self._connection() as connection:
            rows = connection.execute(
                "SELECT event_id,payload_json FROM event_outbox WHERE event_type='schedule_lag' AND status='pending'"
            ).fetchall()
            for row in rows:
                try:
                    body = json.loads(row["payload_json"])
                except (TypeError, ValueError, json.JSONDecodeError):
                    body = {}
                event_date = str((body.get("payload") or {}).get("sessionDate") or "")
                if not event_date:
                    event_id = str(row["event_id"])
                    prefix = "schedule_lag_"
                    event_date = event_id[len(prefix):len(prefix) + 10] if event_id.startswith(prefix) else ""
                if len(event_date) != 10 or event_date >= current_date:
                    continue
                connection.execute(
                    "UPDATE event_outbox SET status='cancelled',next_attempt_at=0,last_error=? WHERE event_id=?",
                    ("cancelled after study day rollover", row["event_id"]),
                )
                cancelled += 1
        return cancelled

    def expedite_pending_events(self, now: float | None = None) -> int:
        target = time.time() if now is None else float(now)
        with self.lock, self._connection() as connection:
            cursor = connection.execute(
                "UPDATE event_outbox SET next_attempt_at=? WHERE status='pending' AND next_attempt_at>?",
                (target, target),
            )
        return int(cursor.rowcount or 0)

    def pending_count(self) -> int:
        with self.lock, self._connection() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM event_outbox WHERE status='pending'").fetchone()[0])

    def failed_count(self) -> int:
        with self.lock, self._connection() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM event_outbox WHERE status='failed'").fetchone()[0])
