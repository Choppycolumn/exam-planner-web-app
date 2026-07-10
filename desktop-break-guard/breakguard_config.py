from __future__ import annotations

import json
from dataclasses import asdict, dataclass

from breakguard_logging import log_error
from breakguard_runtime import CONFIG_FILE, CONFIG_TEMPLATE_FILE, LEGACY_CONFIG_FILE
from breakguard_secrets import protect_secret, unprotect_secret


@dataclass
class Config:
    server_url: str
    token: str
    break_minutes: int = 10
    notify_after_seconds: int = 60
    unfocused_after_seconds: int = 300
    always_on_top: bool = True
    opacity: float = 0.99
    verify_tls: bool = True
    window_geometry: str = ""

    @classmethod
    def load(cls) -> "Config":
        source = CONFIG_FILE if CONFIG_FILE.exists() else LEGACY_CONFIG_FILE
        if source.exists():
            raw = json.loads(source.read_text(encoding="utf-8-sig"))
        elif CONFIG_TEMPLATE_FILE.exists():
            raw = json.loads(CONFIG_TEMPLATE_FILE.read_text(encoding="utf-8-sig"))
        else:
            raw = {}
        token = unprotect_secret(str(raw.get("token_protected", ""))) or str(raw.get("token", ""))
        config = cls(
            server_url=str(raw.get("server_url", "")).rstrip("/"), token=token,
            break_minutes=max(1, int(raw.get("break_minutes", 10))),
            notify_after_seconds=max(5, int(raw.get("notify_after_seconds", 60))),
            unfocused_after_seconds=max(30, int(raw.get("unfocused_after_seconds", 300))),
            always_on_top=bool(raw.get("always_on_top", True)),
            opacity=max(0.55, min(1.0, float(raw.get("opacity", 0.97)))),
            verify_tls=bool(raw.get("verify_tls", True)),
            window_geometry=str(raw.get("window_geometry", "")),
        )
        config.save()
        if source == LEGACY_CONFIG_FILE and LEGACY_CONFIG_FILE.exists() and raw.get("token"):
            try:
                sanitized = {**raw, "token": "", "migrated_to_local_app_data": True}
                LEGACY_CONFIG_FILE.write_text(json.dumps(sanitized, indent=2, ensure_ascii=False), encoding="utf-8")
            except Exception as exc:
                log_error("legacy configuration sanitization failed", exc)
        return config

    def save(self) -> None:
        payload = asdict(self)
        payload.pop("token", None)
        payload["token_protected"] = protect_secret(self.token)
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary = CONFIG_FILE.with_suffix(".tmp")
        temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        temporary.replace(CONFIG_FILE)
