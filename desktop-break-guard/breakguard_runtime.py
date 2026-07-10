from __future__ import annotations

import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent
LOCAL_APP_DATA = Path(os.environ.get("LOCALAPPDATA") or APP_DIR)
DATA_DIR = LOCAL_APP_DATA / "ExamPlanner" / "BreakGuard"
DATA_DIR.mkdir(parents=True, exist_ok=True)

CONFIG_FILE = DATA_DIR / "config.json"
LEGACY_CONFIG_FILE = APP_DIR / "config.local.json"
CONFIG_TEMPLATE_FILE = APP_DIR / "config.example.json"
DATABASE_FILE = DATA_DIR / "break_guard.sqlite"
LOG_FILE = DATA_DIR / "break_guard.log"
ICON_FILE = APP_DIR / "app.ico"
