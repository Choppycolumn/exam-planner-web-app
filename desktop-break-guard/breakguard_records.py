from __future__ import annotations

from datetime import datetime, timedelta
from tkinter import BOTH, Canvas, Entry, StringVar, Toplevel, messagebox

from breakguard_study import local_date
from breakguard_widgets import CanvasButton, bring_to_front
from liquid_style import LIQUID, LiquidPainter, rounded_rect


def format_session_minutes(seconds: int) -> str:
    minutes = max(0, round(int(seconds) / 60))
    hours, remainder = divmod(minutes, 60)
    return f"{hours} 小时 {remainder:02d} 分" if hours else f"{remainder} 分钟"


def format_clock(timestamp: float) -> str:
    return datetime.fromtimestamp(float(timestamp)).strftime("%H:%M")


class StudyMinutesDialog:
    WIDTH = 420
    HEIGHT = 430

    def __init__(
        self,
        parent,
        *,
        title: str,
        subtitle: str,
        project_name: str,
        elapsed_seconds: int,
        initial_minutes: int,
        confirm_label: str,
        cancel_label: str,
        maximum_minutes: int | None = None,
    ):
        self.result_seconds: int | None = None
        elapsed_minutes = int(elapsed_seconds) // 60 or 1
        self.maximum_minutes = max(1, min(24 * 60, int(maximum_minutes or elapsed_minutes)))
        self.value = StringVar(value=str(max(1, min(self.maximum_minutes, int(initial_minutes)))))
        self.buttons: list[CanvasButton] = []
        self.window = Toplevel(parent)
        self.window.withdraw()
        self.window.title(title)
        self.window.geometry(self._geometry(parent))
        self.window.overrideredirect(True)
        self.window.resizable(False, False)
        self.window.attributes("-topmost", True)
        self.window.attributes("-alpha", 0.995)
        self.window.configure(bg=LIQUID.bg_bottom)
        self.window.protocol("WM_DELETE_WINDOW", self.cancel)
        self.canvas = Canvas(
            self.window,
            width=self.WIDTH,
            height=self.HEIGHT,
            bg=LIQUID.bg_bottom,
            highlightthickness=0,
        )
        self.canvas.pack(fill=BOTH, expand=True)
        self.drag_offset = (0, 0)
        self._draw(title, subtitle, project_name, elapsed_seconds, confirm_label, cancel_label)
        self.canvas.bind("<ButtonPress-1>", self._start_drag)
        self.canvas.bind("<B1-Motion>", self._drag)
        self.window.bind("<Escape>", lambda _event: self.cancel())
        self.window.bind("<Return>", lambda _event: self.confirm())
        self.window.update_idletasks()
        self.window.deiconify()
        self.window.grab_set()
        bring_to_front(self.window)
        self.entry.focus_set()
        self.entry.selection_range(0, "end")

    def _geometry(self, parent) -> str:
        parent.update_idletasks()
        screen_width = parent.winfo_screenwidth()
        screen_height = parent.winfo_screenheight()
        x = max(12, min(parent.winfo_x() + (parent.winfo_width() - self.WIDTH) // 2, screen_width - self.WIDTH - 12))
        y = max(12, min(parent.winfo_y() + 40, screen_height - self.HEIGHT - 12))
        return f"{self.WIDTH}x{self.HEIGHT}+{x}+{y}"

    def _draw(self, title, subtitle, project_name, elapsed_seconds, confirm_label, cancel_label) -> None:
        painter = LiquidPainter(self.canvas)
        painter.background(self.WIDTH, self.HEIGHT)
        painter.glass_panel(8, 8, self.WIDTH - 8, self.HEIGHT - 8)
        painter.status_dot(29, 30, LIQUID.warning)
        self.canvas.create_text(50, 36, anchor="w", text=title, fill=LIQUID.text_primary, font=LIQUID.font_title)
        self.canvas.create_text(28, 74, anchor="w", text=subtitle, fill=LIQUID.text_secondary, font=LIQUID.font_subtitle)
        rounded_rect(self.canvas, 28, 103, 392, 177, LIQUID.radius_lg, fill=LIQUID.warning_soft, outline=LIQUID.panel_border_soft, width=1)
        self.canvas.create_text(48, 126, anchor="w", text=project_name[:18], fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 11, "bold"))
        self.canvas.create_text(48, 154, anchor="w", text=f"计时器记录了 {format_session_minutes(elapsed_seconds)}", fill=LIQUID.warning_text, font=("Microsoft YaHei UI", 9, "bold"))
        self.canvas.create_text(28, 209, anchor="w", text="实际学习时长", fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 10, "bold"))
        rounded_rect(self.canvas, 28, 230, 392, 300, LIQUID.radius_lg, fill=LIQUID.control_bg, outline=LIQUID.panel_border_soft, width=1)
        self._button(44, 247, 42, 36, "−", lambda: self.adjust(-10), "minutes_minus")
        self._button(334, 247, 42, 36, "+", lambda: self.adjust(10), "minutes_plus")
        self.entry = Entry(
            self.window,
            textvariable=self.value,
            justify="center",
            font=("Segoe UI Variable Display", 24, "bold"),
            fg=LIQUID.text_primary,
            bg=LIQUID.panel_bg_inner,
            insertbackground=LIQUID.accent,
            relief="flat",
            bd=0,
            highlightthickness=1,
            highlightbackground=LIQUID.accent_border,
            highlightcolor=LIQUID.accent,
        )
        self.canvas.create_window(127, 246, anchor="nw", width=116, height=40, window=self.entry)
        self.canvas.create_text(257, 266, anchor="w", text="分钟", fill=LIQUID.text_secondary, font=("Microsoft YaHei UI", 10, "bold"))
        self.canvas.create_text(28, 322, anchor="w", text="只会修正本次记录，不会改动其他科目或历史数据。", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8, "bold"))
        self._button(28, 353, 142, 48, cancel_label, self.cancel, "minutes_cancel")
        self._button(184, 353, 208, 48, confirm_label, self.confirm, "minutes_confirm", primary=True)

    def _button(self, x, y, width, height, text, command, tag, primary=False) -> None:
        visual = LiquidPainter(self.canvas).button(
            x,
            y,
            width,
            height,
            text,
            tag,
            LIQUID.accent if primary else LIQUID.control_bg,
            "#ffffff" if primary else LIQUID.text_secondary,
            primary=primary,
        )
        self.buttons.append(CanvasButton(self.canvas, tag, command, visual))

    def adjust(self, delta: int) -> None:
        try:
            current = int(self.value.get())
        except ValueError:
            current = self.maximum_minutes
        self.value.set(str(max(1, min(self.maximum_minutes, current + delta))))

    def confirm(self) -> None:
        try:
            minutes = int(self.value.get().strip())
        except ValueError:
            messagebox.showwarning("时长格式不正确", "请输入整数分钟。", parent=self.window)
            return
        if not 1 <= minutes <= self.maximum_minutes:
            messagebox.showwarning("时长超出范围", f"请输入 1 到 {self.maximum_minutes} 分钟。", parent=self.window)
            return
        self.result_seconds = minutes * 60
        self.close()

    def cancel(self) -> None:
        self.result_seconds = None
        self.close()

    def close(self) -> None:
        if self.window.winfo_exists():
            try:
                self.window.grab_release()
            except Exception:
                pass
            self.window.destroy()

    def wait(self) -> int | None:
        self.window.wait_window()
        return self.result_seconds

    def _start_drag(self, event) -> None:
        if event.y < 92:
            self.drag_offset = (event.x_root - self.window.winfo_x(), event.y_root - self.window.winfo_y())

    def _drag(self, event) -> None:
        if self.drag_offset != (0, 0):
            self.window.geometry(f"+{event.x_root - self.drag_offset[0]}+{event.y_root - self.drag_offset[1]}")


