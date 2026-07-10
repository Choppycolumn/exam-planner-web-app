from __future__ import annotations

import ctypes
import queue
import re
import sys
import time
from tkinter import BOTH, Canvas, Tk, Toplevel, messagebox

from breakguard_config import Config
from breakguard_instance import SingleInstance
from breakguard_logging import log_error
from breakguard_runtime import DATABASE_FILE, ICON_FILE
from breakguard_state import BreakStateMachine, fmt_seconds, utc_iso
from breakguard_storage import BreakGuardStore
from breakguard_sync import SyncWorker
from breakguard_tray import WindowsTrayIcon
from liquid_style import LIQUID, LiquidPainter, draw_vertical_gradient, rounded_rect

IS_WINDOWS = sys.platform.startswith("win") and hasattr(ctypes, "windll")


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


class BreakGuardApp:
    def __init__(self, instance: SingleInstance, tray_actions: "queue.Queue[str]"):
        self.instance = instance
        self.tray_actions = tray_actions
        self.config = Config.load()
        self.store = BreakGuardStore(DATABASE_FILE)
        self.machine = BreakStateMachine(self.store, self.config.break_minutes * 60, self.config.notify_after_seconds, self.config.unfocused_after_seconds)
        self.ui_messages: queue.Queue[str] = queue.Queue()
        self.client = SyncWorker(self.config, self.store, self.ui_messages)
        self.client.start()

        self.root = Tk()
        self.root.title("休息守护")
        self.width, self.height = 428, 424
        self.root.geometry(geometry_with_size(self.config.window_geometry, self.width, self.height))
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", self.config.always_on_top)
        self.root.attributes("-alpha", min(0.995, max(0.985, self.config.opacity)))
        self.root.configure(bg=LIQUID.bg_bottom)
        self.root.protocol("WM_DELETE_WINDOW", self.hide_to_tray)
        self.root.bind("<ButtonPress-1>", self.start_drag)
        self.root.bind("<B1-Motion>", self.drag)
        self.root.bind("<ButtonRelease-1>", self.stop_drag)

        self.canvas: Canvas | None = None
        self.timer_item = self.subtitle_item = self.status_item = self.state_dot = None
        self.button_commands = []
        self.buttons: dict[str, CanvasButton] = {}
        self.drag_offset = (0, 0)
        self.dragging = False
        self.hidden_to_tray = False
        self.exiting = False
        self.fullscreen: Toplevel | None = None
        self.fullscreen_canvas: Canvas | None = None
        self.fullscreen_timer_item = None
        self.last_fullscreen_raise = 0.0

        self.enable_acrylic()
        self.build_ui()
        self.tray = WindowsTrayIcon(ICON_FILE, self.tray_actions)
        if self.tray.wait_until_ready():
            self.hide_from_taskbar()
        else:
            self.set_status("托盘不可用，窗口不会被隐藏")
        self.refresh_view_state()
        self.poll_queues()
        self.tick()

    def enable_acrylic(self) -> None:
        if not IS_WINDOWS:
            return
        try:
            self.root.update_idletasks()
            hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id()) or self.root.winfo_id()

            corner = ctypes.c_int(2)
            backdrop = ctypes.c_int(2)
            dark = ctypes.c_int(1 if LIQUID.bg_top.startswith("#0") else 0)
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 33, ctypes.byref(corner), ctypes.sizeof(corner))
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 38, ctypes.byref(backdrop), ctypes.sizeof(backdrop))
            ctypes.windll.dwmapi.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(dark), ctypes.sizeof(dark))
            region = ctypes.windll.gdi32.CreateRoundRectRgn(0, 0, self.width + 1, self.height + 1, 34, 34)
            ctypes.windll.user32.SetWindowRgn(hwnd, region, True)
        except Exception as exc:
            log_error("acrylic enable failed", exc)

    def hide_from_taskbar(self) -> None:
        if not IS_WINDOWS:
            return
        try:
            self.root.update_idletasks()
            hwnd = ctypes.windll.user32.GetParent(self.root.winfo_id())
            get_long, set_long = ctypes.windll.user32.GetWindowLongPtrW, ctypes.windll.user32.SetWindowLongPtrW
            style = get_long(hwnd, -20)
            set_long(hwnd, -20, (style & ~0x00040000) | 0x00000080)
            self.root.withdraw()
            self.root.after(10, self.root.deiconify)
        except Exception as exc:
            log_error("taskbar style update failed", exc)

    def build_ui(self) -> None:
        for child in self.root.winfo_children():
            child.destroy()
        self.button_commands = []
        self.buttons = {}
        canvas = Canvas(self.root, width=self.width, height=self.height, bg=LIQUID.bg_bottom, highlightthickness=0)
        self.canvas = canvas
        canvas.pack(fill=BOTH, expand=True)
        painter = LiquidPainter(canvas)
        painter.background(self.width, self.height)
        painter.glass_panel(8, 8, self.width - 8, self.height - 8)
        self.state_dot = painter.status_dot(29, 31, LIQUID.success)
        canvas.create_text(50, 37, anchor="w", text="Break Guard", fill=LIQUID.text_primary, font=LIQUID.font_title)
        canvas.create_text(50, 57, anchor="w", text="专注节奏守护", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8, "bold"))
        close_visual = painter.icon_button(374, 22, 32, "×", "btn_close")
        close_visual["label"] = "btn_close__label"
        close_button = CanvasButton(canvas, "btn_close", self.hide_to_tray, close_visual)
        self.button_commands.append(close_button)
        self.buttons["btn_close"] = close_button
        canvas.create_text(28, 84, anchor="w", text="学习结束后开始休息，时间到就把你拉回来", fill=LIQUID.text_secondary, font=LIQUID.font_subtitle)
        painter.timer_well(28, 106, 400, 230)
        self.timer_item = canvas.create_text(214, 158, text=fmt_seconds(self.config.break_minutes * 60), fill=LIQUID.text_primary, font=LIQUID.font_timer)
        self.subtitle_item = canvas.create_text(214, 207, text="准备开始下一次休息", fill=LIQUID.text_secondary, font=LIQUID.font_status)
        self.add_button(28, 250, 180, 50, "开始休息", "btn_start", self.start_break, LIQUID.accent, "#ffffff", primary=True)
        self.add_button(220, 250, 180, 50, "结束休息", "btn_back", self.cancel_break, LIQUID.control_bg, LIQUID.accent)
        canvas.create_text(29, 325, anchor="w", text="快速记录", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8, "bold"))
        self.add_button(28, 340, 116, 38, "午饭", "btn_lunch", lambda: self.meal("lunch"), LIQUID.control_bg, LIQUID.text_secondary)
        self.add_button(156, 340, 116, 38, "晚饭", "btn_dinner", lambda: self.meal("dinner"), LIQUID.control_bg, LIQUID.text_secondary)
        self.add_button(284, 340, 116, 38, "收起", "btn_min", self.hide_to_tray, LIQUID.control_bg, LIQUID.text_secondary)
        canvas.create_line(38, 393, 390, 393, fill=LIQUID.panel_border_soft, width=1)
        self.status_item = canvas.create_text(214, 405, text="网站同步待命 · 托盘常驻 · 关闭即隐藏", fill=LIQUID.text_tertiary, font=LIQUID.font_footer)

    def add_button(self, x, y, width, height, text, tag, command, fill, foreground, primary=False) -> None:
        visual = LiquidPainter(self.canvas).button(x, y, width, height, text, tag, fill, foreground, primary=primary)
        visual["label"] = f"{tag}__label"
        button = CanvasButton(self.canvas, tag, command, visual)
        self.button_commands.append(button)
        self.buttons[tag] = button

    def start_drag(self, event) -> None:
        if event.widget is self.canvas and event.y < 96 and event.x < 365:
            self.dragging = True
            self.drag_offset = (event.x_root - self.root.winfo_x(), event.y_root - self.root.winfo_y())

    def drag(self, event) -> None:
        if self.dragging:
            self.root.geometry(f"+{event.x_root - self.drag_offset[0]}+{event.y_root - self.drag_offset[1]}")

    def stop_drag(self, _event) -> None:
        if not self.dragging:
            return
        self.dragging = False
        clamp_window_to_screen(self.root, self.width, self.height)
        self.config.window_geometry = f"{self.width}x{self.height}+{self.root.winfo_x()}+{self.root.winfo_y()}"
        self.config.save()

    def set_status(self, text: str) -> None:
        if self.canvas is not None and self.status_item is not None:
            self.canvas.itemconfigure(self.status_item, text=text)

    def set_timer(self, text: str, subtitle: str) -> None:
        if self.canvas is not None and self.timer_item is not None:
            self.canvas.itemconfigure(self.timer_item, text=text)
        if self.canvas is not None and self.subtitle_item is not None:
            self.canvas.itemconfigure(self.subtitle_item, text=subtitle)

    def set_tone(self, tone: str) -> None:
        if self.canvas is not None and self.state_dot is not None:
            color = {"idle": LIQUID.success, "running": LIQUID.accent, "warning": LIQUID.danger, "meal": LIQUID.warning}.get(tone, LIQUID.success)
            self.canvas.itemconfigure(self.state_dot, fill=color)

    def set_action_emphasis(self, running: bool) -> None:
        start = self.buttons.get("btn_start")
        back = self.buttons.get("btn_back")
        if not start or not back:
            return
        if running:
            start.set_palette(LIQUID.control_bg, LIQUID.control_hover, LIQUID.control_pressed, LIQUID.accent)
            back.set_palette(LIQUID.accent, LIQUID.accent_hover, LIQUID.accent_pressed, "#ffffff")
        else:
            start.set_palette(LIQUID.accent, LIQUID.accent_hover, LIQUID.accent_pressed, "#ffffff")
            back.set_palette(LIQUID.control_bg, LIQUID.control_hover, LIQUID.control_pressed, LIQUID.accent)

    def start_break(self) -> None:
        session = self.machine.start()
        self.client.post_event("break_started", f"{session.session_id}_started", startedAt=session.started_iso, note="学习结束后手动开始休息")
        self.set_tone("running")
        self.set_status("休息开始，保持 10 分钟")
        self.refresh_view_state()

    def cancel_break(self) -> None:
        session = self.machine.session
        if not session:
            self.hide_fullscreen()
            self.set_status("已在学习状态")
            return
        overdue = max(0, int(time.time() - session.deadline_at))
        self.client.post_event("break_completed", f"{session.session_id}_completed", startedAt=session.started_iso, endedAt=utc_iso(), overdueSeconds=overdue, note="用户点击我回来了")
        self.machine.complete()
        self.hide_fullscreen()
        self.set_timer(fmt_seconds(self.config.break_minutes * 60), "准备开始下一次休息")
        self.set_tone("idle")
        self.set_status("欢迎回来，已记录休息结束")

    def meal(self, kind: str) -> None:
        label = "中午吃饭" if kind == "lunch" else "晚上吃饭"
        self.client.post_event(kind, endedAt=utc_iso(), note=label)
        self.set_tone("meal")
        self.set_status(f"已记录：{label}")
        self.root.after(3000, lambda: self.set_tone("running" if self.machine.session else "idle"))

    def hide_to_tray(self) -> None:
        if self.exiting:
            return
        if not self.tray.available:
            self.set_status("托盘不可用，已阻止隐藏以免窗口丢失")
            self.root.lift()
            return
        self.hidden_to_tray = True
        self.root.withdraw()

    def show_window(self) -> None:
        self.hidden_to_tray = False
        self.build_ui()
        self.root.deiconify()
        self.root.lift()
        clamp_window_to_screen(self.root, self.width, self.height)
        self.refresh_view_state()

    def toggle_window(self) -> None:
        if self.hidden_to_tray or not self.root.winfo_viewable():
            self.show_window()
        else:
            self.hide_to_tray()

    def reset_window_position(self) -> None:
        self.config.window_geometry = ""
        self.config.save()
        self.root.geometry(default_geometry(self.width, self.height))
        self.show_window()
        self.set_status("窗口位置已重置")

    def show_fullscreen(self, overtime: int) -> None:
        if self.fullscreen and self.fullscreen.winfo_exists():
            if self.fullscreen_timer_item is not None:
                self.fullscreen_canvas.itemconfigure(self.fullscreen_timer_item, text=f"已经超时 {fmt_seconds(overtime)}，现在回到学习。")
            if time.time() - self.last_fullscreen_raise >= 10:
                bring_to_front(self.fullscreen)
                self.last_fullscreen_raise = time.time()
            return
        window = Toplevel(self.root)
        self.fullscreen = window
        window.attributes("-fullscreen", True)
        window.attributes("-topmost", True)
        window.protocol("WM_DELETE_WINDOW", self.cancel_break)
        width, height = window.winfo_screenwidth(), window.winfo_screenheight()
        canvas = Canvas(window, width=width, height=height, bg="#08111f", highlightthickness=0, name="canvas")
        self.fullscreen_canvas = canvas
        canvas.pack(fill=BOTH, expand=True)
        draw_vertical_gradient(canvas, width, height, "#08111f", "#17243a")
        card_w, card_h = min(760, width - 80), 390
        x1, y1 = (width - card_w) // 2, max(120, (height - card_h) // 2)
        x2, y2 = x1 + card_w, y1 + card_h
        rounded_rect(canvas, x1 + 5, y1 + 10, x2 + 5, y2 + 10, 44, fill="#050b14", outline="")
        rounded_rect(canvas, x1, y1, x2, y2, 44, fill="#172237", outline="#64748b", width=1)
        rounded_rect(canvas, x1 + 7, y1 + 7, x2 - 7, y2 - 7, 38, fill="#1d2a40", outline="#334155", width=1)
        rounded_rect(canvas, width / 2 - 92, y1 + 34, width / 2 + 92, y1 + 68, 17, fill="#3f1f2a", outline="#fb7185", width=1)
        canvas.create_text(width / 2, y1 + 51, text="休息计时已结束", fill="#fda4af", font=("Microsoft YaHei UI", 11, "bold"))
        canvas.create_text(width / 2, y1 + 128, text="现在回来", fill="#f8fafc", font=("Microsoft YaHei UI", 52, "bold"))
        self.fullscreen_timer_item = canvas.create_text(width / 2, y1 + 196, text=f"已经超时 {fmt_seconds(overtime)}，现在回到学习。", fill="#e2e8f0", font=("Microsoft YaHei UI", 22, "bold"))
        canvas.create_text(width / 2, y1 + 244, text="超过 5 分钟仍未确认，网站会记录一次不专注。", fill="#94a3b8", font=("Microsoft YaHei UI", 12))
        tag, button_w, button_h = "fullscreen_back", 210, 60
        button_x, button_y = int(width / 2 - button_w / 2), y1 + 292
        rounded_rect(canvas, button_x + 2, button_y + 4, button_x + button_w + 2, button_y + button_h + 4, 30, fill="#050b14", outline="", tags=tag)
        rounded_rect(canvas, button_x, button_y, button_x + button_w, button_y + button_h, 30, fill="#f8fafc", outline="#ffffff", width=1, tags=(tag, f"{tag}__surface"))
        canvas.create_text(width / 2, button_y + button_h / 2, text="结束休息", fill="#111827", font=("Microsoft YaHei UI", 16, "bold"), tags=(tag, f"{tag}__label"))
        self.button_commands.append(CanvasButton(canvas, tag, self.cancel_break, {
            "surface": f"{tag}__surface",
            "label": f"{tag}__label",
            "normal": "#f8fafc",
            "hover": "#e0ecff",
            "pressed": "#cbdcf4",
        }))
        window.bind("<Escape>", lambda _event: self.cancel_break())
        window.after(50, lambda: bring_to_front(window))
        self.last_fullscreen_raise = time.time()

    def hide_fullscreen(self) -> None:
        if self.fullscreen and self.fullscreen.winfo_exists():
            self.fullscreen.destroy()
        self.fullscreen = None
        self.fullscreen_canvas = None
        self.fullscreen_timer_item = None

    def refresh_view_state(self) -> None:
        snapshot = self.machine.snapshot()
        self.set_action_emphasis(bool(snapshot["running"]))
        if not snapshot["running"]:
            self.set_timer(fmt_seconds(self.config.break_minutes * 60), "准备开始下一次休息")
            self.set_tone("idle")
        elif snapshot["remaining"] > 0:
            self.set_timer(fmt_seconds(snapshot["remaining"]), "休息中，时间到会提醒你")
            self.set_tone("running")
        else:
            self.set_timer(f"+{fmt_seconds(snapshot['overtime'])}", "休息已结束，请回来")
            self.set_tone("warning")

    def update_break_state(self) -> None:
        snapshot = self.machine.snapshot()
        if not snapshot["running"]:
            return
        self.refresh_view_state()
        if snapshot["remaining"] > 0:
            return
        self.show_fullscreen(snapshot["overtime"])
        session = self.machine.session
        if snapshot["warning_due"] and session:
            self.client.post_event("break_timeout_warning", f"{session.session_id}_warning", startedAt=session.started_iso, overdueSeconds=snapshot["overtime"], note="休息结束 1 分钟后仍未取消")
            self.machine.mark_warning_sent()
            self.set_status("网站提醒已进入发送队列")
        if snapshot["unfocused_due"] and session:
            self.client.post_event("unfocused", f"{session.session_id}_unfocused", startedAt=session.started_iso, overdueSeconds=snapshot["overtime"], note="休息结束 5 分钟后仍未取消")
            self.machine.mark_unfocused_recorded()
            self.set_status("不专注记录已进入同步队列")

    def tick(self) -> None:
        try:
            self.update_break_state()
        except Exception as exc:
            log_error("timer tick failed", exc)
        if not self.exiting:
            self.root.after(1000, self.tick)

    def poll_queues(self) -> None:
        actions = {"show": self.show_window, "hide": self.hide_to_tray, "toggle": self.toggle_window, "reset": self.reset_window_position, "quit": self.quit_app, "test_fullscreen": lambda: self.show_fullscreen(0)}
        while True:
            try:
                action = self.tray_actions.get_nowait()
            except queue.Empty:
                break
            try:
                actions.get(action, lambda: None)()
            except Exception as exc:
                log_error(f"tray action failed: {action}", exc)
        while True:
            try:
                self.set_status(self.ui_messages.get_nowait())
            except queue.Empty:
                break
        if not self.exiting:
            self.root.after(100, self.poll_queues)

    def quit_app(self) -> None:
        if self.exiting:
            return
        self.exiting = True
        self.hide_fullscreen()
        self.client.close()
        self.tray.remove()
        self.instance.close()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


def main() -> None:
    tray_actions: queue.Queue[str] = queue.Queue()
    instance = SingleInstance(tray_actions)
    if not instance.primary:
        instance.notify_existing()
        instance.close()
        return
    try:
        BreakGuardApp(instance, tray_actions).run()
    except Exception as exc:
        log_error("break guard crashed", exc)
        try:
            messagebox.showerror("休息守护启动失败", "程序启动失败，详细信息已写入本地日志。")
        finally:
            instance.close()
