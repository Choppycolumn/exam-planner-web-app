from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .client import GatewayError, YitClient
from .config import Config, load_config
from .jobs import (
    in_bookable_window,
    list_jobs,
    resolve_job_date,
    update_job,
)
from .keepalive import ping
from .login import LoginError, login_with_captcha
from .notify import notify, notify_bark
from .pause import is_paused, remaining
from .seats import BookError, book_action, book_space, fetch_segment, fetch_spaces, list_books, pick_space
from .session import load_session, resolve_session_path, save_session
from .accounts import ensure_from_config, jobs_name_for, load_store

log = logging.getLogger("seatbot")

# 心跳失败退避：30s → 60s → 120s → … 上限 10 分钟
_BACKOFF_START = 30.0
_BACKOFF_MAX = 600.0
_SESSION_SAVE_MIN_INTERVAL = 300.0  # 正常时最多 5 分钟写一次 session


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(s: str | None) -> float | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def run_job_once(
    cfg: Config,
    root: Path,
    job: dict[str, Any],
    *,
    dry_run: bool = False,
) -> tuple[bool, str, dict[str, Any] | None]:
    """执行单个任务一次。返回 (成功, 消息, 结果详情)。"""
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
        seg = fetch_segment(client, area_id, target_day, start_time, end_time)
        spaces = fetch_spaces(client, seg)
        seat = pick_space(spaces, seat_nos, fallback)
    except (BookError, GatewayError) as exc:
        return False, str(exc), None

    if dry_run:
        return True, f"演练成功 将约座位 {seat.no}", {"space_id": seat.id, "no": seat.no}

    try:
        result = book_space(client, auth, seg, seat)
    except BookError as exc:
        return False, str(exc), None
    except GatewayError as exc:
        return False, f"网关异常: {exc}", None

    info = ((result.get("data") or {}).get("list")) or {}
    space_info = info.get("spaceInfo") or {}
    area_info = space_info.get("areaInfo") or {}
    detail = {
        "order_no": info.get("no"),
        "book_id": info.get("id"),
        "seat_no": space_info.get("no") or seat.no,
        "area": area_info.get("nameMerge"),
        "start": info.get("starttime"),
        "end": info.get("endingtime"),
        "checkin": "pending",
        "checkin_msg": "",
    }
    msg = (
        f"预约成功 单号={detail['order_no']} 座位={detail['seat_no']} "
        f"区域={detail['area']} {detail['start']}~{detail['end']}"
    )
    save_session(client, store)
    return True, msg, detail



def _resolve_book_id(client, cfg, detail: dict[str, Any]) -> str:
    bid = str((detail or {}).get("book_id") or "").strip()
    if bid and bid != "None":
        return bid
    order = str((detail or {}).get("order_no") or "")
    if not order:
        return ""
    try:
        from .login import login_with_captcha
        auth = login_with_captcha(client, dump_dir=Path("/tmp"))
        for it in list_books(client, auth, 1):
            if str(it.get("no") or "") == order:
                return str(it.get("id") or "")
    except Exception as exc:
        log.warning("查找预约 id 失败: %s", exc)
    return ""


def _booking_still_open(item: dict[str, Any]) -> bool:
    name = str(item.get("statusName") or "") + str(item.get("submsg") or "")
    st = int(item.get("status") or 0)
    if st in (4, 6):
        return False
    if any(k in name for k in ("取消", "超时", "关闭", "已使用", "签离")):
        return False
    return True


def _auto_checkin_once(client, root: Path, store: Path, cfg: Config, detail: dict[str, Any]) -> dict[str, Any]:
    detail = dict(detail or {})
    try:
        from .login import login_with_captcha
        auth = login_with_captcha(client, dump_dir=root / "logs")
        bid = _resolve_book_id(client, cfg, detail)
        if not bid:
            detail["checkin"] = "pending"
            detail["checkin_msg"] = "预约成功但未拿到预约id，稍后重试签到"
            return detail
        detail["book_id"] = bid
        payload = book_action(client, auth, bid, "checkin")
        msg = str((payload or {}).get("msg") or "签到成功")
        detail["checkin"] = "ok"
        detail["checkin_msg"] = msg
        save_session(client, store)
        return detail
    except Exception as exc:
        text = str(exc)
        detail["checkin"] = "pending"
        detail["checkin_msg"] = text
        log.warning("自动签到暂未成功: %s", text)
        return detail


