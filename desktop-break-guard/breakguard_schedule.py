from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime

from breakguard_state import utc_iso
from breakguard_storage import BreakGuardStore


def local_date(timestamp: float | None = None) -> str:
    return datetime.fromtimestamp(timestamp if timestamp is not None else time.time()).strftime("%Y-%m-%d")


def parse_clock(value: str) -> tuple[int, int]:
    try:
        hour, minute = (int(part) for part in str(value).split(":", 1))
    except (TypeError, ValueError):
        return 8, 0
    return max(0, min(23, hour)), max(0, min(59, minute))


@dataclass
class CourseSession:
    session_id: str
    lesson_date: str
    lesson_number: int
    started_at: float
    started_iso: str
    project_id: int = 0
    project_name: str = ""


class CoursePlanner:
    def __init__(
        self,
        store: BreakGuardStore,
        daily_lessons: int,
        lesson_minutes: int,
        break_minutes: int,
        day_start: str,
        lag_grace_minutes: int,
        lag_repeat_minutes: int = 30,
    ):
        self.store = store
        self.configure(daily_lessons, lesson_minutes, break_minutes, day_start, lag_grace_minutes, lag_repeat_minutes)
        raw = self.store.load_course_session()
        self.session = CourseSession(**raw) if raw else None

    def configure(
        self,
        daily_lessons: int,
        lesson_minutes: int,
        break_minutes: int,
        day_start: str,
        lag_grace_minutes: int,
        lag_repeat_minutes: int = 30,
    ) -> None:
        self.daily_lessons = max(1, min(12, int(daily_lessons)))
        self.lesson_minutes = max(10, min(180, int(lesson_minutes)))
        self.break_minutes = max(1, min(60, int(break_minutes)))
        self.day_start = f"{parse_clock(day_start)[0]:02d}:{parse_clock(day_start)[1]:02d}"
        self.lag_grace_minutes = max(0, min(180, int(lag_grace_minutes)))
        self.lag_repeat_minutes = max(5, min(180, int(lag_repeat_minutes)))

    def _default_lesson(self, day: str) -> int:
        completed = self.store.completed_lesson_numbers(day)
        return next((number for number in range(1, self.daily_lessons + 1) if number not in completed), self.daily_lessons)

    def selected_lesson(self, now: float | None = None) -> int:
        day = local_date(now)
        selected = int(self.store.daily_schedule_state(day).get("selected_lesson") or 0)
        return selected if 1 <= selected <= self.daily_lessons else self._default_lesson(day)

    def select_lesson(self, lesson_number: int, now: float | None = None) -> int:
        selected = max(1, min(self.daily_lessons, int(lesson_number)))
        self.store.update_daily_schedule_state(local_date(now), selected_lesson=selected)
        return selected

    def start_course(
        self,
        now: float | None = None,
        project_id: int = 0,
        project_name: str = "",
        lesson_number: int | None = None,
    ) -> CourseSession:
        if self.session:
            return self.session
        now = now if now is not None else time.time()
        day = local_date(now)
        selected = self.select_lesson(lesson_number or self.selected_lesson(now), now)
        self.clear_pause(now)
        self.session = CourseSession(
            session_id=uuid.uuid4().hex,
            lesson_date=day,
            lesson_number=selected,
            started_at=now,
            started_iso=utc_iso(now),
            project_id=int(project_id or 0),
            project_name=str(project_name or ""),
        )
        self.store.save_course_session(asdict(self.session))
        return self.session

    def complete_course(self, now: float | None = None) -> tuple[CourseSession | None, int]:
        if not self.session:
            return None, 0
        now = now if now is not None else time.time()
        current = self.session
        duration = max(0, int(now - current.started_at))
        self.store.add_lesson_record({
            "session_id": current.session_id,
            "lesson_date": current.lesson_date,
            "lesson_number": current.lesson_number,
            "started_at": current.started_at,
            "ended_at": now,
            "duration_seconds": duration,
        })
        completed = self.store.completed_lesson_numbers(current.lesson_date)
        next_lesson = next((number for number in range(1, self.daily_lessons + 1) if number not in completed), current.lesson_number)
        self.store.update_daily_schedule_state(current.lesson_date, selected_lesson=next_lesson)
        self.session = None
        self.store.clear_course_session()
        return current, duration

    def course_elapsed(self, now: float | None = None) -> int:
        if not self.session:
            return 0
        return max(0, int((now if now is not None else time.time()) - self.session.started_at))

    def set_pause(self, label: str, now: float | None = None) -> None:
        now = now if now is not None else time.time()
        day = local_date(now)
        state = self.store.daily_schedule_state(day)
        pause_started_at = state.get("pause_started_at")
        self.store.update_daily_schedule_state(
            day,
            paused_label=str(label)[:40],
            pause_started_at=float(pause_started_at) if pause_started_at is not None else now,
        )

    def clear_pause(self, now: float | None = None) -> None:
        now = now if now is not None else time.time()
        day = local_date(now)
        state = self.store.daily_schedule_state(day)
        pause_started_at = state.get("pause_started_at")
        changes = {"paused_label": "", "pause_started_at": None}
        if pause_started_at is not None:
            changes.update(
                last_pause_started_at=float(pause_started_at),
                last_pause_ended_at=now,
            )
        self.store.update_daily_schedule_state(day, **changes)

    def summary(self, now: float | None = None) -> dict:
        now = now if now is not None else time.time()
        day = local_date(now)
        stored = self.store.daily_lesson_summary(day)
        completed = int(stored["completed_lessons"])
        selected = self.session.lesson_number if self.session else self.selected_lesson(now)
        study_seconds = int(stored["study_seconds"])
        return {
            "date": day,
            "completed_lessons": completed,
            "daily_lessons": self.daily_lessons,
            "study_seconds": study_seconds,
            "progress": min(1.0, completed / self.daily_lessons),
            "next_lesson": selected,
            "paused_label": self.store.daily_schedule_state(day)["paused_label"],
        }

    def schedule_slots(self, now: float | None = None) -> list[dict]:
        now = now if now is not None else time.time()
        completed_numbers = self.store.completed_lesson_numbers(local_date(now))
        selected = self.selected_lesson(now)
        slots = []
        for index in range(1, self.daily_lessons + 1):
            status = "active" if self.session and self.session.lesson_number == index else "done" if index in completed_numbers else "pending"
            slots.append({
                "lesson_number": index,
                "status": status,
                "selected": index == selected,
            })
        return slots

    def lag_snapshot(self, now: float | None = None) -> dict:
        now = now if now is not None else time.time()
        summary = self.summary(now)
        if self.session or summary["paused_label"] or summary["completed_lessons"] >= self.daily_lessons:
            return {"due": False}
        completed_numbers = self.store.completed_lesson_numbers(summary["date"])
        lesson_number = next((number for number in range(1, self.daily_lessons + 1) if number not in completed_numbers), self.daily_lessons)
        records = self.store.list_daily_lessons(summary["date"])
        if not records:
            return {"due": False, "lesson_number": lesson_number}
        last_ended_at = max(float(record["ended_at"]) for record in records)
        state = self.store.daily_schedule_state(summary["date"])
        pause_started_at = float(state.get("last_pause_started_at") or 0)
        pause_ended_at = float(state.get("last_pause_ended_at") or 0)
        excluded_pause_seconds = 0
        if pause_ended_at > last_ended_at and pause_ended_at > pause_started_at:
            excluded_pause_seconds = max(0, pause_ended_at - max(last_ended_at, pause_started_at))
        due_at = last_ended_at + excluded_pause_seconds + (self.break_minutes + self.lag_grace_minutes) * 60
        if now < due_at:
            return {"due": False, "lesson_number": lesson_number, "due_at": due_at}
        last_lag_at = float(state.get("last_lag_at") or 0)
        already_recent = int(state.get("last_lag_lesson") or 0) == lesson_number and now - last_lag_at < self.lag_repeat_minutes * 60
        return {
            "due": not already_recent,
            "lesson_number": lesson_number,
            "completed_lessons": summary["completed_lessons"],
            "daily_lessons": self.daily_lessons,
            "inactive_minutes": max(0, int((now - last_ended_at - excluded_pause_seconds) / 60)),
            "behind_minutes": max(0, int((now - due_at) / 60)),
            "due_at": due_at,
        }

    def mark_lag_reminded(self, lesson_number: int, now: float | None = None) -> None:
        now = now if now is not None else time.time()
        self.store.update_daily_schedule_state(
            local_date(now), last_lag_lesson=int(lesson_number), last_lag_at=now,
        )
