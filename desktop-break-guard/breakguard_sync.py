from __future__ import annotations

import json
import queue
import ssl
import threading
import time
import urllib.error
import urllib.request

from breakguard_config import Config
from breakguard_logging import log_error
from breakguard_storage import BreakGuardStore


class SyncWorker:
    def __init__(self, config: Config, store: BreakGuardStore, ui_messages: "queue.Queue[str]"):
        self.config = config
        self.store = store
        self.ui_messages = ui_messages
        self.stop_event = threading.Event()
        self.wake_event = threading.Event()
        self.last_config_pull = 0.0
        self.next_config_pull_at = 0.0
        self.config_pull_failures = 0
        self.last_config_fingerprint = ""
        self.thread = threading.Thread(target=self._run, daemon=True, name="BreakGuardSync")

    def start(self) -> None:
        self.thread.start()

    def post_event(self, event_type: str, event_id: str | None = None, **payload) -> str:
        event_id = self.store.enqueue_event(event_type, payload, event_id)
        self.wake_event.set()
        return event_id

    def close(self) -> None:
        self.stop_event.set()
        self.wake_event.set()
        if self.thread.is_alive():
            self.thread.join(timeout=3)

    def _run(self) -> None:
        while not self.stop_event.is_set():
            if self.last_config_pull <= 0:
                self.next_config_pull_at = 0.0
            if time.time() >= self.next_config_pull_at:
                self._pull_schedule_config()
            if not self._deliver_next_event():
                self.wake_event.wait(2)
                self.wake_event.clear()

    def _deliver_next_event(self) -> bool:
        event = self.store.next_due_event()
        if not event:
            return False
        ok, error, permanent = self._send(json.loads(event["payload_json"]))
        if ok:
            self.store.mark_sent(event["event_id"])
            if event["event_type"] == "schedule_config_updated":
                self.last_config_pull = 0.0
                self.next_config_pull_at = 0.0
            self.ui_messages.put("已同步到网站")
            return True
        if permanent:
            self.store.mark_failed(event["event_id"], error)
            self.ui_messages.put("同步配置无效，请检查网站地址和同步令牌")
            return True
        attempts = int(event["attempt_count"]) + 1
        delay = min(600, 10 * (2 ** min(6, max(0, attempts - 1))))
        self.store.mark_retry(event["event_id"], attempts, delay, error)
        if attempts in {1, 3, 6} or attempts % 12 == 0:
            self.ui_messages.put("网站暂时不可用，学习记录已安全保存在本地，恢复后自动补传")
        return True

    def _pull_schedule_config(self) -> bool:
        now = time.time()
        self.last_config_pull = now
        if not self.config.server_url or not self.config.token:
            self.next_config_pull_at = now + 300
            return False
        request = urllib.request.Request(
            f"{self.config.server_url}/api/break-guard/config",
            method="GET",
            headers={"Accept": "application/json", "X-Break-Guard-Token": self.config.token, "Connection": "close"},
        )
        try:
            context = None if self.config.verify_tls else ssl._create_unverified_context()
            with urllib.request.urlopen(request, timeout=8, context=context) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if isinstance(payload.get("config"), dict):
                self.store.expedite_pending_events()
                normalized = {"config": payload["config"], "projects": payload.get("projects", [])}
                fingerprint = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                if fingerprint != self.last_config_fingerprint:
                    self.last_config_fingerprint = fingerprint
                    self.ui_messages.put({"type": "schedule_config", **normalized})
            self.config_pull_failures = 0
            self.next_config_pull_at = now + 60
            return True
        except Exception as exc:
            self.config_pull_failures += 1
            delay = min(600, 15 * (2 ** min(5, self.config_pull_failures - 1)))
            self.next_config_pull_at = now + delay
            if self.config_pull_failures in {1, 3, 6} or self.config_pull_failures % 12 == 0:
                log_error(f"schedule config pull failed; retry in {delay}s", exc)
            return False

    def _send(self, payload: dict) -> tuple[bool, str, bool]:
        if not self.config.server_url or not self.config.token:
            return False, "server URL or token is not configured", False
        request = urllib.request.Request(
            f"{self.config.server_url}/api/break-guard/events",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json; charset=utf-8", "X-Break-Guard-Token": self.config.token, "Connection": "close"},
        )
        try:
            context = None if self.config.verify_tls else ssl._create_unverified_context()
            with urllib.request.urlopen(request, timeout=8, context=context) as response:
                return (200 <= response.status < 300, f"HTTP {response.status}", False)
        except urllib.error.HTTPError as exc:
            log_error(f"event sync HTTP {exc.code}", exc)
            return False, f"HTTP {exc.code}", exc.code in {400, 401, 403, 404}
        except Exception as exc:
            log_error("event sync failed", exc)
            return False, str(exc), False
