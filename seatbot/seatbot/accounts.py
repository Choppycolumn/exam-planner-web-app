from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import yaml

ACCOUNTS_FILE = "accounts.json"


def _safe_user(username: str) -> str:
    u = re.sub(r"[^A-Za-z0-9_-]+", "_", (username or "").strip())
    return u or "user"


def accounts_path(root: Path) -> Path:
    return root / ACCOUNTS_FILE


def session_name_for(username: str) -> str:
    return f"session-{_safe_user(username)}.json"


def jobs_name_for(username: str) -> str:
    return f"jobs-{_safe_user(username)}.json"


def load_store(root: Path) -> dict[str, Any]:
    p = accounts_path(root)
    if not p.exists():
        return {"active": "", "accounts": []}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"active": "", "accounts": []}
    if not isinstance(data, dict):
        return {"active": "", "accounts": []}
    data.setdefault("active", "")
    data.setdefault("accounts", [])
    return data


def save_store(root: Path, store: dict[str, Any]) -> None:
    accounts_path(root).write_text(
        json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def public_list(store: dict[str, Any]) -> dict[str, Any]:
    items = []
    for acc in store.get("accounts") or []:
        items.append(
            {
                "username": acc.get("username"),
                "label": acc.get("label") or acc.get("username"),
                "has_session": False,
            }
        )
    return {"active": store.get("active") or "", "accounts": items}


def find_account(store: dict[str, Any], username: str) -> dict[str, Any] | None:
    for acc in store.get("accounts") or []:
        if str(acc.get("username") or "") == username:
            return acc
    return None


def upsert_account(
    root: Path,
    *,
    username: str,
    password: str,
    label: str = "",
) -> dict[str, Any]:
    username = username.strip()
    if not username or not password:
        raise ValueError("学号和密码都不能为空")
    store = load_store(root)
    acc = find_account(store, username)
    if acc:
        acc["password"] = password
        if label:
            acc["label"] = label
        acc["session_file"] = session_name_for(username)
    else:
        store["accounts"].append(
            {
                "username": username,
                "password": password,
                "label": label or username,
                "session_file": session_name_for(username),
            }
        )
    if not store.get("active"):
        store["active"] = username
    save_store(root, store)
    return store


def remove_account(root: Path, username: str) -> dict[str, Any]:
    store = load_store(root)
    accs = [a for a in store.get("accounts") or [] if str(a.get("username")) != username]
    if not accs:
        raise ValueError("至少保留一个账号")
    store["accounts"] = accs
    if store.get("active") == username:
        store["active"] = accs[0]["username"]
    save_store(root, store)
    return store


def apply_active_to_config(root: Path, config_path: Path, username: str | None = None) -> dict[str, Any]:
    """把指定账号写回 config.yaml（worker / 登录都读它）。"""
    store = load_store(root)
    username = username or str(store.get("active") or "")
    acc = find_account(store, username)
    if not acc:
        raise ValueError("账号不存在")
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    raw["username"] = acc["username"]
    raw["password"] = acc["password"]
    raw["session_file"] = acc.get("session_file") or session_name_for(acc["username"])
    config_path.write_text(
        yaml.safe_dump(raw, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    store["active"] = acc["username"]
    save_store(root, store)
    return acc


def ensure_from_config(root: Path, config_path: Path) -> dict[str, Any]:
    """首次把 config.yaml 里的账号收进 accounts.json。"""
    raw = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    username = str(raw.get("username") or "").strip()
    password = str(raw.get("password") or "")
    store = load_store(root)
    if username and password and not find_account(store, username):
        store = upsert_account(root, username=username, password=password, label="默认")
        apply_active_to_config(root, config_path, username)
        # 沿用已有 session.json
        src = root / str(raw.get("session_file") or "session.json")
        dst = root / session_name_for(username)
        if src.exists() and src.resolve() != dst.resolve():
            try:
                dst.write_bytes(src.read_bytes())
            except Exception:
                pass
        jobs_src = root / "jobs.json"
        jobs_dst = root / jobs_name_for(username)
        if jobs_src.exists() and not jobs_dst.exists():
            try:
                jobs_dst.write_bytes(jobs_src.read_bytes())
            except Exception:
                pass
    elif username and not store.get("active"):
        store["active"] = username
        save_store(root, store)
    return load_store(root)
