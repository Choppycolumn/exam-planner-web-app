from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

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

    def start_course(self, now: float | None = None, project_id: int = 0, project_name: str = "") -> CourseSession:
        if self.session:
            return self.session
        now = now if now is not None else time.time()
        day = local_date(now)
        summary = self.store.daily_lesson_summary(day)
        self.store.update_daily_schedule_state(day, paused_label="")
        self.session = CourseSession(
            session_id=uuid.uuid4().hex,
            lesson_date=day,
            lesson_number=int(summary["completed_lessons"]) + 1,
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
        self.session = None
        self.store.clear_course_session()
        return current, duration

    def course_elapsed(self, now: float | None = None) -> int:
        if not self.session:
            return 0
        return max(0, int((now if now is not None else time.time()) - self.session.started_at))

    def course_remaining(self, now: float | None = None) -> int:
        return max(0, self.lesson_minutes * 60 - self.course_elapsed(now))

    def set_pause(self, label: str, now: float | None = None) -> None:
        self.store.update_daily_schedule_state(local_date(now), paused_label=str(label)[:40])

    def clear_pause(self, now: float | None = None) -> None:
        self.store.update_daily_schedule_state(local_date(now), paused_label="")

    def summary(self, now: float | None = None) -> dict:
        now = now if now is not None else time.time()
        day = local_date(now)
        stored = self.store.daily_lesson_summary(day)
        completed = int(stored["completed_lessons"])
        study_seconds = int(stored["study_seconds"])
        target_seconds = self.daily_lessons * self.lesson_minutes * 60
        return {
            "date": day,
            "completed_lessons": completed,
            "daily_lessons": self.daily_lessons,
            "study_seconds": study_seconds,
            "target_seconds": target_seconds,
            "progress": min(1.0, completed / self.daily_lessons),
            "next_lesson": completed + 1,
            "paused_label": self.store.daily_schedule_state(day)["paused_label"],
        }

    def schedule_slots(self, now: float | None = None) -> list[dict]:
        now = now if now is not None else time.time()
        day = datetime.fromtimestamp(now)
        hour, minute = parse_clock(self.day_start)
        cursor = day.replace(hour=hour, minute=minute, second=0, microsecond=0)
        completed = self.store.daily_lesson_summary(local_date(now))["completed_lessons"]
        slots = []
        for index in range(1, self.daily_lessons + 1):
            end = cursor + timedelta(minutes=self.lesson_minutes)
            status = "done" if index <= completed else "active" if self.session and self.session.lesson_number == index else "pending"
            slots.append({
                "lesson_number": index,
                "start_at": cursor.timestamp(),
                "end_at": end.timestamp(),
                "start_text": cursor.strftime("%H:%M"),
                "end_text": end.strftime("%H:%M"),
                "status": status,
            })
            cursor = end + timedelta(minutes=self.break_minutes)
        return slots

    def lag_snapshot(self, now: float | None = None) -> dict:
        now = now if now is not None else time.time()
        summary = self.summary(now)
        if self.session or summary["paused_label"] or summary["completed_lessons"] >= self.daily_lessons:
            return {"due": False}
        lesson_number = summary["completed_lessons"] + 1
        slot = self.schedule_slots(now)[lesson_number - 1]
        due_at = slot["end_at"] + self.lag_grace_minutes * 60
        if now < due_at:
            return {"due": False, "lesson_number": lesson_number, "due_at": due_at}
        state = self.store.daily_schedule_state(summary["date"])
        last_lag_at = float(state.get("last_lag_at") or 0)
        already_recent = int(state.get("last_lag_lesson") or 0) == lesson_number and now - last_lag_at < self.lag_repeat_minutes * 60
        return {
            "due": not already_recent,
            "lesson_number": lesson_number,
            "completed_lessons": summary["completed_lessons"],
            "daily_lessons": self.daily_lessons,
            "scheduled_end": slot["end_text"],
            "behind_minutes": max(0, int((now - due_at) / 60)),
            "due_at": due_at,
        }

    def mark_lag_reminded(self, lesson_number: int, now: float | None = None) -> None:
        now = now if now is not None else time.time()
        self.store.update_daily_schedule_state(
            local_date(now), last_lag_lesson=int(lesson_number), last_lag_at=now,
        )
