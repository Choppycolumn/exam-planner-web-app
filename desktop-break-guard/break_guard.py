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
from tkinter import BOTH, BOTTOM, CENTER, LEFT, RIGHT, TOP, Canvas, Label, Tk, Toplevel, messagebox


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


class BreakGuardApp:
    def __init__(self):
        self.config = Config.load()
        self.root = Tk()
        self.root.title("休息守护")
        self.root.geometry("360x238+80+80")
        self.root.minsize(320, 220)
        self.root.attributes("-topmost", self.config.always_on_top)
        self.root.attributes("-alpha", self.config.opacity)
        self.root.configure(bg="#e7eef8")
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
        self.timer_var = None
        self.status_label = None
        self.subtitle_label = None
        self.enable_acrylic()
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

    def build_ui(self) -> None:
        canvas = Canvas(self.root, bg="#e7eef8", highlightthickness=0)
        canvas.pack(fill=BOTH, expand=True)
        rounded_rect(canvas, 10, 10, 350, 228, 28, fill="#f8fbff", outline="#ffffff", width=2)
        rounded_rect(canvas, 18, 18, 342, 220, 24, fill="#eef6ff", outline="#dbeafe", width=1)
        canvas.create_text(32, 34, anchor="nw", text="休息守护", fill="#0f172a", font=("Microsoft YaHei UI", 17, "bold"))
        canvas.create_text(32, 64, anchor="nw", text="学习后点一下，10 分钟后把你拉回来。", fill="#64748b", font=("Microsoft YaHei UI", 9))
        self.timer_var = canvas.create_text(180, 98, text="10:00", fill="#0f172a", font=("Segoe UI", 34, "bold"))
        self.subtitle_label = canvas.create_text(180, 132, text="准备开始下一次休息", fill="#64748b", font=("Microsoft YaHei UI", 10))
        self.status_label = canvas.create_text(180, 206, text="网站同步待命", fill="#64748b", font=("Microsoft YaHei UI", 8))

        button_frame = Canvas(self.root, bg="#eef6ff", highlightthickness=0)
        canvas.create_window(180, 166, window=button_frame, width=306, height=38)
        GlassButton(button_frame, "学习结束", self.start_break, bg="#dbeafe", fg="#1d4ed8").pack(side=LEFT, padx=4)
        GlassButton(button_frame, "我回来了", self.cancel_break, bg="#dcfce7", fg="#15803d").pack(side=LEFT, padx=4)
        GlassButton(button_frame, "午饭", lambda: self.meal("lunch"), bg="#fff7ed", fg="#c2410c", padx=10).pack(side=LEFT, padx=4)
        GlassButton(button_frame, "晚饭", lambda: self.meal("dinner"), bg="#f5f3ff", fg="#6d28d9", padx=10).pack(side=LEFT, padx=4)
        GlassButton(button_frame, "最小化", self.minimize, bg="#f8fafc", fg="#475569", padx=8).pack(side=LEFT, padx=4)

    def start_drag(self, event) -> None:
        self.drag_offset = (event.x, event.y)

    def drag(self, event) -> None:
        x = self.root.winfo_pointerx() - self.drag_offset[0]
        y = self.root.winfo_pointery() - self.drag_offset[1]
        self.root.geometry(f"+{x}+{y}")

    def set_status(self, text: str) -> None:
        def apply() -> None:
            if self.status_label is not None:
                for widget in self.root.winfo_children():
                    if isinstance(widget, Canvas):
                        widget.itemconfigure(self.status_label, text=text)
                        break
        self.root.after(0, apply)

    def set_timer(self, text: str, subtitle: str) -> None:
        for widget in self.root.winfo_children():
            if isinstance(widget, Canvas):
                if self.timer_var is not None:
                    widget.itemconfigure(self.timer_var, text=text)
                if self.subtitle_label is not None:
                    widget.itemconfigure(self.subtitle_label, text=subtitle)
                break

    def start_break(self) -> None:
        self.break_started_at = time.time()
        self.break_started_iso = utc_now()
        self.break_running = True
        self.warning_sent = False
        self.unfocused_recorded = False
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
        self.set_status(f"已记录：{label}")
        self.client.post_event(kind, endedAt=utc_now(), note=label)

    def minimize(self) -> None:
        self.root.iconify()

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
