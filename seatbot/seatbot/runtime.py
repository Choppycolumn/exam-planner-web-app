from __future__ import annotations

import threading
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any


class WorkerRuntime:
    """Thread-safe wake signal and a small, local-only worker status snapshot."""

    def __init__(self) -> None:
        self._condition = threading.Condition()
        self._revision = 0
        self._state: dict[str, Any] = {
            "worker_mode": "starting",
            "worker_reason": "正在读取预约任务",
            "next_wake_at": None,
            "last_checked_at": None,
            "gateway_alive": None,
        }

    def revision(self) -> int:
        with self._condition:
            return self._revision

    def wake(self, reason: str = "任务发生变化") -> None:
        with self._condition:
            self._revision += 1
            self._state["worker_reason"] = reason
            self._condition.notify_all()

    def wait_after(self, revision: int, timeout: float | None) -> bool:
        """Wait until wake() changes the revision. Return True when explicitly woken."""
        with self._condition:
            if self._revision != revision:
                return True
            return self._condition.wait_for(
                lambda: self._revision != revision,
                timeout=timeout,
            )

    def update(self, **fields: Any) -> None:
        with self._condition:
            self._state.update(fields)

    def checked(self, gateway_alive: bool | None, **fields: Any) -> None:
        self.update(
            gateway_alive=gateway_alive,
            last_checked_at=datetime.now(timezone.utc).isoformat(),
            **fields,
        )

    def snapshot(self) -> dict[str, Any]:
        with self._condition:
            return deepcopy(self._state)

