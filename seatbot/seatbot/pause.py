from __future__ import annotations

import json
import time
from pathlib import Path

PAUSE_FILE = "login-pause.json"


def _path(root: Path) -> Path:
    return root / PAUSE_FILE


def default_root() -> Path:
    for cand in (Path("/opt/seatbot"), Path.cwd()):
        if (cand / "config.yaml").exists() or (cand / PAUSE_FILE).exists():
            return cand
    return Path("/opt/seatbot")


def remaining(root: Path | None = None) -> float:
    root = root or default_root()
    p = _path(root)
    if not p.exists():
        return 0.0
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        until = float(data.get("until") or 0)
    except Exception:
        return 0.0
    left = until - time.time()
    if left <= 0:
        try:
            p.unlink()
        except Exception:
            pass
        return 0.0
    return left


def is_paused(root: Path | None = None) -> bool:
    return remaining(root) > 0


def pause(root: Path, seconds: int = 300) -> dict:
    until = time.time() + max(1, int(seconds))
    data = {"until": until, "seconds": int(seconds)}
    _path(root).write_text(json.dumps(data), encoding="utf-8")
    return {"paused": True, "remaining": remaining(root)}


def resume(root: Path) -> dict:
    p = _path(root)
    if p.exists():
        try:
            p.unlink()
        except Exception:
            pass
    return {"paused": False, "remaining": 0}


def state(root: Path) -> dict:
    left = remaining(root)
    return {"paused": left > 0, "remaining": int(left)}
