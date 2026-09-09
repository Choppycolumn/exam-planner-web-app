from __future__ import annotations

import logging
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .accounts import ensure_from_config, jobs_name_for, load_store
from .client import GatewayError, YitClient
from .config import Config, load_config
from .jobs import in_bookable_window, list_jobs, resolve_job_date, update_job
from .keepalive import ping
from .login import LoginError, login_with_captcha
from .notify import notify, notify_bark
from .pause import is_paused, remaining
from .runtime import WorkerRuntime
from .seats import BookError, book_action, book_space, fetch_segment, fetch_spaces, list_books, pick_space
from .session import load_session, resolve_session_path, save_session
from .work_schedule import (
    CHECKIN_RETRY,
    MAX_CHECKIN_ATTEMPTS,
    checkin_deadline,
    checkin_start,
    next_wake_plan,
    parse_iso,
    preflight_jobs_due,
)

log = logging.getLogger("seatbot")


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_job_once(
    cfg: Config,
    root: Path,
    job: dict[str, Any],
    *,
    dry_run: bool = False,
) -> tuple[bool, str, dict[str, Any] | None]:
    """Execute one reservation attempt."""
    client = YitClient(cfg)
    store = resolve_session_path(root, cfg.session_file)
    load_session(client, store)

    if not in_bookable_window(job, cfg.timezone):
        return False, "目标日期不在今明后可预约窗口，稍后再执行", None

    target_day = resolve_job_date(job, cfg.timezone)
    area_id = int(job["area_id"])
    seat_nos = list(job.get("seat_nos") or [])
    start_time = str(job.get("start_time") or "08:30")
    end_time = str(job.get("end_time") or "22:00")
    fallback = bool(job.get("fallback_any_free"))

    try:
        auth = login_with_captcha(client, dump_dir=root / "logs")
        save_session(client, store)
    except (LoginError, GatewayError) as exc:
        return False, f"登录失败: {exc}", None

    try:
        segment = fetch_segment(client, area_id, target_day, start_time, end_time)
        spaces = fetch_spaces(client, segment)
        seat = pick_space(spaces, seat_nos, fallback)
    except (BookError, GatewayError) as exc:
        return False, str(exc), None

    if dry_run:
        return True, f"演练成功 将约座位 {seat.no}", {"space_id": seat.id, "no": seat.no}

    try:
        result = book_space(client, auth, segment, seat)
    except BookError as exc:
        return False, str(exc), None
    except GatewayError as exc:
        return False, f"网关异常: {exc}", None

    info = ((result.get("data") or {}).get("list")) or {}
    space_info = info.get("spaceInfo") or {}
    area_info = space_info.get("areaInfo") or {}
    local_now = datetime.now(ZoneInfo(cfg.timezone))
    start_at = checkin_start(job, local_now)
    deadline_at = checkin_deadline(job, local_now)
    detail = {
        "order_no": info.get("no"),
        "book_id": info.get("id"),
        "seat_no": space_info.get("no") or seat.no,
        "area": area_info.get("nameMerge"),
        "start": info.get("starttime"),
        "end": info.get("endingtime"),
        "checkin": "scheduled",
        "checkin_msg": "将在预约开始时间后自动尝试签到",
        "checkin_attempts": 0,
        "checkin_next_at": start_at.astimezone(timezone.utc).isoformat(),
        "checkin_deadline_at": deadline_at.astimezone(timezone.utc).isoformat(),
    }
    msg = (
        f"预约成功 单号={detail['order_no']} 座位={detail['seat_no']} "
        f"区域={detail['area']} {detail['start']}~{detail['end']}"
    )
    save_session(client, store)
    return True, msg, detail


def _resolve_book_id(client: YitClient, auth: Any, detail: dict[str, Any]) -> str:
    book_id = str((detail or {}).get("book_id") or "").strip()
    if book_id and book_id != "None":
        return book_id
    order_no = str((detail or {}).get("order_no") or "")
    if not order_no:
        return ""
    for item in list_books(client, auth, 1):
        if str(item.get("no") or "") == order_no:
            return str(item.get("id") or "")
    return ""


