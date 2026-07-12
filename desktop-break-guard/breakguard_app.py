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
from breakguard_schedule import CoursePlanner
from breakguard_settings import ScheduleSettingsDialog
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
        self.planner = CoursePlanner(
            self.store,
            self.config.daily_lessons,
            self.config.lesson_minutes,
            self.config.break_minutes,
            self.config.day_start,
            self.config.lag_grace_minutes,
            self.config.lag_repeat_minutes,
        )
        self.ui_messages: queue.Queue[str] = queue.Queue()
        self.client = SyncWorker(self.config, self.store, self.ui_messages)
        self.client.start()

        self.root = Tk()
        self.root.title("休息守护")
        self.width = 428
        self.schedule_rows = self.schedule_row_count()
        self.height = self.preferred_height()
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
        self.progress_item = self.target_item = self.primary_label_item = None
        self.button_commands = []
        self.buttons: dict[str, CanvasButton] = {}
        self.drag_offset = (0, 0)
        self.dragging = False
        self.hidden_to_tray = False
        self.exiting = False
        self.fullscreen: Toplevel | None = None
        self.fullscreen_canvas: Canvas | None = None
        self.fullscreen_timer_item = None
        self.fullscreen_kind = ""
        self.settings_dialog = None
        self.last_fullscreen_raise = 0.0

        self.enable_acrylic()
        self.build_ui()
        self.root.update_idletasks()
        clamp_window_to_screen(self.root, self.width, self.height)
        self.root.update_idletasks()
        self.config.window_geometry = f"{self.width}x{self.height}+{self.root.winfo_x()}+{self.root.winfo_y()}"
        self.config.save()
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
        canvas.create_text(50, 57, anchor="w", text="每日课表 · 专注节奏守护", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8, "bold"))
        close_visual = painter.icon_button(374, 22, 32, "×", "btn_close")
        close_visual["label"] = "btn_close__label"
        close_button = CanvasButton(canvas, "btn_close", self.hide_to_tray, close_visual)
        self.button_commands.append(close_button)
        self.buttons["btn_close"] = close_button
        canvas.create_text(28, 87, anchor="w", text="点击开始上课，到时自动进入课间休息", fill=LIQUID.text_secondary, font=LIQUID.font_subtitle)

        rounded_rect(canvas, 28, 106, 400, 186, 20, fill=LIQUID.control_bg, outline=LIQUID.panel_border_soft, width=1)
        canvas.create_text(46, 127, anchor="w", text="今日课表", fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 10, "bold"))
        self.progress_item = canvas.create_text(382, 127, anchor="e", text="0 / 8 节", fill=LIQUID.accent, font=("Segoe UI Variable Display", 11, "bold"))
        rounded_rect(canvas, 46, 149, 382, 159, 5, fill=LIQUID.neutral_soft, outline="")
        self.progress_bar = rounded_rect(canvas, 46, 149, 47, 159, 5, fill=LIQUID.accent, outline="")
        self.target_item = canvas.create_text(46, 174, anchor="w", text="", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8, "bold"))
        canvas.create_text(28, 210, anchor="w", text="课程安排", fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 9, "bold"))
        canvas.create_text(400, 210, anchor="e", text="点击课程格选择当前课程", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8))
        self.draw_schedule()

        vertical_offset = (self.schedule_rows - 2) * 44
        timer_top = 326 + vertical_offset
        painter.timer_well(28, timer_top, 400, timer_top + 104)
        self.timer_item = canvas.create_text(214, timer_top + 41, text="第 1 节", fill=LIQUID.text_primary, font=("Segoe UI Variable Display", 38, "bold"))
        self.subtitle_item = canvas.create_text(214, timer_top + 82, text="准备开始今天的课程", fill=LIQUID.text_secondary, font=LIQUID.font_status)

        action_top = timer_top + 121
        self.add_button(28, action_top, 242, 50, "开始第 1 节课", "btn_primary", self.primary_action, LIQUID.accent, "#ffffff", primary=True)
        self.add_button(282, action_top, 118, 50, "课表设置", "btn_settings", self.open_schedule_settings, LIQUID.control_bg, LIQUID.accent)
        canvas.create_text(29, action_top + 73, anchor="w", text="不计时暂停", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8, "bold"))
        self.add_button(28, action_top + 88, 116, 38, "午饭", "btn_lunch", lambda: self.meal("lunch"), LIQUID.control_bg, LIQUID.text_secondary)
        self.add_button(156, action_top + 88, 116, 38, "晚饭", "btn_dinner", lambda: self.meal("dinner"), LIQUID.control_bg, LIQUID.text_secondary)
        self.add_button(284, action_top + 88, 116, 38, "收起", "btn_min", self.hide_to_tray, LIQUID.control_bg, LIQUID.text_secondary)

        status_top = action_top + 141
        rounded_rect(canvas, 28, status_top, 400, status_top + 28, 14, fill=LIQUID.neutral_soft, outline=LIQUID.panel_border_soft, width=1)
        canvas.create_oval(40, status_top + 10, 48, status_top + 18, fill=LIQUID.success, outline="")
        self.status_item = canvas.create_text(58, status_top + 14, anchor="w", text="网站同步待命 · 托盘常驻 · 关闭即隐藏", fill=LIQUID.text_secondary, font=LIQUID.font_footer, width=328)

    def schedule_row_count(self) -> int:
        return max(1, (max(1, min(12, int(self.config.daily_lessons))) + 3) // 4)

    def preferred_height(self) -> int:
        return 640 + (self.schedule_rows - 2) * 44

    def draw_schedule(self) -> None:
        if self.canvas is None:
            return
        self.canvas.delete("schedule_dynamic")
        for slot in self.planner.schedule_slots()[:12]:
            index = slot["lesson_number"] - 1
            row, column = divmod(index, 4)
            x, y = 28 + column * 93, 226 + row * 44
            colors = {
                "done": (LIQUID.success_soft, LIQUID.success_text, "✓"),
                "active": (LIQUID.accent_soft, LIQUID.accent, "●"),
                "pending": (LIQUID.control_bg, LIQUID.text_secondary, str(slot["lesson_number"])),
            }
            fill, foreground, marker = colors[slot["status"]]
            if slot["selected"] and slot["status"] != "active":
                fill, foreground, marker = LIQUID.accent_soft, LIQUID.accent, "▶"
            lesson_tag = f"lesson_slot_{slot['lesson_number']}"
            tags = ("schedule_dynamic", lesson_tag)
            project = self.project_for_lesson(slot["lesson_number"])
            project_name = (project.get("name") or "待分配")[:5]
            rounded_rect(
                self.canvas, x, y, x + 82, y + 38, 13,
                fill=fill,
                outline=LIQUID.accent if slot["selected"] else LIQUID.panel_border_soft,
                width=2 if slot["selected"] else 1,
                tags=tags,
            )
            self.canvas.create_text(x + 14, y + 19, text=marker, fill=foreground, font=("Segoe UI Variable Display", 9, "bold"), tags=tags)
            self.canvas.create_text(x + 50, y + 13, text=project_name, fill=foreground, font=("Microsoft YaHei UI", 8, "bold"), tags=tags)
            self.canvas.create_text(x + 50, y + 27, text=f"{slot['lesson_number']} · {slot['start_text']}", fill=LIQUID.text_tertiary, font=("Segoe UI Variable Display", 7), tags=tags)
            self.canvas.tag_bind(lesson_tag, "<ButtonRelease-1>", lambda _event, number=slot["lesson_number"]: self.select_current_lesson(number))
            self.canvas.tag_bind(lesson_tag, "<Enter>", lambda _event: self.canvas.configure(cursor="hand2"))
            self.canvas.tag_bind(lesson_tag, "<Leave>", lambda _event: self.canvas.configure(cursor=""))

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
        primary = self.buttons.get("btn_primary")
        if not primary:
            return
        primary.set_palette(LIQUID.accent, LIQUID.accent_hover, LIQUID.accent_pressed, "#ffffff")

    def update_progress(self) -> dict:
        summary = self.planner.summary()
        if self.canvas is None:
            return summary
        self.canvas.itemconfigure(self.progress_item, text=f"{summary['completed_lessons']} / {summary['daily_lessons']} 节")
        total_minutes = summary["target_seconds"] // 60
        hours, minutes = divmod(total_minutes, 60)
        study_minutes = summary["study_seconds"] // 60
        pause_text = f" · {summary['paused_label']}中" if summary["paused_label"] else ""
        self.canvas.itemconfigure(self.target_item, text=f"目标 {hours}小时{minutes:02d}分 · 已完成 {study_minutes} 分钟{pause_text}")
        self.canvas.delete("progress_fill")
        width = max(1, int(336 * summary["progress"]))
        self.progress_bar = rounded_rect(self.canvas, 46, 149, 46 + width, 159, 5, fill=LIQUID.accent, outline="", tags="progress_fill")
        self.draw_schedule()
        return summary

    def project_for_lesson(self, lesson_number: int) -> dict:
        projects = [project for project in self.config.available_projects if int(project.get("id", 0)) > 0]
        if not projects:
            return {"id": 0, "name": "待分配", "color": "#64748b"}
        index = max(0, int(lesson_number) - 1)
        project_id = self.config.lesson_projects[index] if index < len(self.config.lesson_projects) else projects[index % len(projects)]["id"]
        return next((project for project in projects if int(project["id"]) == int(project_id)), projects[index % len(projects)])

    def normalize_lesson_projects(self) -> None:
        projects = self.config.available_projects
        if not projects:
            self.config.lesson_projects = self.config.lesson_projects[:self.config.daily_lessons]
            return
        valid_ids = {int(project["id"]) for project in projects}
        assignments = []
        for index in range(self.config.daily_lessons):
            current = self.config.lesson_projects[index] if index < len(self.config.lesson_projects) else 0
            assignments.append(int(current) if int(current or 0) in valid_ids else int(projects[index % len(projects)]["id"]))
        self.config.lesson_projects = assignments

    def cycle_lesson_project(self, lesson_number: int) -> None:
        projects = self.config.available_projects
        if not projects:
            self.set_status("正在等待从网站拉取学习项目")
            self.client.last_config_pull = 0.0
            self.client.wake_event.set()
            return
        self.normalize_lesson_projects()
        index = lesson_number - 1
        current_id = self.config.lesson_projects[index]
        current_index = next((position for position, item in enumerate(projects) if int(item["id"]) == int(current_id)), -1)
        selected = projects[(current_index + 1) % len(projects)]
        self.config.lesson_projects[index] = int(selected["id"])
        self.config.save()
        self.sync_schedule_config()
        self.set_status(f"第 {lesson_number} 节已设为：{selected['name']}")
        self.draw_schedule()

    def select_current_lesson(self, lesson_number: int) -> None:
        if self.planner.session:
            self.set_status("课程进行中，结束后再切换当前课程")
            return
        selected = self.planner.select_lesson(lesson_number)
        project = self.project_for_lesson(selected)
        self.set_status(f"已选择第 {selected} 节：{project['name']}")
        self.refresh_view_state()

    def schedule_config_payload(self) -> dict:
        self.normalize_lesson_projects()
        return {
            "dailyLessons": self.config.daily_lessons,
            "lessonMinutes": self.config.lesson_minutes,
            "breakMinutes": self.config.break_minutes,
            "dayStart": self.config.day_start,
            "lagGraceMinutes": self.config.lag_grace_minutes,
            "lagRepeatMinutes": self.config.lag_repeat_minutes,
            "lessonProjects": self.config.lesson_projects,
        }

    def sync_schedule_config(self) -> None:
        payload = self.schedule_config_payload()
        event_id = f"schedule_config_{int(time.time() * 1000)}"
        self.client.post_event("schedule_config_updated", event_id, note="桌面端更新每日课表", payload=payload)

    def apply_remote_schedule(self, message: dict) -> None:
        config = message.get("config") or {}
        projects = message.get("projects") or []
        self.config.daily_lessons = max(1, min(12, int(config.get("dailyLessons", self.config.daily_lessons))))
        self.config.lesson_minutes = max(10, min(180, int(config.get("lessonMinutes", self.config.lesson_minutes))))
        self.config.break_minutes = max(1, min(60, int(config.get("breakMinutes", self.config.break_minutes))))
        self.config.day_start = str(config.get("dayStart", self.config.day_start))
        self.config.lag_grace_minutes = max(0, min(180, int(config.get("lagGraceMinutes", self.config.lag_grace_minutes))))
        self.config.lag_repeat_minutes = max(5, min(180, int(config.get("lagRepeatMinutes", self.config.lag_repeat_minutes))))
        self.config.available_projects = [
            {"id": int(item["id"]), "name": str(item["name"]), "color": str(item.get("color", "#2563eb"))}
            for item in projects if isinstance(item, dict) and item.get("id") and item.get("name")
        ]
        self.config.lesson_projects = [int(value) for value in config.get("lessonProjects", [])][:12]
        self.normalize_lesson_projects()
        self.config.save()
        self.on_schedule_settings_saved(sync=False)
        self.set_status("已从网站同步每日课表和学习项目")

    def primary_action(self) -> None:
        if self.planner.session:
            self.finish_course(auto=False)
        elif self.machine.session:
            self.cancel_break()
        else:
            self.start_course()

    def start_course(self) -> None:
        if self.machine.session:
            self.set_status("请先结束当前休息")
            return
        next_lesson = self.planner.summary()["next_lesson"]
        project = self.project_for_lesson(next_lesson)
        session = self.planner.start_course(
            project_id=project["id"],
            project_name=project["name"],
            lesson_number=next_lesson,
        )
        self.hide_fullscreen()
        self.client.post_event(
            "class_started",
            f"{session.session_id}_class_started",
            startedAt=session.started_iso,
            note=f"开始第 {session.lesson_number} 节课：{session.project_name}",
            payload={
                "lessonNumber": session.lesson_number,
                "dailyLessons": self.config.daily_lessons,
                "projectId": session.project_id,
                "projectName": session.project_name,
                "lessonDate": session.lesson_date,
            },
        )
        self.set_status(f"第 {session.lesson_number} 节 {session.project_name} 开始，专注 {self.config.lesson_minutes} 分钟")
        self.refresh_view_state()

    def finish_course(self, auto: bool = False) -> None:
        session = self.planner.session
        if not session:
            return
        completed, duration = self.planner.complete_course()
        self.client.post_event(
            "class_completed",
            f"{completed.session_id}_class_completed",
            startedAt=completed.started_iso,
            endedAt=utc_iso(),
            note=f"第 {completed.lesson_number} 节课{'到时自动' if auto else '手动'}结束",
            payload={
                "lessonNumber": completed.lesson_number,
                "durationSeconds": duration,
                "dailyLessons": self.config.daily_lessons,
                "projectId": completed.project_id,
                "projectName": completed.project_name,
                "lessonDate": completed.lesson_date,
            },
        )
        break_session = self.machine.start()
        self.client.post_event(
            "break_started",
            f"{break_session.session_id}_started",
            startedAt=break_session.started_iso,
            note=f"第 {completed.lesson_number} 节课结束后自动休息",
        )
        self.set_status(f"第 {completed.lesson_number} 节完成，自动休息 {self.config.break_minutes} 分钟")
        self.refresh_view_state()

    def open_schedule_settings(self) -> None:
        if self.settings_dialog and self.settings_dialog.window.winfo_exists():
            bring_to_front(self.settings_dialog.window)
            return
        self.settings_dialog = ScheduleSettingsDialog(self.root, self.config, self.on_schedule_settings_saved)

    def on_schedule_settings_saved(self, sync: bool = True) -> None:
        self.machine.break_seconds = self.config.break_minutes * 60
        self.planner.configure(
            self.config.daily_lessons,
            self.config.lesson_minutes,
            self.config.break_minutes,
            self.config.day_start,
            self.config.lag_grace_minutes,
            self.config.lag_repeat_minutes,
        )
        next_rows = self.schedule_row_count()
        if next_rows != self.schedule_rows:
            self.schedule_rows = next_rows
            self.height = self.preferred_height()
            x, y = self.root.winfo_x(), self.root.winfo_y()
            self.root.geometry(f"{self.width}x{self.height}+{x}+{y}")
            self.build_ui()
            self.root.update_idletasks()
            clamp_window_to_screen(self.root, self.width, self.height)
            self.config.window_geometry = f"{self.width}x{self.height}+{self.root.winfo_x()}+{self.root.winfo_y()}"
            self.config.save()
        if sync:
            self.sync_schedule_config()
        self.set_status("每日课表已更新")
        self.refresh_view_state()

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
        summary = self.planner.summary()
        self.set_status(f"休息结束，准备第 {summary['next_lesson']} 节课")
        self.refresh_view_state()

    def meal(self, kind: str) -> None:
        if self.planner.session or self.machine.session:
            self.set_status("请先结束当前课程或休息，再进入吃饭暂停")
            return
        label = "中午吃饭" if kind == "lunch" else "晚上吃饭"
        pause_label = "午饭" if kind == "lunch" else "晚饭"
        self.planner.set_pause(pause_label)
        self.client.post_event(kind, endedAt=utc_iso(), note=label)
        self.set_tone("meal")
        self.set_status(f"{label}暂停中；开始下一节课时自动恢复进度提醒")
        self.refresh_view_state()

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
            if self.fullscreen_kind != "break":
                self.hide_fullscreen()
            else:
                if self.fullscreen_timer_item is not None:
                    self.fullscreen_canvas.itemconfigure(self.fullscreen_timer_item, text=f"已经超时 {fmt_seconds(overtime)}，现在回到学习。")
                if time.time() - self.last_fullscreen_raise >= 10:
                    bring_to_front(self.fullscreen)
                    self.last_fullscreen_raise = time.time()
                return
        window = Toplevel(self.root)
        self.fullscreen = window
        self.fullscreen_kind = "break"
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

    def show_progress_warning(self, snapshot: dict) -> None:
        if self.fullscreen and self.fullscreen.winfo_exists():
            if self.fullscreen_kind == "break":
                return
            bring_to_front(self.fullscreen)
            return
        window = Toplevel(self.root)
        self.fullscreen = window
        self.fullscreen_kind = "lag"
        window.attributes("-fullscreen", True)
        window.attributes("-topmost", True)
        window.protocol("WM_DELETE_WINDOW", self.hide_fullscreen)
        width, height = window.winfo_screenwidth(), window.winfo_screenheight()
        canvas = Canvas(window, width=width, height=height, bg="#0b1020", highlightthickness=0)
        self.fullscreen_canvas = canvas
        canvas.pack(fill=BOTH, expand=True)
        draw_vertical_gradient(canvas, width, height, "#0b1020", "#24152f")
        card_w, card_h = min(820, width - 80), 430
        x1, y1 = (width - card_w) // 2, max(100, (height - card_h) // 2)
        x2, y2 = x1 + card_w, y1 + card_h
        rounded_rect(canvas, x1 + 6, y1 + 12, x2 + 6, y2 + 12, 46, fill="#050711", outline="")
        rounded_rect(canvas, x1, y1, x2, y2, 46, fill="#211a32", outline="#a78bfa", width=1)
        rounded_rect(canvas, width / 2 - 100, y1 + 34, width / 2 + 100, y1 + 70, 18, fill="#3a2540", outline="#f59e0b", width=1)
        canvas.create_text(width / 2, y1 + 52, text="课表进度提醒", fill="#fbbf24", font=("Microsoft YaHei UI", 11, "bold"))
        canvas.create_text(width / 2, y1 + 130, text="今天的进度正在落后", fill="#f8fafc", font=("Microsoft YaHei UI", 42, "bold"))
        canvas.create_text(
            width / 2, y1 + 198,
            text=f"计划中的第 {snapshot['lesson_number']} 节应在 {snapshot['scheduled_end']} 前完成\n当前完成 {snapshot['completed_lessons']} / {snapshot['daily_lessons']} 节",
            fill="#ddd6fe", font=("Microsoft YaHei UI", 17, "bold"), justify="center",
        )
        canvas.create_text(width / 2, y1 + 266, text="这不是惩罚，只是把今天重新拉回轨道。", fill="#a5b4fc", font=("Microsoft YaHei UI", 12))
        self._fullscreen_button(canvas, int(width / 2 - 220), y1 + 312, 250, 64, "现在开始本节课", "lag_start", self.start_course, "#f8fafc", "#111827")
        self._fullscreen_button(canvas, int(width / 2 + 50), y1 + 312, 170, 64, "稍后提醒", "lag_later", self.hide_fullscreen, "#332945", "#e9d5ff")
        window.bind("<Escape>", lambda _event: self.hide_fullscreen())
        window.after(50, lambda: bring_to_front(window))
        self.last_fullscreen_raise = time.time()

    def _fullscreen_button(self, canvas, x, y, width, height, text, tag, command, fill, foreground) -> None:
        rounded_rect(canvas, x + 2, y + 4, x + width + 2, y + height + 4, height // 2, fill="#050711", outline="", tags=tag)
        rounded_rect(canvas, x, y, x + width, y + height, height // 2, fill=fill, outline="#ffffff", width=1, tags=(tag, f"{tag}__surface"))
        canvas.create_text(x + width / 2, y + height / 2, text=text, fill=foreground, font=("Microsoft YaHei UI", 14, "bold"), tags=(tag, f"{tag}__label"))
        self.button_commands.append(CanvasButton(canvas, tag, command, {
            "surface": f"{tag}__surface", "label": f"{tag}__label",
            "normal": fill, "hover": LIQUID.control_hover, "pressed": LIQUID.control_pressed,
        }))

    def hide_fullscreen(self) -> None:
        if self.fullscreen and self.fullscreen.winfo_exists():
            self.fullscreen.destroy()
        self.fullscreen = None
        self.fullscreen_canvas = None
        self.fullscreen_timer_item = None
        self.fullscreen_kind = ""

    def refresh_view_state(self) -> None:
        summary = self.update_progress()
        snapshot = self.machine.snapshot()
        self.set_action_emphasis(True)
        if self.planner.session:
            remaining = self.planner.course_remaining()
            self.set_timer(fmt_seconds(remaining), f"第 {self.planner.session.lesson_number} 节课 · 保持专注")
            self.set_tone("running")
            if self.canvas is not None:
                self.canvas.itemconfigure("btn_primary__label", text="结束本节并休息")
        elif snapshot["running"] and snapshot["remaining"] > 0:
            self.set_timer(fmt_seconds(snapshot["remaining"]), "课间休息中，到时会全屏提醒")
            self.set_tone("running")
            if self.canvas is not None:
                self.canvas.itemconfigure("btn_primary__label", text="提前结束休息")
        elif snapshot["running"]:
            self.set_timer(f"+{fmt_seconds(snapshot['overtime'])}", "休息已结束，请回来")
            self.set_tone("warning")
            if self.canvas is not None:
                self.canvas.itemconfigure("btn_primary__label", text="结束休息")
        else:
            next_lesson = summary["next_lesson"]
            label = "开始加练" if summary["completed_lessons"] >= summary["daily_lessons"] else f"开始第 {next_lesson} 节课"
            self.set_timer(f"第 {next_lesson} 节", f"{summary['paused_label']}暂停中" if summary["paused_label"] else "点击后开始课程倒计时")
            self.set_tone("idle")
            if self.canvas is not None:
                self.canvas.itemconfigure("btn_primary__label", text=label)

    def update_course_state(self) -> None:
        if not self.planner.session:
            return
        if self.planner.course_remaining() <= 0:
            self.finish_course(auto=True)
        else:
            self.refresh_view_state()

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

    def update_schedule_lag(self) -> None:
        if self.machine.session or self.planner.session:
            return
        snapshot = self.planner.lag_snapshot()
        if not snapshot.get("due"):
            return
        self.planner.mark_lag_reminded(snapshot["lesson_number"])
        self.client.post_event(
            "schedule_lag",
            f"schedule_lag_{self.planner.summary()['date']}_{snapshot['lesson_number']}_{int(time.time() // (self.config.lag_repeat_minutes * 60))}",
            note=f"每日课表进度落后，第 {snapshot['lesson_number']} 节尚未完成",
            payload={
                "lessonNumber": snapshot["lesson_number"],
                "completedLessons": snapshot["completed_lessons"],
                "dailyLessons": snapshot["daily_lessons"],
                "behindMinutes": snapshot["behind_minutes"],
            },
        )
        self.set_status("课表进度落后，已触发强提醒并同步网站")
        self.show_progress_warning(snapshot)

    def tick(self) -> None:
        try:
            self.update_course_state()
            self.update_break_state()
            self.update_schedule_lag()
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
                message = self.ui_messages.get_nowait()
            except queue.Empty:
                break
            if isinstance(message, dict) and message.get("type") == "schedule_config":
                self.apply_remote_schedule(message)
            else:
                self.set_status(str(message))
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
