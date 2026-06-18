from __future__ import annotations

from dataclasses import dataclass, field
import json
import os
from pathlib import Path
from typing import Any


APP_DIR = Path(__file__).resolve().parents[1]


def user_data_dir() -> Path:
    override = os.environ.get("EXAM_PLANNER_PET_HOME")
    if override:
        return Path(override).expanduser()
    appdata = os.environ.get("APPDATA")
    if appdata:
        return Path(appdata) / "ExamPlannerPet"
    return APP_DIR / ".local-data"


@dataclass
class PetSettings:
    timezone: str = "Asia/Shanghai"
    device_id: str = "windows-main"
    server_url: str = "http://127.0.0.1:8080"
    api_token: str = "change-me"
    character_id: str = "default_pet"
    target_study_minutes: int = 180
    entertainment_limit_minutes: int = 30
    idle_threshold_seconds: int = 180
    sample_interval_seconds: int = 2
    sync_interval_seconds: int = 60
    reminder_cooldown_minutes: int = 20
    emergency_pause_minutes: int = 30
    strong_mode_enabled: bool = True
    reminder_tone: str = "strict"
    study_domains: list[str] = field(default_factory=lambda: ["chat.openai.com", "github.com", "wikipedia.org"])
    entertainment_domains: list[str] = field(default_factory=lambda: ["bilibili.com", "youtube.com", "douyin.com"])
    social_domains: list[str] = field(default_factory=lambda: ["weibo.com", "x.com", "twitter.com"])
    study_keywords: list[str] = field(default_factory=lambda: ["课程", "学习", "作业", "lecture", "tutorial", "PPT", "PDF"])
    entertainment_keywords: list[str] = field(default_factory=lambda: ["游戏", "番剧", "直播", "短视频"])
    tool_processes: list[str] = field(default_factory=lambda: ["code.exe", "pycharm64.exe", "idea64.exe", "word.exe", "excel.exe", "powerpnt.exe"])
    entertainment_processes: list[str] = field(default_factory=lambda: ["steam.exe", "epicgameslauncher.exe", "cloudmusic.exe", "qqgame.exe"])

    @property
    def database_path(self) -> Path:
        return user_data_dir() / "pet.sqlite"


def _list(value: Any, fallback: list[str]) -> list[str]:
    if not isinstance(value, list):
        return fallback
    return [str(item).strip() for item in value if str(item).strip()]


def _int(value: Any, fallback: int, minimum: int = 1) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(minimum, parsed)


def _bool(value: Any, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return fallback if value is None else bool(value)


def load_settings(config_path: Path | None = None) -> PetSettings:
    config_path = config_path or (APP_DIR / "config.json")
    settings = PetSettings()
    if not config_path.exists():
        return settings

    with config_path.open("r", encoding="utf-8") as file:
        raw = json.load(file)

    settings.timezone = str(raw.get("timezone", settings.timezone)) or "Asia/Shanghai"
    if settings.timezone != "Asia/Shanghai":
        settings.timezone = "Asia/Shanghai"
    settings.device_id = str(raw.get("deviceId", settings.device_id)).strip() or settings.device_id
    settings.server_url = str(raw.get("serverUrl", settings.server_url)).strip().rstrip("/") or settings.server_url
    settings.api_token = str(raw.get("apiToken", settings.api_token)).strip()
    settings.character_id = str(raw.get("characterId", settings.character_id)).strip() or settings.character_id
    settings.target_study_minutes = _int(raw.get("targetStudyMinutes"), settings.target_study_minutes, 0)
    settings.entertainment_limit_minutes = _int(raw.get("entertainmentLimitMinutes"), settings.entertainment_limit_minutes)
    settings.idle_threshold_seconds = _int(raw.get("idleThresholdSeconds"), settings.idle_threshold_seconds)
    settings.sample_interval_seconds = _int(raw.get("sampleIntervalSeconds"), settings.sample_interval_seconds)
    settings.sync_interval_seconds = _int(raw.get("syncIntervalSeconds"), settings.sync_interval_seconds)
    settings.reminder_cooldown_minutes = _int(raw.get("reminderCooldownMinutes"), settings.reminder_cooldown_minutes)
    settings.emergency_pause_minutes = _int(raw.get("emergencyPauseMinutes"), settings.emergency_pause_minutes)
    settings.strong_mode_enabled = _bool(raw.get("strongModeEnabled"), settings.strong_mode_enabled)
    settings.reminder_tone = str(raw.get("reminderTone", settings.reminder_tone)).strip() or settings.reminder_tone
    settings.study_domains = _list(raw.get("studyDomains"), settings.study_domains)
    settings.entertainment_domains = _list(raw.get("entertainmentDomains"), settings.entertainment_domains)
    settings.social_domains = _list(raw.get("socialDomains"), settings.social_domains)
    settings.study_keywords = _list(raw.get("studyKeywords"), settings.study_keywords)
    settings.entertainment_keywords = _list(raw.get("entertainmentKeywords"), settings.entertainment_keywords)
    settings.tool_processes = [item.lower() for item in _list(raw.get("toolProcesses"), settings.tool_processes)]
    settings.entertainment_processes = [item.lower() for item in _list(raw.get("entertainmentProcesses"), settings.entertainment_processes)]
    return settings


def save_character_id(character_id: str, config_path: Path | None = None) -> None:
    config_path = config_path or (APP_DIR / "config.json")
    raw: dict[str, Any] = {}
    if config_path.exists():
        try:
            raw = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = {}
    raw["characterId"] = str(character_id).strip() or "default_pet"
    config_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def save_settings(settings: PetSettings, config_path: Path | None = None) -> None:
    config_path = config_path or (APP_DIR / "config.json")
    payload = {
        "timezone": "Asia/Shanghai",
        "deviceId": settings.device_id,
        "serverUrl": settings.server_url,
        "apiToken": settings.api_token,
        "characterId": settings.character_id,
        "targetStudyMinutes": settings.target_study_minutes,
        "entertainmentLimitMinutes": settings.entertainment_limit_minutes,
        "idleThresholdSeconds": settings.idle_threshold_seconds,
        "sampleIntervalSeconds": settings.sample_interval_seconds,
        "syncIntervalSeconds": settings.sync_interval_seconds,
        "reminderCooldownMinutes": settings.reminder_cooldown_minutes,
        "emergencyPauseMinutes": settings.emergency_pause_minutes,
        "strongModeEnabled": settings.strong_mode_enabled,
        "reminderTone": settings.reminder_tone,
        "studyDomains": settings.study_domains,
        "entertainmentDomains": settings.entertainment_domains,
        "socialDomains": settings.social_domains,
        "studyKeywords": settings.study_keywords,
        "entertainmentKeywords": settings.entertainment_keywords,
        "toolProcesses": settings.tool_processes,
        "entertainmentProcesses": settings.entertainment_processes,
    }
    config_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
