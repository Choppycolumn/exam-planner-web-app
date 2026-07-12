from __future__ import annotations

from tkinter import BOTH, Canvas, Toplevel

from liquid_style import LIQUID, LiquidPainter, rounded_rect


class ScheduleSettingsDialog:
    def __init__(self, parent, config, on_save):
        self.config = config
        self.on_save = on_save
        self.values = {
            "daily_lessons": config.daily_lessons,
            "lesson_minutes": config.lesson_minutes,
            "break_minutes": config.break_minutes,
            "day_start_minutes": self._clock_minutes(config.day_start),
            "lag_grace_minutes": config.lag_grace_minutes,
        }
        self.value_items = {}
        self.window = Toplevel(parent)
        self.window.title("课表设置")
        self.window.geometry(self._geometry(parent, 404, 474))
        self.window.overrideredirect(True)
        self.window.attributes("-topmost", True)
        self.window.attributes("-alpha", 0.995)
        self.window.configure(bg=LIQUID.bg_bottom)
        self.canvas = Canvas(self.window, width=404, height=474, bg=LIQUID.bg_bottom, highlightthickness=0)
        self.canvas.pack(fill=BOTH, expand=True)
        self.drag_offset = (0, 0)
        self._draw()
        self.window.bind("<Escape>", lambda _event: self.close())
        self.canvas.bind("<ButtonPress-1>", self._start_drag)
        self.canvas.bind("<B1-Motion>", self._drag)

    @staticmethod
    def _clock_minutes(value: str) -> int:
        try:
            hour, minute = (int(part) for part in value.split(":", 1))
            return max(0, min(1439, hour * 60 + minute))
        except (TypeError, ValueError):
            return 480

    @staticmethod
    def _geometry(parent, width: int, height: int) -> str:
        parent.update_idletasks()
        x = max(12, parent.winfo_x() + (parent.winfo_width() - width) // 2)
        y = max(12, parent.winfo_y() + 72)
        return f"{width}x{height}+{x}+{y}"

    def _draw(self) -> None:
        painter = LiquidPainter(self.canvas)
        painter.background(404, 474)
        painter.glass_panel(8, 8, 396, 466)
        self.canvas.create_text(28, 38, anchor="w", text="每日课表", fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 16, "bold"))
        self.canvas.create_text(28, 62, anchor="w", text="按你的学习节奏生成固定课表", fill=LIQUID.text_secondary, font=LIQUID.font_subtitle)
        self._button(350, 24, 30, 30, "×", self.close, "close")
        rows = [
            ("daily_lessons", "每天课程", "节", 1, 12, 1),
            ("lesson_minutes", "单节时长", "分钟", 10, 180, 5),
            ("break_minutes", "课间休息", "分钟", 1, 60, 1),
            ("day_start_minutes", "首节开始", "", 0, 1439, 30),
            ("lag_grace_minutes", "进度宽限", "分钟", 0, 180, 5),
        ]
        for index, row in enumerate(rows):
            self._row(92 + index * 58, *row)
        target_minutes = self.values["daily_lessons"] * self.values["lesson_minutes"]
        hours, minutes = divmod(target_minutes, 60)
        self.target_item = self.canvas.create_text(
            202, 395, text=f"每日目标 {hours} 小时 {minutes} 分钟 · 落后后全屏提醒",
            fill=LIQUID.text_secondary, font=("Microsoft YaHei UI", 9, "bold"),
        )
        self._button(28, 420, 160, 40, "取消", self.close, "cancel")
        self._button(202, 420, 174, 40, "保存课表", self.save, "save", primary=True)

    def _row(self, y, key, label, unit, minimum, maximum, step) -> None:
        rounded_rect(self.canvas, 26, y, 378, y + 48, 18, fill=LIQUID.control_bg, outline=LIQUID.panel_border_soft, width=1)
        self.canvas.create_text(44, y + 24, anchor="w", text=label, fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 10, "bold"))
        self._button(228, y + 9, 30, 30, "−", lambda: self.adjust(key, -step, minimum, maximum), f"{key}_minus")
        value_item = self.canvas.create_text(302, y + 24, text="", fill=LIQUID.accent, font=("Segoe UI Variable Display", 11, "bold"))
        self.value_items[key] = (value_item, unit)
        self._button(342, y + 9, 30, 30, "+", lambda: self.adjust(key, step, minimum, maximum), f"{key}_plus")
        self._refresh_value(key)

    def _button(self, x, y, width, height, text, command, tag, primary=False) -> None:
        visual = LiquidPainter(self.canvas).button(
            x, y, width, height, text, tag,
            LIQUID.accent if primary else LIQUID.control_bg,
            "#ffffff" if primary else LIQUID.text_secondary,
            primary=primary,
        )
        self.canvas.tag_bind(tag, "<ButtonRelease-1>", lambda _event: command())
        self.canvas.tag_bind(tag, "<Enter>", lambda _event: self.canvas.configure(cursor="hand2"))
        self.canvas.tag_bind(tag, "<Leave>", lambda _event: self.canvas.configure(cursor=""))

    def adjust(self, key: str, delta: int, minimum: int, maximum: int) -> None:
        value = self.values[key] + delta
        if key == "day_start_minutes":
            value %= 1440
        else:
            value = max(minimum, min(maximum, value))
        self.values[key] = value
        self._refresh_value(key)
        if key in {"daily_lessons", "lesson_minutes"}:
            target_minutes = self.values["daily_lessons"] * self.values["lesson_minutes"]
            hours, minutes = divmod(target_minutes, 60)
            self.canvas.itemconfigure(self.target_item, text=f"每日目标 {hours} 小时 {minutes} 分钟 · 落后后全屏提醒")

    def _refresh_value(self, key: str) -> None:
        item, unit = self.value_items[key]
        value = self.values[key]
        text = f"{value // 60:02d}:{value % 60:02d}" if key == "day_start_minutes" else f"{value} {unit}".strip()
        self.canvas.itemconfigure(item, text=text)

    def save(self) -> None:
        self.config.daily_lessons = self.values["daily_lessons"]
        self.config.lesson_minutes = self.values["lesson_minutes"]
        self.config.break_minutes = self.values["break_minutes"]
        minutes = self.values["day_start_minutes"]
        self.config.day_start = f"{minutes // 60:02d}:{minutes % 60:02d}"
        self.config.lag_grace_minutes = self.values["lag_grace_minutes"]
        self.config.save()
        self.on_save()
        self.close()

    def close(self) -> None:
        if self.window.winfo_exists():
            self.window.destroy()

    def _start_drag(self, event) -> None:
        if event.y < 82:
            self.drag_offset = (event.x_root - self.window.winfo_x(), event.y_root - self.window.winfo_y())

    def _drag(self, event) -> None:
        if self.drag_offset != (0, 0):
            self.window.geometry(f"+{event.x_root - self.drag_offset[0]}+{event.y_root - self.drag_offset[1]}")
