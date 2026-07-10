from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from breakguard_storage import BreakGuardStore


def utc_iso(timestamp: float | None = None) -> str:
    value = datetime.fromtimestamp(timestamp if timestamp is not None else time.time(), timezone.utc)
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def fmt_seconds(seconds: int) -> str:
    seconds = max(0, int(seconds))
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


@dataclass
class BreakSession:
    session_id: str
    started_at: float
    started_iso: str
    deadline_at: float
    warning_sent: bool = False
    unfocused_recorded: bool = False


class BreakStateMachine:
    def __init__(self, store: BreakGuardStore, break_seconds: int, notify_after_seconds: int, unfocused_after_seconds: int):
        self.store = store
        self.break_seconds = break_seconds
        self.notify_after_seconds = notify_after_seconds
        self.unfocused_after_seconds = unfocused_after_seconds
        raw = self.store.load_session()
        self.session = BreakSession(**raw) if raw else None

    def start(self, now: float | None = None) -> BreakSession:
        now = now if now is not None else time.time()
        self.session = BreakSession(uuid.uuid4().hex, now, utc_iso(now), now + self.break_seconds)
        self._save()
        return self.session

    def complete(self, now: float | None = None) -> tuple[BreakSession | None, int]:
        if not self.session:
            return None, 0
        now = now if now is not None else time.time()
        current = self.session
        overdue = max(0, int(now - current.deadline_at))
        self.session = None
        self.store.clear_session()
        return current, overdue

    def snapshot(self, now: float | None = None) -> dict:
        if not self.session:
            return {"running": False, "remaining": self.break_seconds, "overtime": 0, "warning_due": False, "unfocused_due": False}
        now = now if now is not None else time.time()
        remaining = int(self.session.deadline_at - now)
        overtime = max(0, -remaining)
        return {
            "running": True,
            "remaining": remaining,
            "overtime": overtime,
            "warning_due": overtime >= self.notify_after_seconds and not self.session.warning_sent,
            "unfocused_due": overtime >= self.unfocused_after_seconds and not self.session.unfocused_recorded,
        }

    def mark_warning_sent(self) -> None:
        if self.session:
            self.session.warning_sent = True
            self._save()

    def mark_unfocused_recorded(self) -> None:
        if self.session:
            self.session.unfocused_recorded = True
            self._save()

    def _save(self) -> None:
        if self.session:
            self.store.save_session(asdict(self.session))