def _retry_pending_checkins(cfg, root, client, store, jobs_path) -> None:
    for job in list_jobs(jobs_path):
        if job.get("status") != "success":
            continue
        detail = dict(job.get("result") or {})
        if detail.get("checkin") in ("ok", "stopped"):
            continue
        if not detail.get("order_no") and not detail.get("book_id"):
            continue
        # 超过 3 小时不再打
        try:
            updated = job.get("updated_at") or ""
            # 粗线：有 book 结果就继续，直到馆方取消
        except Exception:
            pass
        try:
            from .login import login_with_captcha
            auth = login_with_captcha(client, dump_dir=root / "logs")
            bid = _resolve_book_id(client, cfg, detail)
            if not bid:
                items = list_books(client, auth, 1)
                order = str(detail.get("order_no") or "")
                found = next((x for x in items if str(x.get("no")) == order), None)
                if not found:
                    detail["checkin"] = "stopped"
                    detail["checkin_msg"] = "预约已不在列表中（取消/超时/释放）"
                    update_job(jobs_path, job["id"], result=detail)
                    log.info("[%s] 停止自动签到：预约已不存在", job["id"])
                    continue
                bid = str(found.get("id") or "")
                if not _booking_still_open(found):
                    detail["checkin"] = "stopped"
                    detail["checkin_msg"] = "预约已结束: " + str(found.get("statusName") or "")
                    update_job(jobs_path, job["id"], result=detail)
                    continue
            payload = book_action(client, auth, bid, "checkin")
            msg = str((payload or {}).get("msg") or "签到成功")
            detail["book_id"] = bid
            detail["checkin"] = "ok"
            detail["checkin_msg"] = msg
            update_job(jobs_path, job["id"], result=detail)
            save_session(client, store)
            log.info("[%s] 自动签到成功: %s", job["id"], msg)
        except Exception as exc:
            text = str(exc)
            detail["checkin"] = "pending"
            detail["checkin_msg"] = text
            update_job(jobs_path, job["id"], result=detail)
            if any(k in text for k in ("取消", "不存在", "已结束", "已签离", "已使用")):
                detail["checkin"] = "stopped"
                update_job(jobs_path, job["id"], result=detail)
                log.info("[%s] 停止自动签到: %s", job["id"], text)
            else:
                log.warning("[%s] 自动签到重试中: %s", job["id"], text[:180])



def _bark_once(root: Path, key: str, title: str, body: str) -> None:
    stamp = root / "logs" / "bark-sent.txt"
    stamp.parent.mkdir(parents=True, exist_ok=True)
    seen = set()
    if stamp.exists():
        seen = {ln.strip() for ln in stamp.read_text(encoding="utf-8", errors="replace").splitlines() if ln.strip()}
    if key in seen:
        return
    if notify_bark(title, body):
        with stamp.open("a", encoding="utf-8") as f:
            f.write(key + "\n")
        log.info("Bark 已发送 %s", key)


