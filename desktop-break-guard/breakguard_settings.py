from __future__ import annotations

from tkinter import BOTH, Canvas, Toplevel

from liquid_style import LIQUID, LiquidPainter, rounded_rect


class ScheduleSettingsDialog:
    WIDTH = 420
    HEIGHT = 548

    def __init__(self, parent, config, on_save):
        self.config = config
        self.on_save = on_save
        self.values = {
            "daily_target_minutes": config.daily_target_minutes,
            "break_minutes": config.break_minutes,
            "lag_grace_minutes": config.lag_grace_minutes,
        }
        self.value_items = {}
        self.window = Toplevel(parent)
        self.window.withdraw()
        self.window.title("学习设置")
        self.window.geometry(self._geometry(parent, self.WIDTH, self.HEIGHT))
        self.window.overrideredirect(True)
        self.window.attributes("-topmost", True)
        self.window.attributes("-alpha", 0.995)
        self.window.configure(bg=LIQUID.bg_bottom)
        self.canvas = Canvas(
            self.window,
            width=self.WIDTH,
            height=self.HEIGHT,
            bg=LIQUID.bg_bottom,
            highlightthickness=0,
        )
        self.canvas.pack(fill=BOTH, expand=True)
        self.drag_offset = (0, 0)
        self.show_menu()
        self.window.bind("<Escape>", lambda _event: self.close())
        self.canvas.bind("<ButtonPress-1>", self._start_drag)
        self.canvas.bind("<B1-Motion>", self._drag)
        self.window.update_idletasks()
        self.window.deiconify()
        self.window.lift()

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
        y = max(12, parent.winfo_y() + 36)
        return f"{width}x{height}+{x}+{y}"

    def _shell(self, title: str, subtitle: str, back=False) -> None:
        self.canvas.delete("all")
        painter = LiquidPainter(self.canvas)
        painter.background(self.WIDTH, self.HEIGHT)
        painter.glass_panel(8, 8, self.WIDTH - 8, self.HEIGHT - 8)
        title_x = 70 if back else 28
        self.canvas.create_text(title_x, 38, anchor="w", text=title, fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 16, "bold"))
        self.canvas.create_text(28, 70, anchor="w", text=subtitle, fill=LIQUID.text_secondary, font=LIQUID.font_subtitle)
        if back:
            self._button(26, 24, 32, 32, "‹", self.show_menu, "back")
        self._button(366, 24, 30, 30, "×", self.close, "close")

    def show_menu(self) -> None:
        self._shell("学习设置", "设置目标时长，课程自动从网站同步")
        self._menu_card(
            28, 108, "课程列表", "查看从网站同步的可选学习科目", "01", self.show_courses, "menu_courses",
        )
        self._menu_card(
            28, 212, "目标与提醒", "设置每日总时长、课间休息和提醒宽限", "02", self.show_timing, "menu_timing",
        )
        rounded_rect(self.canvas, 28, 332, 392, 410, 22, fill=LIQUID.neutral_soft, outline=LIQUID.panel_border_soft, width=1)
        self.canvas.create_oval(48, 354, 58, 364, fill=LIQUID.success, outline="")
        self.canvas.create_text(72, 359, anchor="w", text="学习设置会自动同步到网站", fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 10, "bold"))
        self.canvas.create_text(48, 386, anchor="w", text="主面板直接选择科目，不再安排固定节次。", fill=LIQUID.text_secondary, font=("Microsoft YaHei UI", 9))
        self._button(28, 478, 364, 42, "完成", self.close, "done", primary=True)

    def _menu_card(self, x, y, title, subtitle, index, command, tag) -> None:
        rounded_rect(self.canvas, x, y, x + 364, y + 84, 22, fill=LIQUID.control_bg, outline=LIQUID.panel_border_soft, width=1, tags=tag)
        rounded_rect(self.canvas, x + 16, y + 18, x + 64, y + 66, 16, fill=LIQUID.accent_soft, outline="", tags=tag)
        self.canvas.create_text(x + 40, y + 42, text=index, fill=LIQUID.accent, font=("Segoe UI Variable Display", 11, "bold"), tags=tag)
        self.canvas.create_text(x + 82, y + 29, anchor="w", text=title, fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 11, "bold"), tags=tag)
        self.canvas.create_text(x + 82, y + 57, anchor="w", text=subtitle, fill=LIQUID.text_secondary, font=("Microsoft YaHei UI", 9), tags=tag)
        self.canvas.create_text(x + 340, y + 42, text="›", fill=LIQUID.text_tertiary, font=("Segoe UI Variable Display", 18), tags=tag)
        self._bind(tag, command)

    def show_courses(self) -> None:
        self._shell("课程列表", "这些科目来自网站中的学习项目", back=True)
        projects = self.config.available_projects[:12]
        for index, project in enumerate(projects):
            row, column = divmod(index, 2)
            x, y = 28 + column * 184, 104 + row * 58
            rounded_rect(self.canvas, x, y, x + 172, y + 48, 16, fill=LIQUID.control_bg, outline=LIQUID.panel_border_soft, width=1)
            self.canvas.create_oval(x + 16, y + 19, x + 26, y + 29, fill=str(project.get("color") or LIQUID.accent), outline="")
            self.canvas.create_text(x + 36, y + 24, anchor="w", text=str(project["name"])[:10], fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 9, "bold"))
        if not projects:
            self.canvas.create_text(28, 118, anchor="w", text="暂未同步到学习项目", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 9))
        self.canvas.create_text(28, 454, anchor="w", text="科目的新增、删除和排序请在网站学习项目中完成。", fill=LIQUID.text_secondary, font=("Microsoft YaHei UI", 9))
        self._button(28, 488, 364, 40, "返回学习设置", self.show_menu, "courses_cancel")

    def show_timing(self) -> None:
        self._shell("目标与提醒", "学习时长由实际开始和结束自动记录", back=True)
        self.value_items = {}
        rows = [
            ("daily_target_minutes", "每日目标", "分钟", 30, 960, 30),
            ("break_minutes", "课间休息", "分钟", 1, 60, 1),
            ("lag_grace_minutes", "提醒宽限", "分钟", 0, 180, 5),
        ]
        for index, row in enumerate(rows):
            self._row(110 + index * 68, *row)
        rounded_rect(self.canvas, 28, 330, 392, 412, 20, fill=LIQUID.neutral_soft, outline=LIQUID.panel_border_soft, width=1)
        self.canvas.create_text(48, 353, anchor="w", text="时长制进度", fill=LIQUID.accent, font=("Microsoft YaHei UI", 9, "bold"))
        self.canvas.create_text(48, 378, anchor="w", text="点击开始时记录起点，手动结束时记录真实课长。", fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 9, "bold"))
        self.canvas.create_text(48, 399, anchor="w", text="进度 = 今日已学时长 ÷ 每日目标时长。", fill=LIQUID.text_secondary, font=("Microsoft YaHei UI", 9))
        self._button(28, 472, 174, 42, "返回", self.show_menu, "timing_cancel")
        self._button(216, 472, 176, 42, "保存时间", self.save_timing, "timing_save", primary=True)

    def _row(self, y, key, label, unit, minimum, maximum, step) -> None:
        rounded_rect(self.canvas, 26, y, 394, y + 50, 18, fill=LIQUID.control_bg, outline=LIQUID.panel_border_soft, width=1)
        self.canvas.create_text(44, y + 25, anchor="w", text=label, fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 10, "bold"))
        self._button(240, y + 10, 30, 30, "−", lambda: self.adjust(key, -step, minimum, maximum), f"{key}_minus")
        value_item = self.canvas.create_text(315, y + 25, text="", fill=LIQUID.accent, font=("Segoe UI Variable Display", 11, "bold"))
        self.value_items[key] = (value_item, unit)
        self._button(358, y + 10, 30, 30, "+", lambda: self.adjust(key, step, minimum, maximum), f"{key}_plus")
        self._refresh_value(key)

    def _button(self, x, y, width, height, text, command, tag, primary=False) -> None:
        LiquidPainter(self.canvas).button(
            x, y, width, height, text, tag,
            LIQUID.accent if primary else LIQUID.control_bg,
            "#ffffff" if primary else LIQUID.text_secondary,
            primary=primary,
        )
        self._bind(tag, command)

    def _bind(self, tag: str, command) -> None:
        self.canvas.tag_bind(tag, "<ButtonRelease-1>", lambda _event: command())
        self.canvas.tag_bind(tag, "<Enter>", lambda _event: self.canvas.configure(cursor="hand2"))
        self.canvas.tag_bind(tag, "<Leave>", lambda _event: self.canvas.configure(cursor=""))

    def adjust(self, key: str, delta: int, minimum: int, maximum: int) -> None:
        value = self.values[key] + delta
        value = max(minimum, min(maximum, value))
        self.values[key] = value
        self._refresh_value(key)

    def _refresh_value(self, key: str) -> None:
        item, unit = self.value_items[key]
        value = self.values[key]
        text = f"{value} {unit}".strip()
        self.canvas.itemconfigure(item, text=text)

    def save_timing(self) -> None:
        self.config.daily_target_minutes = self.values["daily_target_minutes"]
        self.config.break_minutes = self.values["break_minutes"]
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
