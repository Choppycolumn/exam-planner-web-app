#!/usr/bin/env python3
"""Exam Planner desktop break guard.

This app intentionally uses only the Python standard library so it can run on a
fresh Windows machine without bundling a heavy desktop runtime.
"""

from __future__ import annotations

import ctypes
import json
import threading
import time
import urllib.error
import urllib.request
import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from tkinter import BOTH, BOTTOM, TOP, Canvas, Label, Tk, Toplevel, messagebox


APP_DIR = Path(__file__).resolve().parent
CONFIG_FILE = APP_DIR / "config.local.json"
CONFIG_TEMPLATE_FILE = APP_DIR / "config.example.json"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def fmt_seconds(seconds: int) -> str:
    seconds = max(0, int(seconds))
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def rounded_rect(canvas: Canvas, x1: int, y1: int, x2: int, y2: int, radius: int, **kwargs) -> int:
    points = [
        x1 + radius, y1,
        x2 - radius, y1,
        x2, y1,
        x2, y1 + radius,
        x2, y2 - radius,
        x2, y2,
        x2 - radius, y2,
        x1 + radius, y2,
        x1, y2,
        x1, y2 - radius,
        x1, y1 + radius,
        x1, y1,
    ]
    return canvas.create_polygon(points, smooth=True, **kwargs)


def blend_hex(a: str, b: str, t: float) -> str:
    a = a.lstrip("#")
    b = b.lstrip("#")
    ar, ag, ab = int(a[0:2], 16), int(a[2:4], 16), int(a[4:6], 16)
    br, bg, bb = int(b[0:2], 16), int(b[2:4], 16), int(b[4:6], 16)
    return f"#{round(ar + (br - ar) * t):02x}{round(ag + (bg - ag) * t):02x}{round(ab + (bb - ab) * t):02x}"


def draw_vertical_gradient(canvas: Canvas, width: int, height: int, top: str, bottom: str) -> None:
    steps = max(1, height)
    for y in range(steps):
        canvas.create_line(0, y, width, y, fill=blend_hex(top, bottom, y / steps))


@dataclass
class Config:
    server_url: str
    token: str
    break_minutes: int = 10
    notify_after_seconds: int = 60
    unfocused_after_seconds: int = 300
    always_on_top: bool = True
    opacity: float = 0.92
    verify_tls: bool = True

    @classmethod
    def load(cls) -> "Config":
        if not CONFIG_FILE.exists():
            if CONFIG_TEMPLATE_FILE.exists():
                CONFIG_FILE.write_text(CONFIG_TEMPLATE_FILE.read_text(encoding="utf-8"), encoding="utf-8")
            else:
                CONFIG_FILE.write_text(json.dumps({
                    "server_url": "https://example.com",
                    "token": "",
                    "break_minutes": 10,
                    "notify_after_seconds": 60,
                    "unfocused_after_seconds": 300,
                    "always_on_top": True,
                    "opacity": 0.92,
                    "verify_tls": True,
                }, indent=2, ensure_ascii=False), encoding="utf-8")
        raw = json.loads(CONFIG_FILE.read_text(encoding="utf-8-sig"))
        return cls(
            server_url=str(raw.get("server_url", "")).rstrip("/"),
            token=str(raw.get("token", "")),
            break_minutes=max(1, int(raw.get("break_minutes", 10))),
            notify_after_seconds=max(5, int(raw.get("notify_after_seconds", 60))),
            unfocused_after_seconds=max(30, int(raw.get("unfocused_after_seconds", 300))),
            always_on_top=bool(raw.get("always_on_top", True)),
            opacity=max(0.55, min(1.0, float(raw.get("opacity", 0.92)))),
            verify_tls=bool(raw.get("verify_tls", True)),
        )


class BreakGuardClient:
    def __init__(self, config: Config, status_callback):
        self.config = config
        self.status_callback = status_callback

    def post_event(self, event_type: str, **payload) -> None:
        if not self.config.server_url or not self.config.token:
            self.status_callback("未配置网站同步")
            return
        body = {
            "eventType": event_type,
            "source": "desktop-break-guard",
            **payload,
        }
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            f"{self.config.server_url}/api/break-guard/events",
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "X-Break-Guard-Token": self.config.token,
                "Connection": "close",
            },
        )

        def worker() -> None:
            try:
                context = None if self.config.verify_tls else ssl._create_unverified_context()
                with urllib.request.urlopen(request, timeout=8, context=context) as response:
                    if 200 <= response.status < 300:
                        self.status_callback("已同步到网站")
                    else:
                        self.status_callback(f"同步异常 HTTP {response.status}")
            except urllib.error.HTTPError as exc:
                self.status_callback(f"同步失败 HTTP {exc.code}")
            except Exception:
                self.status_callback("同步失败，稍后重试")

        threading.Thread(target=worker, daemon=True).start()


