from __future__ import annotations

from tkinter import BOTH, Canvas, Toplevel

from breakguard_widgets import CanvasButton, bring_to_front
from liquid_style import LIQUID, LiquidPainter, rounded_rect


def format_duration(seconds: int) -> str:
    minutes = max(0, int(seconds)) // 60
    hours, remainder = divmod(minutes, 60)
    return f"{hours} 小时 {remainder:02d} 分" if hours else f"{remainder} 分钟"


class DailySummaryDialog:
    WIDTH = 420
    HEIGHT = 552

    def __init__(self, parent, summary: dict, on_reopen, on_close=None):
        self.summary = summary
        self.on_reopen = on_reopen
        self.on_close = on_close
        self.buttons: list[CanvasButton] = []
        self.drag_offset = (0, 0)
        self.window = Toplevel(parent)
        self.window.withdraw()
        self.window.title("今日学习总结")
        self.window.geometry(self._geometry(parent))
        self.window.overrideredirect(True)
        self.window.resizable(False, False)
        self.window.attributes("-topmost", True)
        self.window.attributes("-alpha", 0.995)
        self.window.configure(bg=LIQUID.bg_bottom)
        self.window.protocol("WM_DELETE_WINDOW", self.close)
        self.canvas = Canvas(
            self.window,
            width=self.WIDTH,
            height=self.HEIGHT,
            bg=LIQUID.bg_bottom,
            highlightthickness=0,
        )
        self.canvas.pack(fill=BOTH, expand=True)
        self.canvas.bind("<ButtonPress-1>", self._start_drag)
        self.canvas.bind("<B1-Motion>", self._drag)
        self.window.bind("<Escape>", lambda _event: self.close())
        self._draw()
        self.window.update_idletasks()
        self.window.deiconify()
        bring_to_front(self.window)

    def _geometry(self, parent) -> str:
        parent.update_idletasks()
        screen_width = parent.winfo_screenwidth()
        screen_height = parent.winfo_screenheight()
        x = max(12, min(parent.winfo_x() + (parent.winfo_width() - self.WIDTH) // 2, screen_width - self.WIDTH - 12))
        y = max(12, min(parent.winfo_y() + 24, screen_height - self.HEIGHT - 12))
        return f"{self.WIDTH}x{self.HEIGHT}+{x}+{y}"

    def _draw(self) -> None:
        painter = LiquidPainter(self.canvas)
        painter.background(self.WIDTH, self.HEIGHT)
        painter.glass_panel(8, 8, self.WIDTH - 8, self.HEIGHT - 8)
        painter.status_dot(29, 31, LIQUID.success)
        self.canvas.create_text(50, 37, anchor="w", text="今日学习总结", fill=LIQUID.text_primary, font=LIQUID.font_title)
        self.canvas.create_text(50, 59, anchor="w", text=f"{self.summary['date']} · 今天已收工", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8, "bold"))
        self._button(self.WIDTH - 54, 22, 32, 32, "×", self.close, "summary_close")

        self.canvas.create_text(28, 91, anchor="w", text="今天的投入已经保存，进度提醒暂停到明天。", fill=LIQUID.text_secondary, font=LIQUID.font_subtitle)
        self._stat_card(28, 116, 112, "学习时长", format_duration(self.summary["study_seconds"]), LIQUID.accent_soft, LIQUID.accent)
        self._stat_card(154, 116, 112, "完成课次", f"{self.summary['session_count']} 次", LIQUID.success_soft, LIQUID.success_text)
        percent = self.summary["completion_percent"]
        self._stat_card(280, 116, 112, "目标完成", f"{percent:g}%", LIQUID.violet_soft, LIQUID.violet_text)

        self.canvas.create_text(28, 218, anchor="w", text="各科学习投入", fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 10, "bold"))
        self.canvas.create_text(392, 218, anchor="e", text=f"目标 {self.summary['target_minutes']} 分钟", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8))
        rounded_rect(self.canvas, 28, 236, 392, 432, 22, fill=LIQUID.control_bg, outline=LIQUID.panel_border_soft, width=1)
        breakdown = list(self.summary.get("project_breakdown") or [])
        if not breakdown:
            self.canvas.create_text(210, 334, text="今天还没有已完成的学习记录", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 10, "bold"))
        else:
            visible = breakdown[:5]
            for index, item in enumerate(visible):
                y = 264 + index * 32
                self.canvas.create_oval(48, y - 4, 56, y + 4, fill=LIQUID.accent if index == 0 else LIQUID.text_tertiary, outline="")
                self.canvas.create_text(68, y, anchor="w", text=str(item["project_name"])[:16], fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 9, "bold"))
                detail = f"{item['session_count']} 次 · {format_duration(item['study_seconds'])}"
                self.canvas.create_text(370, y, anchor="e", text=detail, fill=LIQUID.text_secondary, font=("Microsoft YaHei UI", 8, "bold"))
            if len(breakdown) > len(visible):
                self.canvas.create_text(68, 414, anchor="w", text=f"另有 {len(breakdown) - len(visible)} 门课程已计入总时长", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8))

        self.canvas.create_text(28, 457, anchor="w", text="想继续也没关系，可以重新开启今天。", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8, "bold"))
        self._button(28, 482, 138, 44, "继续今天", self._reopen, "summary_reopen")
        self._button(178, 482, 214, 44, "完成", self.close, "summary_done", primary=True)

    def _stat_card(self, x: int, y: int, width: int, label: str, value: str, fill: str, foreground: str) -> None:
        rounded_rect(self.canvas, x, y, x + width, y + 76, 20, fill=fill, outline=LIQUID.panel_border_soft, width=1)
        self.canvas.create_text(x + 14, y + 22, anchor="w", text=label, fill=LIQUID.text_secondary, font=("Microsoft YaHei UI", 8, "bold"))
        self.canvas.create_text(x + 14, y + 51, anchor="w", text=value, fill=foreground, font=("Segoe UI Variable Display", 11, "bold"))

    def _button(self, x: int, y: int, width: int, height: int, text: str, command, tag: str, primary: bool = False) -> None:
        painter = LiquidPainter(self.canvas)
        fill = LIQUID.accent if primary else LIQUID.control_bg
        foreground = "#ffffff" if primary else LIQUID.text_secondary
        visual = painter.button(x, y, width, height, text, tag, fill, foreground, primary=primary)
        self.buttons.append(CanvasButton(self.canvas, tag, command, visual))

    def _start_drag(self, event) -> None:
        self.drag_offset = (event.x, event.y)

    def _drag(self, event) -> None:
        x = self.window.winfo_x() + event.x - self.drag_offset[0]
        y = self.window.winfo_y() + event.y - self.drag_offset[1]
        self.window.geometry(f"+{x}+{y}")

    def _reopen(self) -> None:
        self.on_reopen()
        self.close()

    def close(self) -> None:
        if self.window.winfo_exists():
            self.window.destroy()
        if self.on_close:
            callback, self.on_close = self.on_close, None
            callback()
