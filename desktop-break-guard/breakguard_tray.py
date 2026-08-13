from __future__ import annotations

import queue
import sys
import threading
import time
from pathlib import Path

from breakguard_logging import log_error, logger

WM_TRAYICON = 0x8000 + 42
TRAY_ICON_ID = 1
INITIAL_RETRY_SECONDS = 1.0
MAX_RETRY_SECONDS = 30.0


class WindowsTrayIcon:
    def __init__(self, icon_path: Path, action_queue: "queue.Queue[str]"):
        self.icon_path = icon_path
        self.action_queue = action_queue
        self.hwnd = None
        self.hicon = None
        self.available = False
        self.error = ""
        self.ready_event = threading.Event()
        self.stop_event = threading.Event()
        self.thread = None
        self.taskbar_created_message = 0
        self.retry_message = 0
        self.retry_timer = None
        self.retry_seconds = INITIAL_RETRY_SECONDS
        self.failure_count = 0
        if sys.platform.startswith("win"):
            self.thread = threading.Thread(target=self._run, name="BreakGuardTray", daemon=True)
            self.thread.start()
        else:
            self.error = "system tray is only available on Windows"
            self.ready_event.set()

    def wait_until_ready(self, timeout: float = 3.0) -> bool:
        self.ready_event.wait(timeout)
        return self.available

    def _run(self) -> None:
        try:
            import win32api
            import win32con
            import win32gui

            self.win32api, self.win32con, self.win32gui = win32api, win32con, win32gui
            self.taskbar_created_message = win32gui.RegisterWindowMessage("TaskbarCreated")
            self.retry_message = win32con.WM_APP + 43
            message_map = {
                win32con.WM_DESTROY: self._on_destroy,
                win32con.WM_CLOSE: self._on_close,
                win32con.WM_COMMAND: self._on_command,
                WM_TRAYICON: self._on_notify,
                self.taskbar_created_message: self._on_taskbar_created,
                self.retry_message: self._on_retry,
            }
            wc = win32gui.WNDCLASS()
            wc.hInstance = win32api.GetModuleHandle(None)
            wc.lpszClassName = f"BreakGuardTrayWindow{int(time.time() * 1000)}"
            wc.lpfnWndProc = message_map
            win32gui.RegisterClass(wc)
            self.hwnd = win32gui.CreateWindow(
                wc.lpszClassName,
                "Break Guard Tray",
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                wc.hInstance,
                None,
            )
            self.hicon = self._load_icon()
            if not self._register_icon():
                self._schedule_retry()
            self.ready_event.set()
            win32gui.PumpMessages()
        except Exception as exc:
            self.error = str(exc)
            self.available = False
            self.ready_event.set()
            log_error("system tray failed", exc)

    def _notify_data(self):
        flags = self.win32gui.NIF_ICON | self.win32gui.NIF_MESSAGE | self.win32gui.NIF_TIP
        return (
            self.hwnd,
            TRAY_ICON_ID,
            flags,
            WM_TRAYICON,
            self.hicon,
            "Exam Planner 休息守护",
        )

    def _register_icon(self) -> bool:
        if self.stop_event.is_set() or not self.hwnd:
            return False
        try:
            self.win32gui.Shell_NotifyIcon(self.win32gui.NIM_ADD, self._notify_data())
            try:
                self.win32gui.Shell_NotifyIcon(
                    self.win32gui.NIM_SETVERSION,
                    (self.hwnd, TRAY_ICON_ID, self.win32gui.NOTIFYICON_VERSION_4),
                )
            except Exception:
                # The icon is still usable on older shell implementations.
                pass
            recovered = not self.available
            failures = self.failure_count
            self.available = True
            self.error = ""
            self.retry_seconds = INITIAL_RETRY_SECONDS
            self.failure_count = 0
            if recovered:
                if failures:
                    logger.info("system tray recovered after %s registration failure(s)", failures)
                else:
                    logger.info("system tray registered")
                self.action_queue.put("tray_ready")
            return True
        except Exception as exc:
            self.available = False
            self.error = str(exc)
            self.failure_count += 1
            if self.failure_count == 1 or self.failure_count % 10 == 0:
                log_error("system tray registration failed; retry scheduled", exc)
            return False

    def _schedule_retry(self) -> None:
        if self.stop_event.is_set() or not self.hwnd:
            return
        delay = max(0.25, self.retry_seconds)
        self.retry_seconds = min(MAX_RETRY_SECONDS, self.retry_seconds * 2)
        try:
            if self.retry_timer:
                self.retry_timer.cancel()
            self.retry_timer = threading.Timer(delay, self._post_retry)
            self.retry_timer.daemon = True
            self.retry_timer.start()
        except Exception as exc:
            log_error("system tray retry scheduling failed", exc)

    def _post_retry(self) -> None:
        if self.stop_event.is_set() or not self.hwnd:
            return
        try:
            self.win32gui.PostMessage(self.hwnd, self.retry_message, 0, 0)
        except Exception as exc:
            log_error("system tray retry post failed", exc)

    def _on_retry(self, _hwnd, _msg, _wparam, _lparam):
        self.retry_timer = None
        if not self._register_icon():
            self._schedule_retry()
        return True

    def _on_taskbar_created(self, _hwnd, _msg, _wparam, _lparam):
        self.available = False
        if not self._register_icon():
            self._schedule_retry()
        return True

    def _load_icon(self):
        if self.icon_path.exists():
            try:
                return self.win32gui.LoadImage(
                    None,
                    str(self.icon_path),
                    self.win32con.IMAGE_ICON,
                    0,
                    0,
                    self.win32con.LR_LOADFROMFILE | self.win32con.LR_DEFAULTSIZE,
                )
            except Exception as exc:
                log_error("tray icon load failed", exc)
        return self.win32gui.LoadIcon(0, self.win32con.IDI_APPLICATION)

    def _on_notify(self, _hwnd, _msg, _wparam, lparam):
        try:
            event = int(lparam) & 0xFFFF
            if event == self.win32con.WM_LBUTTONDBLCLK:
                self.action_queue.put("toggle")
            elif event in (
                self.win32con.WM_RBUTTONDOWN,
                self.win32con.WM_RBUTTONUP,
                self.win32con.WM_CONTEXTMENU,
            ):
                self._show_menu()
        except Exception as exc:
            log_error("tray notification failed", exc)
        return True

    def _on_command(self, _hwnd, _msg, wparam, _lparam):
        action = {
            101: "show",
            102: "hide",
            103: "reset",
            104: "hide",
            105: "quit",
            106: "test_fullscreen",
        }.get(int(wparam) & 0xFFFF)
        if action:
            self.action_queue.put(action)
        return True

    def _on_close(self, hwnd, _msg, _wparam, _lparam):
        self.win32gui.DestroyWindow(hwnd)
        return True

    def _on_destroy(self, hwnd, _msg, _wparam, _lparam):
        self.stop_event.set()
        if self.retry_timer:
            self.retry_timer.cancel()
            self.retry_timer = None
        try:
            self.win32gui.Shell_NotifyIcon(self.win32gui.NIM_DELETE, (hwnd, TRAY_ICON_ID))
        except Exception:
            pass
        self.available = False
        self.win32gui.PostQuitMessage(0)
        return True

    def _show_menu(self) -> None:
        menu = None
        try:
            menu = self.win32gui.CreatePopupMenu()
            for command_id, label in (
                (101, "显示窗口"),
                (102, "隐藏窗口"),
                (103, "重置窗口位置"),
                (104, "最小化到托盘"),
                (106, "测试全屏提醒"),
            ):
                self.win32gui.AppendMenu(menu, self.win32con.MF_STRING, command_id, label)
            self.win32gui.AppendMenu(menu, self.win32con.MF_SEPARATOR, 0, "")
            self.win32gui.AppendMenu(menu, self.win32con.MF_STRING, 105, "退出程序")
            x, y = self.win32gui.GetCursorPos()
            self.win32gui.SetForegroundWindow(self.hwnd)
            self.win32gui.TrackPopupMenu(
                menu,
                self.win32con.TPM_LEFTALIGN | self.win32con.TPM_RIGHTBUTTON,
                x,
                y,
                0,
                self.hwnd,
                None,
            )
            self.win32gui.PostMessage(self.hwnd, 0, 0, 0)
        finally:
            if menu is not None:
                self.win32gui.DestroyMenu(menu)

    def remove(self) -> None:
        self.stop_event.set()
        if self.retry_timer:
            self.retry_timer.cancel()
            self.retry_timer = None
        if self.hwnd:
            try:
                self.win32gui.PostMessage(self.hwnd, self.win32con.WM_CLOSE, 0, 0)
            except Exception as exc:
                log_error("tray cleanup failed", exc)
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)
