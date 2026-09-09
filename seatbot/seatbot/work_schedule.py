from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo


TERMINAL_STATUSES = {"failed", "cancelled"}
PRECHECK_LEAD = timedelta(minutes=10)
CHECKIN_WINDOW = timedelta(minutes=30)
CHECKIN_RETRY = timedelta(minutes=5)
MAX_CHECKIN_ATTEMPTS = 3


@dataclass(frozen=True)
class WakePlan:
    at: datetime | None
    reason: str


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (TypeError, ValueError):
        return None


def target_date(job: dict[str, Any], now: datetime) -> date:
    explicit = str(job.get("date") or "").strip()
    if explicit:
        return date.fromisoformat(explicit)
    offset = int(job.get("day_offset") if job.get("day_offset") is not None else 0)
    return now.date() + timedelta(days=offset)


def booking_window_entry(job: dict[str, Any], now: datetime) -> datetime:
    return datetime.combine(target_date(job, now) - timedelta(days=2), time.min, now.tzinfo)


def checkin_start(job: dict[str, Any], now: datetime) -> datetime:
    raw = str(job.get("start_time") or "08:30")
    hour, minute = (int(part) for part in raw.split(":", 1))
    return datetime.combine(target_date(job, now), time(hour, minute), now.tzinfo)


def _reservation_wake(job: dict[str, Any], now: datetime) -> WakePlan | None:
    status = str(job.get("status") or "pending")
    if status in TERMINAL_STATUSES or status == "success":
        return None

    target = target_date(job, now)
    if target < now.date():
        return None

    entry = booking_window_entry(job, now)
    if now >= entry:
        next_attempt = parse_iso(job.get("next_attempt_at"))
        if next_attempt:
            next_attempt = next_attempt.astimezone(now.tzinfo)
            return WakePlan(max(now, next_attempt), "reservation")
        return WakePlan(now, "reservation")

    preflight = entry - PRECHECK_LEAD
    checked = parse_iso(job.get("preflight_checked_at"))
    if checked and checked.astimezone(now.tzinfo) >= preflight:
        return WakePlan(entry, "reservation")
    return WakePlan(max(now, preflight), "preflight")


def _checkin_wake(job: dict[str, Any], now: datetime) -> WakePlan | None:
    if job.get("status") != "success":
        return None
    detail = dict(job.get("result") or {})
    if detail.get("checkin") not in ("pending", "scheduled"):
        return None
    if int(detail.get("checkin_attempts") or 0) >= MAX_CHECKIN_ATTEMPTS:
        return WakePlan(now, "checkin")

    start = checkin_start(job, now)
    deadline = parse_iso(detail.get("checkin_deadline_at"))
    if deadline:
        deadline = deadline.astimezone(now.tzinfo)
    else:
        deadline = start + CHECKIN_WINDOW
    if now > deadline:
        return WakePlan(now, "checkin")

    next_at = parse_iso(detail.get("checkin_next_at"))
    if next_at:
        next_at = next_at.astimezone(now.tzinfo)
    else:
        next_at = start
    return WakePlan(max(now, next_at), "checkin")


def next_wake_plan(
    jobs: list[dict[str, Any]],
    timezone_name: str,
    now: datetime | None = None,
) -> WakePlan:
    tz = ZoneInfo(timezone_name)
    local_now = (now or datetime.now(tz)).astimezone(tz)
    candidates: list[WakePlan] = []
    for job in jobs:
        reservation = _reservation_wake(job, local_now)
        if reservation:
            candidates.append(reservation)
        checkin = _checkin_wake(job, local_now)
        if checkin:
            candidates.append(checkin)
    if not candidates:
        return WakePlan(None, "idle")
    return min(candidates, key=lambda item: item.at or datetime.max.replace(tzinfo=tz))


def preflight_jobs_due(
    jobs: list[dict[str, Any]],
    timezone_name: str,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    tz = ZoneInfo(timezone_name)
    local_now = (now or datetime.now(tz)).astimezone(tz)
    due: list[dict[str, Any]] = []
    for job in jobs:
        plan = _reservation_wake(job, local_now)
        if plan and plan.reason == "preflight" and plan.at and plan.at <= local_now:
            due.append(job)
    return due


def checkin_deadline(job: dict[str, Any], now: datetime) -> datetime:
    return checkin_start(job, now) + CHECKIN_WINDOW

