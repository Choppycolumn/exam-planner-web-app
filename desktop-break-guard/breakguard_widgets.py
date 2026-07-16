from __future__ import annotations

import ctypes
import re
import sys
from tkinter import Canvas, Tk

from breakguard_logging import log_error

IS_WINDOWS = sys.platform == "win32"


def default_geometry(width: int, height: int) -> str:
    if not IS_WINDOWS:
        return f"{width}x{height}+80+80"
    screen_w = ctypes.windll.user32.GetSystemMetrics(0)
    screen_h = ctypes.windll.user32.GetSystemMetrics(1)
    return f"{width}x{height}+{max(12, screen_w - width - 36)}+{max(12, min(72, screen_h - height - 36))}"


def clamp_window_to_screen(root: Tk, width: int, height: int) -> None:
    screen_w, screen_h = root.winfo_screenwidth(), root.winfo_screenheight()
    x = max(0, min(root.winfo_x(), max(0, screen_w - width)))
    y = max(0, min(root.winfo_y(), max(0, screen_h - height)))
    root.geometry(f"{width}x{height}+{x}+{y}")


def geometry_with_size(saved: str, width: int, height: int) -> str:
    match = re.match(r"^\d+x\d+([+-]\d+)([+-]\d+)$", str(saved or ""))
    return f"{width}x{height}{match.group(1)}{match.group(2)}" if match else default_geometry(width, height)


def saved_window_size(saved: str, minimum_width: int, minimum_height: int) -> tuple[int, int]:
    match = re.match(r"^(\d+)x(\d+)[+-]\d+[+-]\d+$", str(saved or ""))
    if not match:
        return minimum_width, minimum_height
    return max(minimum_width, int(match.group(1))), max(minimum_height, int(match.group(2)))


def bring_to_front(window) -> None:
    try:
        window.deiconify()
        window.lift()
        window.focus_force()
        window.attributes("-topmost", True)
        if IS_WINDOWS:
            hwnd = ctypes.windll.user32.GetParent(window.winfo_id()) or window.winfo_id()
            ctypes.windll.user32.ShowWindow(hwnd, 5)
            ctypes.windll.user32.SetForegroundWindow(hwnd)
            ctypes.windll.user32.MessageBeep(0xFFFFFFFF)
    except Exception as exc:
        log_error("bring window to front failed", exc)


class CanvasButton:
    def __init__(self, canvas: Canvas, tag: str, command, visual: dict[str, str] | None = None):
        self.canvas, self.command = canvas, command
        self.visual = visual or {}
        self.hovered = self.pressed = False
        canvas.tag_bind(tag, "<Enter>", self.enter)
        canvas.tag_bind(tag, "<Leave>", self.leave)
        canvas.tag_bind(tag, "<ButtonPress-1>", self.press)
        canvas.tag_bind(tag, "<ButtonRelease-1>", self.release)

    def enter(self, _event) -> None:
        self.hovered = True
        self.canvas.configure(cursor="hand2")
        self._paint("hover")

    def leave(self, _event) -> None:
        self.hovered = self.pressed = False
        self.canvas.configure(cursor="")
        self._paint("normal")

    def press(self, _event) -> None:
        self.pressed = True
        self._paint("pressed")

    def release(self, _event) -> None:
        should_run = self.pressed and self.hovered
        self.pressed = False
        self._paint("hover" if self.hovered else "normal")
        if should_run:
            self.canvas.after_idle(self.command)

    def _paint(self, state: str) -> None:
        if self.visual.get("surface") and self.visual.get(state):
            self.canvas.itemconfigure(self.visual["surface"], fill=self.visual[state])

    def set_palette(self, normal: str, hover: str, pressed: str, foreground: str) -> None:
        self.visual.update({"normal": normal, "hover": hover, "pressed": pressed})
        self.canvas.itemconfigure(self.visual.get("surface", ""), fill=normal)
        self.canvas.itemconfigure(self.visual.get("label", ""), fill=foreground)
        if self.visual.get("shine"):
            self.canvas.itemconfigure(self.visual["shine"], state="normal" if foreground == "#ffffff" else "hidden")
