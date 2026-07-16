from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime

from breakguard_state import utc_iso
from breakguard_storage import BreakGuardStore


def local_date(timestamp: float | None = None) -> str:
    return datetime.fromtimestamp(timestamp if timestamp is not None else time.time()).strftime("%Y-%m-%d")


@dataclass
class StudySession:
    session_id: str
    session_date: str
    sequence_number: int
    started_at: float
    started_iso: str
    project_id: int
    project_name: str


class StudyPlanner:
    def __init__(self, store: BreakGuardStore, break_minutes: int, lag_grace_minutes: int, lag_repeat_minutes: int, daily_target_minutes: int):
        self.store = store
        self.configure(break_minutes, lag_grace_minutes, lag_repeat_minutes, daily_target_minutes)
        self.session = self._restore_session(self.store.load_study_session())

    def configure(self, break_minutes: int, lag_grace_minutes: int, lag_repeat_minutes: int, daily_target_minutes: int) -> None:
        self.break_minutes = max(1, min(60, int(break_minutes)))
        self.lag_grace_minutes = max(0, min(180, int(lag_grace_minutes)))
        self.lag_repeat_minutes = max(5, min(180, int(lag_repeat_minutes)))
        self.daily_target_minutes = max(30, min(960, int(daily_target_minutes)))

    def _restore_session(self, raw: dict | None) -> StudySession | None:
        if not raw:
            return None
        payload = dict(raw)
        payload["session_date"] = payload.pop("lesson_date", payload.get("session_date", local_date(payload.get("started_at"))))
        payload["sequence_number"] = int(payload.pop("lesson_number", payload.get("sequence_number", 1)) or 1)
        payload["project_id"] = int(payload.get("project_id") or 0)
        payload["project_name"] = str(payload.get("project_name") or "")
        return StudySession(**{key: payload[key] for key in StudySession.__dataclass_fields__})

    def selected_project_id(self, available_project_ids: list[int] | None = None, now: float | None = None) -> int:
        selected = int(self.store.daily_study_state(local_date(now)).get("selected_project_id") or 0)
        available = [int(value) for value in (available_project_ids or []) if int(value) > 0]
        if selected > 0 and (not available or selected in available):
            return selected
        return available[0] if available else 0

    def select_project(self, project_id: int, now: float | None = None) -> int:
        selected = max(0, int(project_id or 0))
        self.store.update_daily_study_state(local_date(now), selected_project_id=selected)
        return selected

    def start_study(self, now: float | None = None, project_id: int = 0, project_name: str = "") -> StudySession:
        if self.session:
            return self.session
        now = now if now is not None else time.time()
        day = local_date(now)
        selected_project_id = self.select_project(project_id, now)
        self.clear_pause(now)
        self.session = StudySession(
            session_id=uuid.uuid4().hex,
            session_date=day,
            sequence_number=self.store.next_study_sequence(day),
            started_at=now,
            started_iso=utc_iso(now),
            project_id=selected_project_id,
            project_name=str(project_name or ""),
        )
        self.store.save_study_session(asdict(self.session))
        return self.session

    def complete_study(self, now: float | None = None) -> tuple[StudySession | None, int]:
        if not self.session:
            return None, 0
        now = now if now is not None else time.time()
        current = self.session
        duration = max(0, int(now - current.started_at))
        self.store.add_study_session({
            "session_id": current.session_id,
            "session_date": current.session_date,
            "sequence_number": current.sequence_number,
            "project_id": current.project_id,
            "project_name": current.project_name,
            "started_at": current.started_at,
            "ended_at": now,
            "duration_seconds": duration,
        })
        self.store.update_daily_study_state(current.session_date, selected_project_id=current.project_id)
        self.session = None
        self.store.clear_study_session()
        return current, duration

    def study_elapsed(self, now: float | None = None) -> int:
        if not self.session:
            return 0
        return max(0, int((now if now is not None else time.time()) - self.session.started_at))

    def set_pause(self, label: str, now: float | None = None) -> None:
        now = now if now is not None else time.time()
        day = local_date(now)
        state = self.store.daily_study_state(day)
        pause_started_at = state.get("pause_started_at")
        self.store.update_daily_study_state(
            day,
            paused_label=str(label)[:40],
            pause_started_at=float(pause_started_at) if pause_started_at is not None else now,
        )

    def clear_pause(self, now: float | None = None) -> None:
        now = now if now is not None else time.time()
        day = local_date(now)
        state = self.store.daily_study_state(day)
        pause_started_at = state.get("pause_started_at")
        changes = {"paused_label": "", "pause_started_at": None}
        if pause_started_at is not None:
            changes.update(last_pause_started_at=float(pause_started_at), last_pause_ended_at=now)
        self.store.update_daily_study_state(day, **changes)

    def summary(self, now: float | None = None, available_project_ids: list[int] | None = None) -> dict:
        now = now if now is not None else time.time()
        day = local_date(now)
        stored = self.store.daily_study_summary(day)
        stored_study_seconds = int(stored["study_seconds"])
        active_seconds = self.study_elapsed(now) if self.session and self.session.session_date == day else 0
        study_seconds = stored_study_seconds + active_seconds
        target_seconds = self.daily_target_minutes * 60
        selected_project_id = self.session.project_id if self.session else self.selected_project_id(available_project_ids, now)
        return {
            "date": day,
            "session_count": int(stored["session_count"]),
            "study_seconds": study_seconds,
            "stored_study_seconds": stored_study_seconds,
            "target_minutes": self.daily_target_minutes,
            "target_seconds": target_seconds,
            "progress": min(1.0, study_seconds / target_seconds),
            "selected_project_id": selected_project_id,
            "paused_label": self.store.daily_study_state(day)["paused_label"],
        }

    def lag_snapshot(self, now: float | None = None, available_project_ids: list[int] | None = None) -> dict:
        now = now if now is not None else time.time()
        summary = self.summary(now, available_project_ids)
        if self.session or summary["paused_label"] or summary["study_seconds"] >= summary["target_seconds"]:
            return {"due": False}
        project_id = summary["selected_project_id"]
        records = self.store.list_daily_study_sessions(summary["date"])
        if not records:
            return {"due": False, "project_id": project_id}
        last_ended_at = max(float(record["ended_at"]) for record in records)
        state = self.store.daily_study_state(summary["date"])
        pause_started_at = float(state.get("last_pause_started_at") or 0)
        pause_ended_at = float(state.get("last_pause_ended_at") or 0)
        excluded_pause_seconds = 0
        if pause_ended_at > last_ended_at and pause_ended_at > pause_started_at:
            excluded_pause_seconds = max(0, pause_ended_at - max(last_ended_at, pause_started_at))
        due_at = last_ended_at + excluded_pause_seconds + (self.break_minutes + self.lag_grace_minutes) * 60
        if now < due_at:
            return {"due": False, "project_id": project_id, "due_at": due_at}
        last_lag_at = float(state.get("last_lag_at") or 0)
        already_recent = int(state.get("last_lag_project_id") or 0) == project_id and now - last_lag_at < self.lag_repeat_minutes * 60
        return {
            "due": not already_recent,
            "project_id": project_id,
            "study_minutes": int(summary["study_seconds"] / 60),
            "target_minutes": summary["target_minutes"],
            "inactive_minutes": max(0, int((now - last_ended_at - excluded_pause_seconds) / 60)),
            "behind_minutes": max(0, int((now - due_at) / 60)),
            "due_at": due_at,
        }

    def mark_lag_reminded(self, project_id: int, now: float | None = None) -> None:
        now = now if now is not None else time.time()
        self.store.update_daily_study_state(
            local_date(now),
            last_lag_project_id=max(0, int(project_id or 0)),
            last_lag_at=now,
        )
