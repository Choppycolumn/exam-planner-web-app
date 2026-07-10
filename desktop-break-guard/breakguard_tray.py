from __future__ import annotations

import queue
import sys
import threading
import time
from pathlib import Path

from breakguard_logging import log_error

WM_TRAYICON = 0x8000 + 42


class WindowsTrayIcon:
    def __init__(self, icon_path: Path, action_queue: "queue.Queue[str]"):
        self.icon_path = icon_path
        self.action_queue = action_queue
        self.hwnd = None
        self.hicon = None
        self.available = False
        self.error = ""
        self.ready_event = threading.Event()
        self.thread = None
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
            message_map = {
                win32con.WM_DESTROY: self._on_destroy,
                win32con.WM_CLOSE: self._on_close,
                win32con.WM_COMMAND: self._on_command,
                WM_TRAYICON: self._on_notify,
            }
            wc = win32gui.WNDCLASS()
            wc.hInstance = win32api.GetModuleHandle(None)
            wc.lpszClassName = f"BreakGuardTrayWindow{int(time.time() * 1000)}"
            wc.lpfnWndProc = message_map
            win32gui.RegisterClass(wc)
            self.hwnd = win32gui.CreateWindow(wc.lpszClassName, "Break Guard Tray", 0, 0, 0, 0, 0, 0, 0, wc.hInstance, None)
            self.hicon = self._load_icon()
            flags = win32gui.NIF_ICON | win32gui.NIF_MESSAGE | win32gui.NIF_TIP
            win32gui.Shell_NotifyIcon(win32gui.NIM_ADD, (self.hwnd, 0, flags, WM_TRAYICON, self.hicon, "Exam Planner 休息守护"))
            self.available = True
            self.ready_event.set()
            win32gui.PumpMessages()
        except Exception as exc:
            self.error = str(exc)
            self.available = False
            self.ready_event.set()
            log_error("system tray failed", exc)

    def _load_icon(self):
        if self.icon_path.exists():
            try:
                return self.win32gui.LoadImage(None, str(self.icon_path), self.win32con.IMAGE_ICON, 0, 0, self.win32con.LR_LOADFROMFILE | self.win32con.LR_DEFAULTSIZE)
            except Exception as exc:
                log_error("tray icon load failed", exc)
        return self.win32gui.LoadIcon(0, self.win32con.IDI_APPLICATION)

    def _on_notify(self, _hwnd, _msg, _wparam, lparam):
        try:
            if lparam == self.win32con.WM_LBUTTONDBLCLK:
                self.action_queue.put("toggle")
            elif lparam in (self.win32con.WM_RBUTTONDOWN, self.win32con.WM_RBUTTONUP, self.win32con.WM_CONTEXTMENU):
                self._show_menu()
        except Exception as exc:
            log_error("tray notification failed", exc)
        return True

    def _on_command(self, _hwnd, _msg, wparam, _lparam):
        action = {101: "show", 102: "hide", 103: "reset", 104: "hide", 105: "quit", 106: "test_fullscreen"}.get(int(wparam) & 0xFFFF)
        if action:
            self.action_queue.put(action)
        return True

    def _on_close(self, hwnd, _msg, _wparam, _lparam):
        self.win32gui.DestroyWindow(hwnd)
        return True

    def _on_destroy(self, hwnd, _msg, _wparam, _lparam):
        try:
            self.win32gui.Shell_NotifyIcon(self.win32gui.NIM_DELETE, (hwnd, 0))
        except Exception:
            pass
        self.available = False
        self.win32gui.PostQuitMessage(0)
        return True

    def _show_menu(self) -> None:
        menu = None
        try:
            menu = self.win32gui.CreatePopupMenu()
            for command_id, label in ((101, "显示窗口"), (102, "隐藏窗口"), (103, "重置窗口位置"), (104, "最小化到托盘"), (106, "测试全屏提醒")):
                self.win32gui.AppendMenu(menu, self.win32con.MF_STRING, command_id, label)
            self.win32gui.AppendMenu(menu, self.win32con.MF_SEPARATOR, 0, "")
            self.win32gui.AppendMenu(menu, self.win32con.MF_STRING, 105, "退出程序")
            x, y = self.win32gui.GetCursorPos()
            self.win32gui.SetForegroundWindow(self.hwnd)
            self.win32gui.TrackPopupMenu(menu, self.win32con.TPM_LEFTALIGN | self.win32con.TPM_RIGHTBUTTON, x, y, 0, self.hwnd, None)
            self.win32gui.PostMessage(self.hwnd, 0, 0, 0)
        finally:
            if menu is not None:
                self.win32gui.DestroyMenu(menu)

    def remove(self) -> None:
        if self.hwnd and self.available:
            try:
                self.win32gui.PostMessage(self.hwnd, self.win32con.WM_CLOSE, 0, 0)
            except Exception as exc:
                log_error("tray cleanup failed", exc)
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2)