class GlassButton(Label):
    def __init__(self, master, text: str, command, bg="#ffffff", fg="#0f172a", padx=14, pady=10):
        super().__init__(
            master,
            text=text,
            bg=bg,
            fg=fg,
            padx=padx,
            pady=pady,
            cursor="hand2",
            font=("Microsoft YaHei UI", 10, "bold"),
        )
        self.command = command
        self.bind("<Button-1>", lambda _event: self.command())
        self.bind("<Enter>", lambda _event: self.configure(bg="#f8fafc"))
        self.bind("<Leave>", lambda _event: self.configure(bg=bg))


class CanvasButton:
    def __init__(self, canvas: Canvas, tag: str, command):
        self.canvas = canvas
        self.tag = tag
        self.command = command
        canvas.tag_bind(tag, "<Button-1>", lambda _event: command())
        canvas.tag_bind(tag, "<Enter>", lambda _event: canvas.configure(cursor="hand2"))
        canvas.tag_bind(tag, "<Leave>", lambda _event: canvas.configure(cursor=""))


class BreakGuardApp:
    def __init__(self):
        self.config = Config.load()
        self.root = Tk()
        self.root.title("休息守护")
        self.normal_geometry = "390x224+80+80"
        self.compact_geometry = "116x54+80+80"
        self.root.geometry(self.normal_geometry)
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", self.config.always_on_top)
        self.root.attributes("-alpha", min(0.96, max(0.72, self.config.opacity)))
        self.root.configure(bg="#eef6ff")
        self.root.protocol("WM_DELETE_WINDOW", self.minimize)
        self.root.bind("<ButtonPress-1>", self.start_drag)
        self.root.bind("<B1-Motion>", self.drag)
        self.client = BreakGuardClient(self.config, self.set_status)
        self.break_started_at: float | None = None
        self.break_started_iso = ""
        self.break_running = False
        self.warning_sent = False
        self.unfocused_recorded = False
        self.fullscreen: Toplevel | None = None
        self.drag_offset = (0, 0)
        self.compact = False
        self.canvas: Canvas | None = None
        self.timer_var = None
        self.status_label = None
        self.subtitle_label = None
        self.state_dot = None
        self.button_commands = []
        self.enable_acrylic()
        self.hide_from_taskbar()
        self.build_ui()
        self.tick()

    def enable_acrylic(self) -> None:
        if not hasattr(ctypes, "windll"):
            return
        try:
            self.root.update_idletasks()
            hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id())
            accent_policy = ctypes.c_int * 4
            accent = accent_policy(3, 0x20 | 0x40 | 0x80 | 0x100, 0xDDEAF3FF, 0)
            data = ctypes.c_int * 3
            payload = data(19, ctypes.addressof(accent), ctypes.sizeof(accent))
            ctypes.windll.user32.SetWindowCompositionAttribute(hwnd, ctypes.byref(payload))
        except Exception:
            pass

    def hide_from_taskbar(self) -> None:
        if not hasattr(ctypes, "windll"):
            return
        try:
            self.root.update_idletasks()
            hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id())
            get_window_long = ctypes.windll.user32.GetWindowLongPtrW
            set_window_long = ctypes.windll.user32.SetWindowLongPtrW
            ex_style = get_window_long(hwnd, -20)
            ws_ex_appwindow = 0x00040000
            ws_ex_toolwindow = 0x00000080
            set_window_long(hwnd, -20, (ex_style & ~ws_ex_appwindow) | ws_ex_toolwindow)
            self.root.withdraw()
            self.root.after(10, self.root.deiconify)
        except Exception:
            pass

    def build_ui(self) -> None:
        for child in self.root.winfo_children():
            child.destroy()
        self.button_commands = []
        if self.compact:
            self.root.geometry(self.compact_geometry)
            self.draw_compact_ui()
        else:
            self.root.geometry(self.normal_geometry)
            self.draw_normal_ui()

    def glass_button(self, canvas: Canvas, x: int, y: int, w: int, h: int, text: str, tag: str, command, fill: str, fg: str) -> None:
        rounded_rect(canvas, x + 1, y + 2, x + w + 1, y + h + 2, h // 2, fill="#c7d2fe", outline="", stipple="gray50", tags=tag)
        rounded_rect(canvas, x, y, x + w, y + h, h // 2, fill=fill, outline="#ffffff", width=1, tags=tag)
        canvas.create_text(x + w / 2, y + h / 2, text=text, fill=fg, font=("Microsoft YaHei UI", 9, "bold"), tags=tag)
        self.button_commands.append(CanvasButton(canvas, tag, command))

    def draw_normal_ui(self) -> None:
        canvas = Canvas(self.root, width=390, height=224, bg="#eef6ff", highlightthickness=0)
        self.canvas = canvas
        canvas.pack(fill=BOTH, expand=True)
        draw_vertical_gradient(canvas, 390, 224, "#f7fbff", "#dbeafe")
        rounded_rect(canvas, 12, 14, 378, 214, 34, fill="#ffffff", outline="#ffffff", width=2)
        rounded_rect(canvas, 18, 20, 372, 208, 30, fill="#eef7ff", outline="#d9e8ff", width=1)
        canvas.create_oval(245, -36, 424, 132, fill="#bfdbfe", outline="", stipple="gray50")
        canvas.create_oval(-46, 102, 128, 276, fill="#fbcfe8", outline="", stipple="gray50")
        canvas.create_line(34, 42, 206, 42, fill="#ffffff", width=2)
        self.state_dot = canvas.create_oval(32, 33, 42, 43, fill="#22c55e", outline="#ffffff", width=1)
        canvas.create_text(52, 38, anchor="w", text="Break Guard", fill="#0f172a", font=("Segoe UI Variable", 15, "bold"))
        canvas.create_text(52, 60, anchor="w", text="学习后点一下，十分钟后把你拉回来", fill="#64748b", font=("Microsoft YaHei UI", 9))
        self.timer_var = canvas.create_text(195, 101, text="10:00", fill="#0b1220", font=("Segoe UI Variable Display", 39, "bold"))
        self.subtitle_label = canvas.create_text(195, 135, text="准备开始下一次休息", fill="#475569", font=("Microsoft YaHei UI", 10, "bold"))
        self.glass_button(canvas, 30, 156, 86, 34, "学习结束", "btn_start", self.start_break, "#dbeafe", "#1d4ed8")
        self.glass_button(canvas, 122, 156, 86, 34, "我回来了", "btn_back", self.cancel_break, "#dcfce7", "#15803d")
        self.glass_button(canvas, 214, 156, 52, 34, "午饭", "btn_lunch", lambda: self.meal("lunch"), "#fff7ed", "#c2410c")
        self.glass_button(canvas, 272, 156, 52, 34, "晚饭", "btn_dinner", lambda: self.meal("dinner"), "#f5f3ff", "#6d28d9")
        self.glass_button(canvas, 330, 156, 32, 34, "–", "btn_min", self.minimize, "#f8fafc", "#475569")
        self.status_label = canvas.create_text(195, 202, text="网站同步待命", fill="#64748b", font=("Microsoft YaHei UI", 8))

    def draw_compact_ui(self) -> None:
        canvas = Canvas(self.root, width=116, height=54, bg="#eef6ff", highlightthickness=0)
        self.canvas = canvas
        canvas.pack(fill=BOTH, expand=True)
        draw_vertical_gradient(canvas, 116, 54, "#ffffff", "#dbeafe")
        rounded_rect(canvas, 3, 4, 113, 50, 23, fill="#f8fbff", outline="#ffffff", width=2, tags="expand")
        self.state_dot = canvas.create_oval(14, 22, 24, 32, fill="#22c55e", outline="#ffffff", width=1, tags="expand")
        self.timer_var = canvas.create_text(65, 27, text="10:00", fill="#0f172a", font=("Segoe UI Variable", 15, "bold"), tags="expand")
        self.subtitle_label = None
        self.status_label = None
        CanvasButton(canvas, "expand", self.restore)

    def start_drag(self, event) -> None:
        self.drag_offset = (event.x, event.y)

    def drag(self, event) -> None:
        x = self.root.winfo_pointerx() - self.drag_offset[0]
        y = self.root.winfo_pointery() - self.drag_offset[1]
        self.root.geometry(f"+{x}+{y}")

    def set_status(self, text: str) -> None:
        def apply() -> None:
            if self.canvas is not None and self.status_label is not None:
                self.canvas.itemconfigure(self.status_label, text=text)
        self.root.after(0, apply)

    def set_timer(self, text: str, subtitle: str) -> None:
        if self.canvas is not None and self.timer_var is not None:
            self.canvas.itemconfigure(self.timer_var, text=text)
        if self.canvas is not None and self.subtitle_label is not None:
            self.canvas.itemconfigure(self.subtitle_label, text=subtitle)

    def set_active_tone(self, tone: str) -> None:
        if self.canvas is None or self.state_dot is None:
            return
        color = {
            "idle": "#22c55e",
            "running": "#3b82f6",
            "warning": "#ef4444",
            "meal": "#f97316",
        }.get(tone, "#22c55e")
        self.canvas.itemconfigure(self.state_dot, fill=color)

    def start_break(self) -> None:
        self.break_started_at = time.time()
        self.break_started_iso = utc_now()
        self.break_running = True
        self.warning_sent = False
        self.unfocused_recorded = False
        self.set_active_tone("running")
        self.set_status("休息开始，保持 10 分钟")
        self.client.post_event("break_started", startedAt=self.break_started_iso, note="学习结束后手动开始休息")

    def cancel_break(self) -> None:
        if not self.break_running:
            self.set_status("已在学习状态")
            self.hide_fullscreen()
            return
        elapsed = int(time.time() - (self.break_started_at or time.time()))
        overdue = max(0, elapsed - self.config.break_minutes * 60)
        self.break_running = False
        self.hide_fullscreen()
        self.set_timer(fmt_seconds(self.config.break_minutes * 60), "准备开始下一次休息")
        self.set_active_tone("idle")
        self.set_status("欢迎回来，已记录休息结束")
        self.client.post_event(
            "break_completed",
            startedAt=self.break_started_iso,
            endedAt=utc_now(),
            overdueSeconds=overdue,
            note="用户点击我回来了",
        )

    def meal(self, kind: str) -> None:
        label = "中午吃饭" if kind == "lunch" else "晚上吃饭"
        self.set_active_tone("meal")
        self.set_status(f"已记录：{label}")
        self.client.post_event(kind, endedAt=utc_now(), note=label)
        self.root.after(3000, lambda: self.set_active_tone("running" if self.break_running else "idle"))

    def minimize(self) -> None:
        self.compact = True
        self.build_ui()

    def restore(self) -> None:
        self.compact = False
        self.build_ui()
        if self.break_running and self.break_started_at:
            elapsed = int(time.time() - self.break_started_at)
            remaining = self.config.break_minutes * 60 - elapsed
            if remaining > 0:
                self.set_timer(fmt_seconds(remaining), "休息中，时间到会提醒你")
                self.set_active_tone("running")
            else:
                self.set_timer(f"+{fmt_seconds(abs(remaining))}", "休息已结束，请回来")
                self.set_active_tone("warning")

    def show_fullscreen(self, overtime: int) -> None:
        if self.fullscreen and self.fullscreen.winfo_exists():
            return
        window = Toplevel(self.root)
        self.fullscreen = window
        window.attributes("-fullscreen", True)
        window.attributes("-topmost", True)
        window.configure(bg="#ef4444")
        Label(window, text="休息结束", bg="#ef4444", fg="white", font=("Microsoft YaHei UI", 54, "bold")).pack(side=TOP, pady=(160, 20))
        Label(window, text=f"已经超时 {fmt_seconds(overtime)}，现在回到学习。", bg="#ef4444", fg="#fee2e2", font=("Microsoft YaHei UI", 22, "bold")).pack(side=TOP)
        GlassButton(window, "我回来了", self.cancel_break, bg="#ffffff", fg="#991b1b", padx=34, pady=18).pack(side=BOTTOM, pady=120)

    def hide_fullscreen(self) -> None:
        if self.fullscreen and self.fullscreen.winfo_exists():
            self.fullscreen.destroy()
        self.fullscreen = None

    def tick(self) -> None:
        if self.break_running and self.break_started_at:
            elapsed = int(time.time() - self.break_started_at)
            remaining = self.config.break_minutes * 60 - elapsed
            if remaining > 0:
                self.set_timer(fmt_seconds(remaining), "休息中，时间到会提醒你")
            else:
                overtime = abs(remaining)
                self.set_timer(f"+{fmt_seconds(overtime)}", "休息已结束，请回来")
                self.set_active_tone("warning")
                self.show_fullscreen(overtime)
                if overtime >= self.config.notify_after_seconds and not self.warning_sent:
                    self.warning_sent = True
                    self.set_status("已通过网站通知提醒")
                    self.client.post_event(
                        "break_timeout_warning",
                        startedAt=self.break_started_iso,
                        overdueSeconds=overtime,
                        note="休息结束 1 分钟后仍未取消",
                    )
                if overtime >= self.config.unfocused_after_seconds and not self.unfocused_recorded:
                    self.unfocused_recorded = True
                    self.set_status("已记录一次不专注")
                    self.client.post_event(
                        "unfocused",
                        startedAt=self.break_started_iso,
                        overdueSeconds=overtime,
                        note="休息结束 5 分钟后仍未取消",
                    )
        self.root.after(1000, self.tick)

    def run(self) -> None:
        self.root.mainloop()


def main() -> None:
    try:
        BreakGuardApp().run()
    except Exception as exc:
        messagebox.showerror("休息守护启动失败", str(exc))


if __name__ == "__main__":
    main()
