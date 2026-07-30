from __future__ import annotations

import ctypes
import os
import queue
import socket
import sys
import threading
import time

from breakguard_logging import log_error


class SingleInstance:
    PORT = int(os.environ.get("BREAK_GUARD_INSTANCE_PORT", "49372"))
    MUTEX_NAME = os.environ.get("BREAK_GUARD_MUTEX_NAME", "Local\\ExamPlannerBreakGuardSingleInstance")

    def __init__(self, action_queue: "queue.Queue[str]"):
        self.action_queue = action_queue
        self.mutex = None
        self.primary = True
        self.stop_event = threading.Event()
        self.socket = None
        self.thread = None
        if sys.platform.startswith("win"):
            self.mutex = ctypes.windll.kernel32.CreateMutexW(None, False, self.MUTEX_NAME)
            self.primary = ctypes.windll.kernel32.GetLastError() != 183
        if self.primary:
            self.thread = threading.Thread(target=self._listen, daemon=True, name="BreakGuardInstance")
            self.thread.start()

    def notify_existing(self) -> None:
        for _ in range(5):
            try:
                with socket.create_connection(("127.0.0.1", self.PORT), timeout=0.5) as client:
                    client.sendall(b"show")
                return
            except OSError:
                time.sleep(0.15)

    def _listen(self) -> None:
        try:
            with socket.socket() as listener:
                self.socket = listener
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                listener.bind(("127.0.0.1", self.PORT))
                listener.listen(2)
                listener.settimeout(0.5)
                while not self.stop_event.is_set():
                    try:
                        client, _ = listener.accept()
                    except socket.timeout:
                        continue
                    with client:
                        if client.recv(32).strip() == b"show":
                            self.action_queue.put("show")
        except Exception as exc:
            if not self.stop_event.is_set():
                log_error("single-instance listener failed", exc)

    def close(self) -> None:
        self.stop_event.set()
        try:
            with socket.create_connection(("127.0.0.1", self.PORT), timeout=0.2):
                pass
        except OSError:
            pass
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=1)
        if self.mutex:
            ctypes.windll.kernel32.CloseHandle(self.mutex)
            self.mutex = None
