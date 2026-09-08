from __future__ import annotations

import logging
import time
from datetime import datetime
from pathlib import Path

from .client import GatewayError, YitClient
from .notify import notify
from .session import load_session, save_session

log = logging.getLogger("seatbot")


def ping(client: YitClient, retries: int = 3) -> bool:
    """轻量请求，确认资源网关 Cookie 仍有效。网络闪断会重试。"""
    referer = client.url(f"/home/web/seat/area/{client.cfg.area_id}")
    last_exc: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            payload = client.get_json(
                f"/api.php/v3areadays/{client.cfg.area_id}", referer=referer
            )
            return int(payload.get("status") or 0) == 1
        except GatewayError as exc:
            log.warning("心跳失败（网关）: %s", exc)
            return False
        except Exception as exc:
            last_exc = exc
            log.warning("心跳异常 (%s/%s): %s", attempt, retries, exc)
            if attempt < retries:
                time.sleep(1.5 * attempt)
    if last_exc:
        log.warning("心跳在 %s 次尝试后仍失败: %s", retries, last_exc)
    return False


def wait_for_relogin(client: YitClient, path: Path) -> None:
    msg = (
        f"网关会话失效。请在本机执行：python main.py --login\n"
        f"然后把 {path.name} 上传到服务器（scripts/upload_session.sh）。\n"
        f"本进程会监视该文件，更新后自动继续。"
    )
    log.error(msg)
    notify(client.cfg.notify_webhook, f"[拾座] {msg}")

    last_mtime = path.stat().st_mtime if path.exists() else 0.0
    while True:
        time.sleep(3)
        if not path.exists():
            continue
        mtime = path.stat().st_mtime
        if mtime <= last_mtime:
            continue
        last_mtime = mtime
        if not load_session(client, path):
            continue
        if ping(client):
            save_session(client, path)
            log.info("重新登录已确认，继续保活")
            notify(client.cfg.notify_webhook, "[拾座] 会话已恢复，继续保活")
            return
        log.warning("会话文件已更新，但仍被踢到统一认证，请再登录一次")


def wait_until_with_keepalive(
    client: YitClient,
    target: datetime,
    tz_name: str,
    interval: float,
    path: Path,
) -> None:
    from .scheduler import _zone
    tz = _zone(tz_name)
    log.info(
        "进入保活，目标 %s，心跳间隔 %.0f 秒",
        target.strftime("%Y-%m-%d %H:%M:%S %Z"),
        interval,
    )
    last_ping = 0.0
    while True:
        now = datetime.now(tz)
        remain = (target - now).total_seconds()
        if remain <= 0:
            log.info("到点，结束保活，开始抢座")
            return
        due = last_ping == 0.0 or (time.time() - last_ping) >= interval
        if due:
            ok = ping(client)
            last_ping = time.time()
            if ok:
                save_session(client, path)
                log.info("心跳成功  距开抢 %.0f 秒", remain)
            else:
                wait_for_relogin(client, path)
                last_ping = time.time()
        time.sleep(min(1.0, max(remain, 0.05)))