class StudyHistoryDialog:
    WIDTH = 460
    HEIGHT = 646
    PAGE_SIZE = 6

    def __init__(self, parent, store, on_update, on_delete, on_close=None):
        self.store = store
        self.on_update = on_update
        self.on_delete = on_delete
        self.on_close = on_close
        self.selected_date = local_date()
        self.page = 0
        self.buttons: list[CanvasButton] = []
        self.drag_offset = (0, 0)
        self.window = Toplevel(parent)
        self.window.withdraw()
        self.window.title("学习记录")
        self.window.geometry(self._geometry(parent))
        self.window.overrideredirect(True)
        self.window.resizable(False, False)
        self.window.attributes("-topmost", True)
        self.window.attributes("-alpha", 0.995)
        self.window.configure(bg=LIQUID.bg_bottom)
        self.window.protocol("WM_DELETE_WINDOW", self.close)
        self.canvas = Canvas(self.window, width=self.WIDTH, height=self.HEIGHT, bg=LIQUID.bg_bottom, highlightthickness=0)
        self.canvas.pack(fill=BOTH, expand=True)
        self.canvas.bind("<ButtonPress-1>", self._start_drag)
        self.canvas.bind("<B1-Motion>", self._drag)
        self.window.bind("<Escape>", lambda _event: self.close())
        self.draw()
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

    def draw(self) -> None:
        self.canvas.delete("all")
        self.buttons.clear()
        painter = LiquidPainter(self.canvas)
        painter.background(self.WIDTH, self.HEIGHT)
        painter.glass_panel(8, 8, self.WIDTH - 8, self.HEIGHT - 8)
        painter.status_dot(29, 30, LIQUID.accent)
        self.canvas.create_text(50, 36, anchor="w", text="学习记录", fill=LIQUID.text_primary, font=LIQUID.font_title)
        self.canvas.create_text(28, 70, anchor="w", text="修正忘记结束的计时，网站会自动同步差额", fill=LIQUID.text_secondary, font=LIQUID.font_subtitle)
        self._button(self.WIDTH - 54, 22, 32, 32, "×", self.close, "history_close")

        rounded_rect(self.canvas, 28, 98, 432, 146, LIQUID.radius_lg, fill=LIQUID.control_bg, outline=LIQUID.panel_border_soft, width=1)
        self._button(40, 106, 34, 32, "‹", lambda: self.change_date(-1), "history_previous")
        self._button(386, 106, 34, 32, "›", lambda: self.change_date(1), "history_next")
        date_label = "今天" if self.selected_date == local_date() else self.selected_date
        self.canvas.create_text(230, 121, text=date_label, fill=LIQUID.text_primary, font=("Segoe UI Variable Display", 12, "bold"))
        self.canvas.create_text(230, 137, text=self.selected_date, fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 7))

        records = self.store.list_daily_study_sessions(self.selected_date)
        page_count = max(1, (len(records) + self.PAGE_SIZE - 1) // self.PAGE_SIZE)
        self.page = max(0, min(self.page, page_count - 1))
        visible = records[self.page * self.PAGE_SIZE:(self.page + 1) * self.PAGE_SIZE]
        if not visible:
            rounded_rect(self.canvas, 28, 164, 432, 520, LIQUID.radius_lg, fill=LIQUID.panel_bg_inner, outline=LIQUID.panel_border_soft, width=1)
            self.canvas.create_text(230, 321, text="这一天还没有已完成的学习记录", fill=LIQUID.text_secondary, font=("Microsoft YaHei UI", 10, "bold"))
            self.canvas.create_text(230, 350, text="正在进行的课程结束后会出现在这里", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8))
        else:
            for index, record in enumerate(visible):
                self._record_row(164 + index * 61, record)

        self.canvas.create_text(28, 554, anchor="w", text=f"共 {len(records)} 条记录", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8, "bold"))
        self.canvas.create_text(230, 554, text=f"第 {self.page + 1} / {page_count} 页", fill=LIQUID.text_secondary, font=("Microsoft YaHei UI", 8, "bold"))
        self._button(346, 538, 34, 32, "‹", lambda: self.change_page(-1), "history_page_previous")
        self._button(390, 538, 34, 32, "›", lambda: self.change_page(1), "history_page_next")
        self.canvas.create_text(28, 584, anchor="w", text="删除会从本地记录移除，并同步扣减网站对应时长。", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8))
        self._button(28, 596, 404, 34, "完成", self.close, "history_done", primary=True)

    def _record_row(self, y: int, record: dict) -> None:
        rounded_rect(self.canvas, 28, y, 432, y + 52, LIQUID.radius_md, fill=LIQUID.control_bg, outline=LIQUID.panel_border_soft, width=1)
        self.canvas.create_text(44, y + 18, anchor="w", text=str(record["project_name"] or "未命名课程")[:12], fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 9, "bold"))
        clock = f"{format_clock(record['started_at'])} - {format_clock(record['ended_at'])}"
        self.canvas.create_text(44, y + 37, anchor="w", text=clock, fill=LIQUID.text_tertiary, font=("Segoe UI Variable Display", 8))
        self.canvas.create_text(278, y + 26, anchor="e", text=format_session_minutes(record["duration_seconds"]), fill=LIQUID.accent, font=("Segoe UI Variable Display", 9, "bold"))
        tag_suffix = str(record["session_id"])[-8:]
        self._button(292, y + 9, 58, 34, "修改", lambda item=record: self.edit_record(item), f"history_edit_{tag_suffix}")
        self._button(358, y + 9, 58, 34, "删除", lambda item=record: self.delete_record(item), f"history_delete_{tag_suffix}", danger=True)

    def edit_record(self, record: dict) -> None:
        dialog = StudyMinutesDialog(
            self.window,
            title="修正学习时长",
            subtitle="确认这次课程真正投入的分钟数",
            project_name=str(record["project_name"] or "未命名课程"),
            elapsed_seconds=max(60, int(record["duration_seconds"])),
            initial_minutes=max(1, round(int(record["duration_seconds"]) / 60)),
            confirm_label="保存修正",
            cancel_label="取消",
            maximum_minutes=24 * 60,
        )
        result = dialog.wait()
        if result is not None and self.on_update(str(record["session_id"]), result):
            self.draw()

    def delete_record(self, record: dict) -> None:
        confirmed = messagebox.askyesno(
            "删除学习记录",
            f"确定删除 {record['project_name']} 的 {format_session_minutes(record['duration_seconds'])} 记录吗？\n\n网站中的对应时长也会同步扣减。",
            parent=self.window,
        )
        if confirmed and self.on_delete(str(record["session_id"])):
            self.draw()

    def change_date(self, delta: int) -> None:
        current = datetime.strptime(self.selected_date, "%Y-%m-%d")
        self.selected_date = (current + timedelta(days=delta)).strftime("%Y-%m-%d")
        self.page = 0
        self.draw()

    def change_page(self, delta: int) -> None:
        self.page = max(0, self.page + delta)
        self.draw()

    def _button(self, x, y, width, height, text, command, tag, primary=False, danger=False) -> None:
        fill = LIQUID.accent if primary else LIQUID.danger_soft if danger else LIQUID.control_bg
        foreground = "#ffffff" if primary else LIQUID.danger_text if danger else LIQUID.text_secondary
        visual = LiquidPainter(self.canvas).button(x, y, width, height, text, tag, fill, foreground, primary=primary)
        if danger:
            visual.update(hover=LIQUID.danger, pressed=LIQUID.danger_text)
        self.buttons.append(CanvasButton(self.canvas, tag, command, visual))

    def close(self) -> None:
        if self.window.winfo_exists():
            self.window.destroy()
        if self.on_close:
            callback, self.on_close = self.on_close, None
            callback()

    def _start_drag(self, event) -> None:
        if event.y < 90:
            self.drag_offset = (event.x_root - self.window.winfo_x(), event.y_root - self.window.winfo_y())

    def _drag(self, event) -> None:
        if self.drag_offset != (0, 0):
            self.window.geometry(f"+{event.x_root - self.drag_offset[0]}+{event.y_root - self.drag_offset[1]}")