def _process_pending_checkins(
    cfg: Config,
    root: Path,
    jobs_path: Path,
    now: datetime,
) -> bool | None:
    """Run only due check-ins, at most three times within 30 minutes."""
    network_ok: bool | None = None
    store = resolve_session_path(root, cfg.session_file)

    for job in list_jobs(jobs_path):
        if job.get("status") != "success":
            continue
        detail = dict(job.get("result") or {})
        if detail.get("checkin") not in ("pending", "scheduled"):
            continue

        attempts = int(detail.get("checkin_attempts") or 0)
        deadline = parse_iso(detail.get("checkin_deadline_at"))
        if deadline:
            deadline = deadline.astimezone(now.tzinfo)
        else:
            deadline = checkin_deadline(job, now)
        next_at = parse_iso(detail.get("checkin_next_at"))
        if next_at:
            next_at = next_at.astimezone(now.tzinfo)
        else:
            next_at = checkin_start(job, now)

        if attempts >= MAX_CHECKIN_ATTEMPTS or now > deadline:
            detail["checkin"] = "stopped"
            detail["checkin_msg"] = "自动签到窗口已结束，请手动核对实际状态"
            update_job(jobs_path, job["id"], result=detail)
            continue
        if now < next_at:
            continue

        client = YitClient(cfg)
        load_session(client, store)
        network_ok = True
        attempts += 1
        detail["checkin_attempts"] = attempts
        try:
            auth = login_with_captcha(client, dump_dir=root / "logs")
            book_id = _resolve_book_id(client, auth, detail)
            if not book_id:
                raise BookError("未找到对应预约，请手动核对")
            payload = book_action(client, auth, book_id, "checkin")
            detail["book_id"] = book_id
            detail["checkin"] = "ok"
            detail["checkin_msg"] = str((payload or {}).get("msg") or "签到成功")
            detail["checkin_next_at"] = None
            update_job(jobs_path, job["id"], result=detail)
            save_session(client, store)
            log.info("[%s] 自动签到成功", job["id"])
        except Exception as exc:
            network_ok = False
            detail["checkin_msg"] = str(exc)[:180]
            retry_at = now + CHECKIN_RETRY
            if attempts >= MAX_CHECKIN_ATTEMPTS or retry_at > deadline:
                detail["checkin"] = "stopped"
                detail["checkin_next_at"] = None
                detail["checkin_msg"] += "；已停止自动重试，请手动核对"
                notify_bark("自动签到未完成", "已停止自动重试，请手动核对预约状态。")
            else:
                detail["checkin"] = "pending"
                detail["checkin_next_at"] = retry_at.astimezone(timezone.utc).isoformat()
            update_job(jobs_path, job["id"], result=detail)
            log.warning("[%s] 自动签到失败 %s/%s: %s", job["id"], attempts, MAX_CHECKIN_ATTEMPTS, exc)

    return network_ok


def process_due_jobs(
    cfg: Config,
    root: Path,
    jobs_path: Path,
    *,
    last_session_save: float = 0.0,
) -> tuple[bool | None, float]:
    """Process due work only. This function never performs an idle heartbeat."""
    if is_paused(root):
        return True, last_session_save

    now = datetime.now(ZoneInfo(cfg.timezone))
    network_ok = _process_pending_checkins(cfg, root, jobs_path, now)
    now_ts = time.time()

    for job in list_jobs(jobs_path):
        status = job.get("status")
        if status in ("success", "failed", "cancelled"):
            continue
        job_id = job["id"]
        target = resolve_job_date(job, cfg.timezone)
        if target < now.date():
            update_job(
                jobs_path,
                job_id,
                status="failed",
                last_error="目标日期已过，任务未执行",
                next_attempt_at=None,
            )
            continue
        if not in_bookable_window(job, cfg.timezone):
            if status != "pending":
                update_job(jobs_path, job_id, status="pending", last_error="等待进入今明后窗口")
            continue

        next_at = parse_iso(job.get("next_attempt_at"))
        if next_at and datetime.now(timezone.utc) < next_at.astimezone(timezone.utc):
            continue

        update_job(jobs_path, job_id, status="ready", last_error="")
        log.info("执行预约任务 %s", job_id)
        ok, msg, detail = run_job_once(cfg, root, job, dry_run=cfg.dry_run)
        if ok:
            network_ok = True
            update_job(
                jobs_path,
                job_id,
                status="success",
                last_error="",
                result=detail,
                next_attempt_at=None,
            )
            log.info("[%s] %s", job_id, msg)
            notify_bark("预约成功", msg)
            notify(cfg.notify_webhook, f"[拾座] {msg}")
            continue

        connection_failed = "登录失败" in msg or "网关异常" in msg
        network_ok = False if connection_failed else (network_ok if network_ok is not None else True)
        fail_count = int(job.get("fail_count") or 0) + 1
        max_retries = int(job.get("max_retries") or 10)
        interval = max(15, int(job.get("retry_interval_sec") or 60))
        log.warning("[%s] 预约失败 %s/%s: %s", job_id, fail_count, max_retries, msg)
        if connection_failed:
            _trigger_server_login(root)

        if fail_count >= max_retries:
            update_job(
                jobs_path,
                job_id,
                status="failed",
                fail_count=fail_count,
                last_error=msg,
                next_attempt_at=None,
            )
            notify(cfg.notify_webhook, f"[拾座] 任务 {job_id} 已停止。最后错误: {msg}")
        else:
            next_iso = datetime.fromtimestamp(now_ts + interval, tz=timezone.utc).isoformat()
            update_job(
                jobs_path,
                job_id,
                status="ready",
                fail_count=fail_count,
                last_error=msg,
                next_attempt_at=next_iso,
            )

    return network_ok, last_session_save


