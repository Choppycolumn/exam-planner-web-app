from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .client import YitClient

log = logging.getLogger("seatbot")


def resolve_session_path(root: Path, name: str) -> Path:
    p = Path(name)
    return p if p.is_absolute() else root / p


def dump_cookies(client: YitClient) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for c in client.session.cookies:
        out.append(
            {
                "name": c.name,
                "value": c.value,
                "domain": c.domain or "",
                "path": c.path or "/",
            }
        )
    return out


def save_session(client: YitClient, path: Path) -> None:
    payload = {
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "base_url": client.base,
        "cookies": dump_cookies(client),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("会话已写入 %s（%s 枚 Cookie）", path, len(payload["cookies"]))


def load_session(client: YitClient, path: Path) -> bool:
    if not path.exists():
        return False
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("读取会话失败: %s", exc)
        return False
    cookies = data.get("cookies") or []
    if not cookies:
        return False
    client.session.cookies.clear()
    for item in cookies:
        name = str(item.get("name") or "")
        value = str(item.get("value") or "")
        if not name:
            continue
        client.session.cookies.set(
            name,
            value,
            domain=item.get("domain") or None,
            path=item.get("path") or "/",
        )
    log.info(
        "已加载会话 %s（%s 枚 Cookie，保存于 %s）",
        path.name,
        len(cookies),
        data.get("saved_at") or "-",
    )
    return True


def cookie_header_to_items(header: str) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for part in header.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        items.append({"name": name.strip(), "value": value.strip(), "domain": "", "path": "/"})
    return items