def _watch_unsigned_books(cfg, root, client, jobs_path) -> None:
    """未签到预约临近释放时 Bark。"""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    try:
        from .login import login_with_captcha
        auth = login_with_captcha(client, dump_dir=root / "logs")
        items = list_books(client, auth, 1)
    except Exception as exc:
        log.debug("watch books skip: %s", exc)
        return
    tz = ZoneInfo(cfg.timezone)
    now = datetime.now(tz)
    for it in items:
        bid = str(it.get("id") or "")
        no = str(it.get("no") or "")
        status_name = str(it.get("statusName") or "")
        sub = str(it.get("submsg") or "")
        signed = int(it.get("signIn") or 0) == 1
        begin = it.get("beginTime") or {}
        if isinstance(begin, dict):
            begin_s = str(begin.get("date") or "")
        else:
            begin_s = str(begin or "")
        try:
            bt = datetime.strptime(begin_s[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=tz)
        except Exception:
            continue
        minutes = (now - bt).total_seconds() / 60.0
        space = it.get("spaceInfo") or {}
        seat = ""
        if isinstance(space, dict):
            seat = str(space.get("no") or space.get("name") or "")
        else:
            seat = str(space)
        # 已关闭/已使用/取消不提醒
        if any(k in status_name for k in ("取消", "关闭", "已使用", "超时")):
            continue
        if signed:
            continue
        remain = 30 - minutes
        if remain <= 5:
            _bark_once(root, f"expire5-{no}", "还剩约5分钟释放", f"{no} {seat} 仍未签到，约 {max(0,int(remain))} 分钟后可能被释放。")
        elif remain <= 10:
            _bark_once(root, f"expire10-{no}", "还剩约10分钟释放", f"{no} {seat} 仍未签到，约 {max(0,int(remain))} 分钟后可能被释放。")

def process_due_jobs(
    cfg: Config,
    root: Path,
    jobs_path: Path,
    *,
    last_session_save: float = 0.0,
) -> tuple[bool, float]:
    """扫描并处理到期任务。

    返回 (网关会话是否有效, 上次 session 落盘时间戳)。
    """
    store = resolve_session_path(root, cfg.session_file)
    client = YitClient(cfg)
    load_session(client, store)

    if is_paused(root):
        log.info("登录已暂停，剩余 %.0f 秒，跳过抢座/签到/自动登录", remaining(root))
        return True, last_session_save

    session_ok = False
    try:
        session_ok = bool(ping(client))
        if session_ok:
            now = time.time()
            # 正常时降低写盘频率，避免每 5 秒刷 session.json
            if now - last_session_save >= _SESSION_SAVE_MIN_INTERVAL:
                save_session(client, store)
                last_session_save = now
        else:
            log.warning("worker 心跳失败，等待本机 agent 更新 session.json")
    except Exception as exc:
        log.warning("worker 心跳异常: %s", exc)
        session_ok = False

    if not session_ok:
        return False, last_session_save

    _retry_pending_checkins(cfg, root, client, store, jobs_path)
    _watch_unsigned_books(cfg, root, client, jobs_path)

    now_ts = time.time()
    for job in list_jobs(jobs_path):
        status = job.get("status")
        if status in ("success", "failed", "cancelled"):
            continue

        job_id = job["id"]
        if not in_bookable_window(job, cfg.timezone):
            if status != "pending":
                update_job(jobs_path, job_id, status="pending", last_error="等待进入今明后窗口")
            continue

        next_at = _parse_iso(job.get("next_attempt_at"))
        if next_at and now_ts < next_at:
            continue

        update_job(jobs_path, job_id, status="ready", last_error="")
        log.info("执行任务 %s area=%s seats=%s", job_id, job.get("area_id"), job.get("seat_nos"))
        ok, msg, detail = run_job_once(cfg, root, job, dry_run=cfg.dry_run)
        if ok:
            if not cfg.dry_run:
                detail = _auto_checkin_once(client, root, store, cfg, detail)
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
            if (detail or {}).get("checkin") == "ok":
                log.info("[%s] 预约后自动签到成功: %s", job_id, (detail or {}).get("checkin_msg"))
            notify(cfg.notify_webhook, f"[拾座] {msg}")
            _run_sprint_script(root, "sprint_end.sh")
            continue

        fail_count = int(job.get("fail_count") or 0) + 1
        max_retries = int(job.get("max_retries") or 10)
        interval = int(job.get("retry_interval_sec") or 60)
        log.warning("[%s] 失败 %s/%s: %s", job_id, fail_count, max_retries, msg)

        if fail_count >= max_retries:
            update_job(
                jobs_path,
                job_id,
                status="failed",
                fail_count=fail_count,
                last_error=msg,
                next_attempt_at=None,
            )
            notify(
                cfg.notify_webhook,
                f"[拾座] 任务 {job_id} 连续失败 {fail_count} 次，已停止。最后错误: {msg}",
            )
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

    return True, last_session_save




def _run_sprint_script(root: Path, name: str) -> None:
    import subprocess
    script = root / "scripts" / name
    if not script.exists():
        script = Path("/opt/seatbot/scripts") / name
    if not script.exists():
        return
    try:
        subprocess.run(["/bin/bash", str(script)], timeout=60, check=False)
        log.info("已执行 %s", script)
    except Exception as exc:
        log.warning("执行 %s 失败: %s", name, exc)

def _trigger_server_login(root: Path, *, force: bool = False) -> None:
    """拉起独立 oneshot 登录进程（不在 worker 里加载 OCR）。"""
    import subprocess
    if is_paused(root):
        log.info("暂停中，跳过自动登录")
        return

    stamp = root / "logs" / "last_server_login"
    stamp.parent.mkdir(parents=True, exist_ok=True)
    now = time.time()
    try:
        if not force and stamp.exists() and now - stamp.stat().st_mtime < 180:
            return
        stamp.write_text(str(int(now)))
    except Exception:
        pass

    # 优先 systemd oneshot（有内存上限）；否则直接拉短进程
    try:
        r = subprocess.run(
            ["systemctl", "start", "--no-block", "seatbot-login.service"],
            timeout=10,
            capture_output=True,
            text=True,
        )
        if r.returncode == 0:
            log.info("已请求 seatbot-login.service 重新登录")
            return
        log.warning("systemctl start seatbot-login 失败: %s", (r.stderr or r.stdout or "")[:200])
    except Exception as exc:
        log.warning("无法启动 seatbot-login: %s", exc)

    py = root / ".venv" / "bin" / "python"
    if not py.exists():
        py = Path("/opt/seatbot/.venv/bin/python")
    try:
        subprocess.Popen(
            [str(py), str(root / "main.py"), "--auto-cas"],
            cwd=str(root),
            stdout=open(root / "logs" / "server-login.log", "a"),
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        log.info("已后台启动 --auto-cas")
    except Exception as exc:
        log.warning("后台自动登录失败: %s", exc)


def worker_loop(
    cfg: Config,
    root: Path,
    jobs_path: Path,
    *,
    poll_sec: float = 15.0,
) -> None:
    """长期运行：正常 15s 扫任务；会话失效时指数退避，避免打满日志/CPU。"""
    log.info(
        "多任务 worker 启动 jobs=%s poll=%.0fs backoff=%s~%ss session_save>=%ss",
        jobs_path,
        poll_sec,
        int(_BACKOFF_START),
        int(_BACKOFF_MAX),
        int(_SESSION_SAVE_MIN_INTERVAL),
    )
    try:
        ensure_from_config(root, root / "config.yaml")
    except Exception:
        pass
    sleep_for = poll_sec
    last_session_save = 0.0
    fail_streak = 0
    last_preflight_day = ""

    while True:
        try:
            now_local = datetime.now(timezone(timedelta(hours=8)))
            hhmm = now_local.strftime("%H:%M")
            today = now_local.strftime("%Y-%m-%d")
            # 23:50 登录交给 systemd preflight（避免和 timer 叠两次 OCR）
            if hhmm >= "23:50" and last_preflight_day != today:
                last_preflight_day = today
                log.info("23:50 预检窗口：等待 seatbot-preflight 登录，worker 只做心跳")
            sprint = hhmm >= "23:50" or hhmm < "00:10"

            try:
                cfg = load_config(root / "config.yaml")
                store = load_store(root)
                active = str(store.get("active") or cfg.username or "")
                if active:
                    jobs_path = root / jobs_name_for(active)
            except Exception:
                pass
            ok, last_session_save = process_due_jobs(
                cfg, root, jobs_path, last_session_save=last_session_save
            )
            if ok:
                if fail_streak:
                    log.info("网关会话已恢复，恢复正常轮询 %.0fs", poll_sec)
                fail_streak = 0
                sleep_for = 2.0 if sprint else poll_sec
            else:
                fail_streak += 1
                if sprint:
                    sleep_for = 5.0
                else:
                    sleep_for = min(_BACKOFF_MAX, _BACKOFF_START * (2 ** min(fail_streak - 1, 4)))
                log.info(
                    "会话无效，%s 秒后再探（连续失败 %s 次）。尝试服务器自动登录。",
                    int(sleep_for),
                    fail_streak,
                )
                _trigger_server_login(root, force=sprint)
        except Exception:
            log.exception("worker 轮询异常")
            sleep_for = min(_BACKOFF_MAX, max(sleep_for, 60.0))
        time.sleep(sleep_for)
