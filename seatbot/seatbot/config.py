from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml


@dataclass
class Config:
    username: str
    password: str
    base_url: str = "https://libresource.hust.edu.cn/http/80/133/9/114/202/yitlink"
    cookie: str = ""
    area_id: int = 101
    seat_nos: list[str] = field(default_factory=lambda: ["002"])
    day_offset: int = 1
    date: str = ""
    start_time: str = "08:30"
    end_time: str = "22:00"
    grab_at: str = "06:00:00"
    timezone: str = "Asia/Shanghai"
    captcha_retries: int = 8
    book_retries: int = 12
    retry_interval: float = 0.2
    fallback_any_free: bool = False
    dry_run: bool = False
    keepalive_interval: int = 180
    notify_webhook: str = ""
    session_file: str = "session.json"
    # 本机自动登录后上传服务器（路线 B）
    server_host: str = ""
    server_user: str = "seatbot"
    server_path: str = "/opt/seatbot"
    server_ssh_password: str = ""
    server_ssh_port: int = 22
    agent_interval: int = 300

    @property
    def origin(self) -> str:
        if "/http/" in self.base_url:
            return self.base_url.split("/http/", 1)[0]
        return self.base_url.rsplit("/", 1)[0]


def _require(raw: dict[str, Any], key: str) -> Any:
    if key not in raw or raw[key] in (None,):
        raise ValueError(f"配置缺少字段: {key}")
    return raw[key]


def load_config(path: str | Path, *, require_account: bool = True) -> Config:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"找不到配置文件: {p}（先复制 config.example.yaml 为 config.yaml）")
    raw = yaml.safe_load(p.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise ValueError("config.yaml 格式错误")

    username = str(raw.get("username") or "").strip()
    password = str(raw.get("password") or "")
    if require_account and (not username or not password):
        raise ValueError("请在 config.yaml 填写 username 和 password")

    seats = raw.get("seat_nos") or []
    if isinstance(seats, str):
        seats = [s.strip() for s in seats.split(",") if s.strip()]
    seats = [
        str(s).strip().zfill(3) if str(s).strip().isdigit() else str(s).strip()
        for s in seats
    ]
    if require_account and not seats:
        raise ValueError("seat_nos 不能为空")

    return Config(
        username=username,
        password=password,
        base_url=str(raw.get("base_url") or Config.base_url).rstrip("/"),
        cookie=str(raw.get("cookie") or "").strip(),
        area_id=int(raw.get("area_id") or 101),
        seat_nos=seats or ["002"],
        day_offset=int(raw.get("day_offset") or 0),
        date=str(raw.get("date") or "").strip(),
        start_time=str(raw.get("start_time") or "08:30"),
        end_time=str(raw.get("end_time") or "22:00"),
        grab_at=str(raw.get("grab_at") or "").strip(),
        timezone=str(raw.get("timezone") or "Asia/Shanghai"),
        captcha_retries=max(1, int(raw.get("captcha_retries") or 8)),
        book_retries=max(1, int(raw.get("book_retries") or 12)),
        retry_interval=float(raw.get("retry_interval") or 0.2),
        fallback_any_free=bool(raw.get("fallback_any_free") or False),
        dry_run=bool(raw.get("dry_run") or False),
        keepalive_interval=max(30, int(raw.get("keepalive_interval") or 180)),
        notify_webhook=str(raw.get("notify_webhook") or "").strip(),
        session_file=str(raw.get("session_file") or "session.json").strip(),
        server_host=str(raw.get("server_host") or "").strip(),
        server_user=str(raw.get("server_user") or "seatbot").strip(),
        server_path=str(raw.get("server_path") or "/opt/seatbot").strip(),
        server_ssh_password=str(raw.get("server_ssh_password") or ""),
        server_ssh_port=int(raw.get("server_ssh_port") or 22),
        agent_interval=max(60, int(raw.get("agent_interval") or 300)),
    )
