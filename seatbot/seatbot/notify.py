from __future__ import annotations

import logging
from pathlib import Path
from urllib.parse import quote

import requests

log = logging.getLogger("seatbot")

_BARK_ENV_CANDIDATES = (
    Path("/etc/exam-planner/bark.env"),
    Path("/opt/seatbot/bark.env"),
)


def _load_bark() -> tuple[str, str]:
    server = "https://api.day.app"
    key = ""
    for p in _BARK_ENV_CANDIDATES:
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            v = v.strip().strip('"').strip("'")
            if k.strip() == "BARK_SERVER_URL" and v:
                server = v.rstrip("/")
            if k.strip() == "BARK_DEVICE_KEY" and v:
                key = v
    return server, key


def notify_bark(title: str, body: str, *, group: str = "seatbot", level: str = "timeSensitive") -> bool:
    server, key = _load_bark()
    if not key:
        log.warning("Bark 未配置（缺少 BARK_DEVICE_KEY）")
        return False
    url = f"{server}/{quote(key, safe='')}/{quote(title[:80] or '拾座', safe='')}/{quote((body or '')[:400], safe='')}"
    try:
        r = requests.get(url, params={"group": group, "level": level, "isArchive": "1"}, timeout=10)
        if r.status_code >= 400:
            log.warning("Bark HTTP %s", r.status_code)
            return False
        return True
    except Exception as exc:
        log.warning("Bark 发送失败: %s", exc)
        return False


def notify(webhook: str, text: str) -> None:
    notify_bark("拾座", text or "")
    if not webhook:
        return
    try:
        r = requests.post(webhook, json={"msgtype": "text", "text": {"content": text}}, timeout=10)
        if r.status_code >= 400:
            requests.post(webhook, data=text.encode("utf-8"), timeout=10)
        else:
            log.debug("notify ok %s", r.status_code)
    except Exception as exc:
        log.warning("通知发送失败: %s", exc)
