from __future__ import annotations

import json
import logging
import threading
import uuid
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("seatbot")

_lock = threading.RLock()

STATUSES = (
    "pending",    # 新建，等待进入可执行窗口
    "ready",      # 已在今明后范围内，等待/正在执行
    "success",
    "failed",     # 重试耗尽
    "cancelled",
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_jobs_path(root: Path) -> Path:
    return root / "jobs.json"


def empty_store() -> dict[str, Any]:
    return {"version": 1, "jobs": []}


def load_jobs(path: Path) -> dict[str, Any]:
    with _lock:
        if not path.exists():
            return empty_store()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("读取 jobs 失败: %s", exc)
            return empty_store()
        if not isinstance(data, dict):
            return empty_store()
        data.setdefault("version", 1)
        data.setdefault("jobs", [])
        return data


def save_jobs(path: Path, data: dict[str, Any]) -> None:
    with _lock:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp.replace(path)


def list_jobs(path: Path) -> list[dict[str, Any]]:
    return list(load_jobs(path).get("jobs") or [])


def get_job(path: Path, job_id: str) -> dict[str, Any] | None:
    for j in list_jobs(path):
        if j.get("id") == job_id:
            return j
    return None


def add_job(path: Path, body: dict[str, Any]) -> dict[str, Any]:
    area_id = int(body.get("area_id") or 101)
    seats = body.get("seat_nos") or body.get("seats") or []
    if isinstance(seats, str):
        seats = [s.strip() for s in seats.split(",") if s.strip()]
    seats = [
        str(s).strip().zfill(3) if str(s).strip().isdigit() else str(s).strip()
        for s in seats
    ]
    if not seats:
        raise ValueError("seat_nos 不能为空")

    day_offset = body.get("day_offset")
    date_str = str(body.get("date") or "").strip()
    if date_str:
        day_offset = None
    else:
        day_offset = int(day_offset if day_offset is not None else 1)
        if day_offset < 0:
            raise ValueError("day_offset 不能为负")
        # 允许 >2：任务会挂起，进入今明后窗口后再执行

    job = {
        "id": str(uuid.uuid4())[:8],
        "kind": str(body.get("kind") or "reservation"),
        "source_book_id": str(body.get("source_book_id") or ""),
        "source_order_no": str(body.get("source_order_no") or ""),
        "area_id": area_id,
        "seat_nos": seats,
        "day_offset": day_offset,
        "date": date_str,
        "start_time": str(body.get("start_time") or "08:30"),
        "end_time": str(body.get("end_time") or "22:00"),
        "fallback_any_free": bool(body.get("fallback_any_free") or False),
        "max_retries": int(body.get("max_retries") or 10),
        "retry_interval_sec": int(body.get("retry_interval_sec") or 60),
        "fail_count": 0,
        "status": "pending",
        "last_error": "",
        "next_attempt_at": None,
        "result": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    with _lock:
        data = load_jobs(path)
        data["jobs"].append(job)
        save_jobs(path, data)
    log.info("新建预约任务 %s area=%s seats=%s date=%s", job["id"], area_id, seats, date_str)
    return job


def add_jobs_range(path: Path, body: dict[str, Any]) -> list[dict[str, Any]]:
    """按日期闭区间每天生成一条任务。"""
    from datetime import date, timedelta

    start = str(body.get("date_from") or body.get("date") or "").strip()
    end = str(body.get("date_to") or start).strip()
    if not start:
        raise ValueError("请填写开始日期")
    d0 = date.fromisoformat(start)
    d1 = date.fromisoformat(end)
    if d1 < d0:
        raise ValueError("结束日期不能早于开始日期")
    if (d1 - d0).days > 31:
        raise ValueError("一次最多 31 天")
    jobs = []
    cur = d0
    while cur <= d1:
        item = dict(body)
        item["date"] = cur.isoformat()
        item.pop("date_from", None)
        item.pop("date_to", None)
        jobs.append(add_job(path, item))
        cur += timedelta(days=1)
    return jobs


def update_job(path: Path, job_id: str, **fields: Any) -> dict[str, Any] | None:
    with _lock:
        data = load_jobs(path)
        for j in data["jobs"]:
            if j.get("id") == job_id:
                j.update(fields)
                j["updated_at"] = _now_iso()
                save_jobs(path, data)
                return deepcopy(j)
    return None


def cancel_job(path: Path, job_id: str) -> bool:
    j = update_job(path, job_id, status="cancelled", last_error="用户取消")
    return j is not None


def delete_job(path: Path, job_id: str) -> bool:
    with _lock:
        data = load_jobs(path)
        before = len(data["jobs"])
        data["jobs"] = [j for j in data["jobs"] if j.get("id") != job_id]
        if len(data["jobs"]) == before:
            return False
        save_jobs(path, data)
        return True


def resolve_job_date(job: dict[str, Any], tz_name: str = "Asia/Shanghai") -> date:
    from .seats import resolve_target_date

    return resolve_target_date(
        str(job.get("date") or ""),
        int(job.get("day_offset") if job.get("day_offset") is not None else 0),
        tz_name,
    )


def days_until(job: dict[str, Any], tz_name: str = "Asia/Shanghai") -> int:
    """目标日相对今天的天数差（可负）。"""
    try:
        from zoneinfo import ZoneInfo

        today = datetime.now(ZoneInfo(tz_name)).date()
    except Exception:
        today = datetime.now(timezone(timedelta(hours=8))).date()
    target = resolve_job_date(job, tz_name)
    return (target - today).days


def in_bookable_window(job: dict[str, Any], tz_name: str = "Asia/Shanghai") -> bool:
    """仅今明后（0/1/2）可执行。"""
    d = days_until(job, tz_name)
    return 0 <= d <= 2
