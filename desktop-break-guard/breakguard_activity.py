from __future__ import annotations

import os
import time


class RuntimeActivityGuard:
    """Detect periods the desktop timer could not reliably observe."""

    def __init__(self, long_gap_seconds: int = 90):
        self.long_gap_seconds = max(10, int(long_gap_seconds))
        self.last_tick_at: float | None = None
        self.locked_at: float | None = None

    def observe(self, now: float | None = None, locked: bool = False) -> int:
        now = float(now if now is not None else time.time())
        gap_excluded = 0
        if self.last_tick_at is not None:
            elapsed = max(0.0, now - self.last_tick_at)
            if elapsed > self.long_gap_seconds:
                gap_excluded = max(0, int(elapsed - 1))
        self.last_tick_at = now

        if locked:
            if self.locked_at is None:
                self.locked_at = now
            return gap_excluded

        lock_excluded = 0
        if self.locked_at is not None:
            lock_excluded = max(0, int(now - self.locked_at))
            self.locked_at = None
        return max(gap_excluded, lock_excluded)


def windows_session_locked() -> bool:
    if os.name != "nt":
        return False
    try:
        import ctypes

        desktop = ctypes.windll.user32.OpenInputDesktop(0, False, 0x0100)
        if not desktop:
            return True
        ctypes.windll.user32.CloseDesktop(desktop)
    except (AttributeError, OSError):
        return False
    return False