def _run_preflight(
    cfg: Config,
    root: Path,
    jobs_path: Path,
    runtime: WorkerRuntime,
) -> None:
    now = datetime.now(ZoneInfo(cfg.timezone))
    due = preflight_jobs_due(list_jobs(jobs_path), cfg.timezone, now)
    if not due:
        return

    client = YitClient(cfg)
    store = resolve_session_path(root, cfg.session_file)
    has_session = load_session(client, store)
    alive = False
    if has_session:
        try:
            alive = bool(ping(client, retries=1))
        except Exception as exc:
            log.warning("预约窗口预检失败: %s", exc)
    if alive:
        save_session(client, store)
        log.info("预约窗口预检通过，等待到点执行")
    else:
        log.warning("预约窗口预检未通过，拉起一次登录恢复")
        _trigger_server_login(root)

    checked_at = _iso_now()
    for job in due:
        update_job(
            jobs_path,
            job["id"],
            preflight_checked_at=checked_at,
            preflight_status="ok" if alive else "recovering",
        )
    runtime.checked(
        alive,
        worker_mode="waiting",
        worker_reason="预检完成，等待预约窗口",
    )


def _trigger_server_login(root: Path) -> None:
    """Start one bounded login recovery process, at most once every three minutes."""
    if is_paused(root):
        return
    stamp = root / "logs" / "last_server_login"
    stamp.parent.mkdir(parents=True, exist_ok=True)
    now = time.time()
    try:
        if stamp.exists() and now - stamp.stat().st_mtime < 180:
            return
        stamp.write_text(str(int(now)), encoding="utf-8")
    except OSError:
        pass

    try:
        result = subprocess.run(
            ["systemctl", "start", "--no-block", "seatbot-login.service"],
            timeout=10,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode == 0:
            log.info("已请求一次预约登录恢复")
            return
        log.warning("预约登录服务启动失败: %s", (result.stderr or result.stdout or "")[:200])
    except Exception as exc:
        log.warning("无法启动预约登录服务: %s", exc)


def _active_context(cfg: Config, root: Path, jobs_path: Path) -> tuple[Config, Path]:
    try:
        cfg = load_config(root / "config.yaml")
        store = load_store(root)
        active = str(store.get("active") or cfg.username or "")
        if active:
            jobs_path = root / jobs_name_for(active)
    except Exception as exc:
        log.warning("刷新预约配置失败，沿用当前配置: %s", exc)
    return cfg, jobs_path


def _status_time(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value else None


def worker_loop(
    cfg: Config,
    root: Path,
    jobs_path: Path,
    *,
    runtime: WorkerRuntime | None = None,
) -> None:
    """Sleep until a task deadline or API wake signal; never poll the gateway while idle."""
    runtime = runtime or WorkerRuntime()
    log.info("事件驱动预约 worker 启动：无任务时不访问馆方接口")
    try:
        ensure_from_config(root, root / "config.yaml")
    except Exception:
        pass

    while True:
        observed_revision = runtime.revision()
        cfg, jobs_path = _active_context(cfg, root, jobs_path)
        now = datetime.now(ZoneInfo(cfg.timezone))

        if is_paused(root):
            wait_seconds = max(1.0, remaining(root))
            wake_at = now + timedelta(seconds=wait_seconds)
            runtime.update(
                worker_mode="paused",
                worker_reason="预约服务已暂停",
                next_wake_at=_status_time(wake_at),
            )
            runtime.wait_after(observed_revision, wait_seconds)
            continue

        jobs = list_jobs(jobs_path)
        plan = next_wake_plan(jobs, cfg.timezone, now)
        if plan.at is None:
            runtime.update(
                worker_mode="idle",
                worker_reason="没有待执行任务",
                next_wake_at=None,
            )
            runtime.wait_after(observed_revision, None)
            continue

        delay = max(0.0, (plan.at - now).total_seconds())
        if delay > 0.05:
            reason = "等待任务进入今明后窗口" if plan.reason == "preflight" else "等待下次任务时间"
            runtime.update(
                worker_mode="waiting",
                worker_reason=reason,
                next_wake_at=_status_time(plan.at),
            )
            runtime.wait_after(observed_revision, delay)
            continue

        if plan.reason == "preflight":
            runtime.update(worker_mode="preflight", worker_reason="正在执行预约窗口预检", next_wake_at=None)
            _run_preflight(cfg, root, jobs_path, runtime)
            continue

        runtime.update(worker_mode="active", worker_reason="正在处理预约任务", next_wake_at=None)
        ok, _ = process_due_jobs(cfg, root, jobs_path)
        runtime.checked(
            ok,
            worker_mode="idle",
            worker_reason="任务处理完成，重新计算唤醒时间",
        )
