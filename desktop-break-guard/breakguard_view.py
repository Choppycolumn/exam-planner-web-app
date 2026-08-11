from __future__ import annotations

import time
from tkinter import BOTH, Canvas, Toplevel

from breakguard_state import fmt_seconds
from breakguard_widgets import CanvasButton, bring_to_front
from liquid_style import LIQUID, LiquidPainter, draw_vertical_gradient, rounded_rect


class ViewMixin:
    def build_ui(self) -> None:
        for child in self.root.winfo_children():
            child.destroy()
        self.button_commands = []
        self.buttons = {}
        self.timer_item = self.subtitle_item = self.status_item = self.state_dot = None
        self.progress_item = self.target_item = None
        self.segment_status_item = None
        if self.compact_mode:
            self.build_compact_ui()
            return
        canvas = Canvas(self.root, width=self.width, height=self.height, bg=LIQUID.bg_bottom, highlightthickness=0)
        self.canvas = canvas
        canvas.pack(fill=BOTH, expand=True)
        painter = LiquidPainter(canvas)
        painter.background(self.width, self.height)
        painter.glass_panel(9, 9, self.width - 9, self.height - 9)
        right = self.width - 28
        center = self.width / 2
        self.state_dot = painter.status_dot(29, 31, LIQUID.success)
        canvas.create_text(48, 36, anchor="w", text="Break Guard", fill=LIQUID.text_primary, font=LIQUID.font_title)
        canvas.create_text(48, 57, anchor="w", text="专注节奏守护", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8))
        close_visual = painter.icon_button(self.width - 54, 22, 32, "×", "btn_close")
        close_visual["label"] = "btn_close__label"
        close_button = CanvasButton(canvas, "btn_close", self.hide_to_tray, close_visual)
        self.button_commands.append(close_button)
        self.buttons["btn_close"] = close_button
        canvas.create_text(28, 87, anchor="w", text="选择科目开始学习，结束后自动进入课间休息", fill=LIQUID.text_secondary, font=LIQUID.font_subtitle)

        rounded_rect(canvas, 28, 106, right, 186, LIQUID.radius_lg, fill=LIQUID.panel_bg_inner, outline=LIQUID.panel_border_soft, width=1)
        canvas.create_text(46, 127, anchor="w", text="今日学习", fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 10, "bold"))
        self.progress_item = canvas.create_text(right - 18, 127, anchor="e", text="0 分钟 / 目标", fill=LIQUID.accent, font=("Segoe UI Variable Display", 11, "bold"))
        self.progress_track_width = max(1, right - 64)
        rounded_rect(canvas, 46, 149, right - 18, 157, 4, fill=LIQUID.neutral_soft, outline="")
        self.progress_bar = rounded_rect(canvas, 46, 149, 47, 157, 4, fill=LIQUID.accent, outline="")
        self.target_item = canvas.create_text(46, 174, anchor="w", text="", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8, "bold"))
        canvas.create_text(28, 210, anchor="w", text="今日课程", fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 9, "bold"))
        canvas.create_text(right, 210, anchor="e", text="点击科目即可切换", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8))
        self.draw_schedule()

        vertical_offset = (self.schedule_rows - 2) * 54
        timer_top = 334 + vertical_offset
        painter.timer_well(28, timer_top, right, timer_top + 104)
        self.timer_item = canvas.create_text(center, timer_top + 41, text="选择课程", fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 28, "bold"))
        self.subtitle_item = canvas.create_text(center, timer_top + 82, text="准备开始今天的学习", fill=LIQUID.text_secondary, font=LIQUID.font_status)

        action_top = timer_top + 121
        settings_width = 118
        primary_width = self.width - 186
        self.add_button(28, action_top, primary_width, 50, "开始学习", "btn_primary", self.primary_action, LIQUID.accent, "#ffffff", primary=True)
        self.add_button(self.width - 146, action_top, settings_width, 50, "学习设置", "btn_settings", self.open_schedule_settings, LIQUID.control_bg, LIQUID.accent)
        canvas.create_text(29, action_top + 73, anchor="w", text="不计时暂停与收工", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8, "bold"))
        chip_width = (self.width - 92) // 4
        self.add_button(28, action_top + 88, chip_width, 38, "午饭", "btn_lunch", lambda: self.meal("lunch"), LIQUID.control_bg, LIQUID.text_secondary)
        self.add_button(40 + chip_width, action_top + 88, chip_width, 38, "晚饭", "btn_dinner", lambda: self.meal("dinner"), LIQUID.control_bg, LIQUID.text_secondary)
        self.add_button(52 + chip_width * 2, action_top + 88, chip_width, 38, "结束一天", "btn_day_end", self.end_day, LIQUID.violet_soft, LIQUID.violet_text)
        compact_action = self.enter_compact_mode if self.planner.session else self.hide_to_tray
        compact_label = "专注小窗" if self.planner.session else "收起"
        self.add_button(64 + chip_width * 3, action_top + 88, chip_width, 38, compact_label, "btn_min", compact_action, LIQUID.control_bg, LIQUID.text_secondary)

        status_top = action_top + 141
        rounded_rect(canvas, 28, status_top, right, status_top + 28, 14, fill=LIQUID.neutral_soft, outline="")
        canvas.create_oval(40, status_top + 10, 48, status_top + 18, fill=LIQUID.success, outline="")
        self.status_item = canvas.create_text(58, status_top + 14, anchor="w", text="网站同步待命 · 托盘常驻 · 关闭即隐藏", fill=LIQUID.text_secondary, font=LIQUID.font_footer, width=max(260, self.width - 100))
    def build_compact_ui(self) -> None:
        canvas = Canvas(self.root, width=self.width, height=self.height, bg=LIQUID.bg_bottom, highlightthickness=0)
        self.canvas = canvas
        canvas.pack(fill=BOTH, expand=True)
        painter = LiquidPainter(canvas)
        painter.background(self.width, self.height)
        painter.glass_panel(9, 9, self.width - 9, self.height - 9)
        self.state_dot = painter.status_dot(27, 26, LIQUID.accent)
        session = self.planner.session
        course_title = session.project_name if session else "学习计时"
        canvas.create_text(47, 31, anchor="w", text=course_title[:18], fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 10, "bold"))
        canvas.create_text(47, 52, anchor="w", text="正在自动记录", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8))

        expand_visual = painter.icon_button(self.width - 86, 20, 28, "↗", "btn_expand")
        expand_visual["label"] = "btn_expand__label"
        expand_button = CanvasButton(canvas, "btn_expand", self.exit_compact_mode, expand_visual)
        self.button_commands.append(expand_button)
        self.buttons["btn_expand"] = expand_button
        close_visual = painter.icon_button(self.width - 50, 20, 28, "×", "btn_close")
        close_visual["label"] = "btn_close__label"
        close_button = CanvasButton(canvas, "btn_close", self.hide_to_tray, close_visual)
        self.button_commands.append(close_button)
        self.buttons["btn_close"] = close_button

        self.timer_item = canvas.create_text(34, 103, anchor="w", text="00:00", fill=LIQUID.text_primary, font=("Segoe UI Variable Display", 34, "bold"))
        self.subtitle_item = canvas.create_text(36, 137, anchor="w", text="已开始自动计时", fill=LIQUID.text_secondary, font=("Microsoft YaHei UI", 8, "bold"))
        self.add_button(self.width - 154, 82, 124, 58, "结束课程", "btn_primary", self.primary_action, LIQUID.accent, "#ffffff", primary=True)

        panel_bottom = self.height - 18
        rounded_rect(canvas, 24, 154, self.width - 24, panel_bottom, LIQUID.radius_lg, fill=LIQUID.panel_bg_inner, outline=LIQUID.panel_border_soft, width=1)
        canvas.create_text(38, 176, anchor="w", text="分段计时", fill=LIQUID.text_primary, font=("Microsoft YaHei UI", 9, "bold"))
        self.segment_status_item = canvas.create_text(38, 199, anchor="w", text="需要时单独标记一段", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 8, "bold"))
        self.add_button(self.width - 132, 166, 100, 36, "开始分段", "btn_segment", self.toggle_segment, LIQUID.accent_soft, LIQUID.accent)

        segments = self.planner.segment_snapshot()["segments"]
        if not segments:
            canvas.create_text(38, 229, anchor="w", text="分段结束后会保留在这里，直至本次课程结束", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 7))
            return
        gap = 8
        chip_width = (self.width - 84) // 2
        for index, segment in enumerate(segments):
            row, column = divmod(index, 2)
            x = 38 + column * (chip_width + gap)
            y = 217 + row * 30
            rounded_rect(canvas, x, y, x + chip_width, y + 25, 12, fill=LIQUID.neutral_soft, outline=LIQUID.panel_border_soft, width=1)
            label = f"第 {segment['sequence_number']} 段  {fmt_seconds(segment['duration_seconds'])}"
            canvas.create_text(x + chip_width / 2, y + 13, text=label, fill=LIQUID.text_secondary, font=("Microsoft YaHei UI", 8, "bold"))
    def schedule_row_count(self) -> int:
        project_count = max(1, min(12, len(self.config.available_projects)))
        return max(1, (project_count + 1) // 2)
    def preferred_height(self) -> int:
        return max(586, 640 + (self.schedule_rows - 2) * 54)
    def draw_schedule(self) -> None:
        if self.canvas is None:
            return
        self.canvas.delete("schedule_dynamic")
        projects = self.config.available_projects[:12]
        if not projects:
            self.canvas.create_text(28, 247, anchor="w", text="等待从网站同步学习项目", fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 9), tags="schedule_dynamic")
            return
        gap = 10
        tile_width = max(120, (self.width - 66) // 2)
        selected_project_id = self.planner.selected_project_id(self.project_ids())
        for index, project in enumerate(projects):
            row, column = divmod(index, 2)
            x, y = 28 + column * (tile_width + gap), 226 + row * 54
            active = bool(self.planner.session and int(self.planner.session.project_id) == int(project["id"]))
            selected = int(project["id"]) == selected_project_id
            fill = LIQUID.accent_soft if active or selected else LIQUID.control_bg
            foreground = LIQUID.accent if active or selected else LIQUID.text_primary
            marker = "●" if active else "✓" if selected else ""
            project_tag = f"project_slot_{project['id']}"
            tags = ("schedule_dynamic", project_tag)
            project_name = (project.get("name") or "未命名课程")[:10]
            rounded_rect(
                self.canvas, x, y, x + tile_width, y + 46, LIQUID.radius_md,
                fill=fill,
                outline=LIQUID.accent if active or selected else LIQUID.panel_border_soft,
                width=1,
                tags=(*tags, f"{project_tag}__surface"),
            )
            self.canvas.create_text(x + 16, y + 23, text=marker, fill=foreground, font=("Segoe UI Variable Display", 9, "bold"), tags=tags)
            self.canvas.create_text(x + 31, y + 16, anchor="w", text=project_name, fill=foreground, font=("Microsoft YaHei UI", 9, "bold"), tags=tags)
            state_text = "学习中" if active else "当前课程" if selected else "点击选择"
            self.canvas.create_text(x + 31, y + 33, anchor="w", text=state_text, fill=LIQUID.text_tertiary, font=("Microsoft YaHei UI", 7), tags=tags)
            pressed_fill = LIQUID.control_pressed if not active and not selected else LIQUID.accent_border
            self.canvas.tag_bind(
                project_tag, "<ButtonPress-1>",
                lambda _event, surface=f"{project_tag}__surface", pressed=pressed_fill: self.canvas.itemconfigure(surface, fill=pressed),
            )
            self.canvas.tag_bind(
                project_tag, "<ButtonRelease-1>",
                lambda _event, project_id=int(project["id"]), surface=f"{project_tag}__surface", normal=fill: (
                    self.canvas.itemconfigure(surface, fill=normal), self.select_current_project(project_id)
                ),
            )
            self.canvas.tag_bind(project_tag, "<Enter>", lambda _event: self.canvas.configure(cursor="hand2"))
            self.canvas.tag_bind(
                project_tag, "<Leave>",
                lambda _event, surface=f"{project_tag}__surface", normal=fill: (
                    self.canvas.itemconfigure(surface, fill=normal), self.canvas.configure(cursor="")
                ),
            )
    def add_button(self, x, y, width, height, text, tag, command, fill, foreground, primary=False) -> None:
        visual = LiquidPainter(self.canvas).button(x, y, width, height, text, tag, fill, foreground, primary=primary)
        visual["label"] = f"{tag}__label"
        button = CanvasButton(self.canvas, tag, command, visual)
        self.button_commands.append(button)
        self.buttons[tag] = button
    def set_status(self, text: str) -> None:
        if self.canvas is not None and self.status_item is not None:
            self.canvas.itemconfigure(self.status_item, text=text)
    def set_timer(self, text: str, subtitle: str) -> None:
        if self.canvas is not None and self.timer_item is not None:
            timer_parts = text.removeprefix("+").split(":")
            numeric = len(timer_parts) == 2 and all(part.isdigit() for part in timer_parts)
            if self.compact_mode:
                timer_font = ("Segoe UI Variable Display", 34, "bold")
            elif numeric:
                timer_font = LIQUID.font_timer
            else:
                timer_font = ("Microsoft YaHei UI", 26, "bold")
            self.canvas.itemconfigure(self.timer_item, text=text, font=timer_font)
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
        summary = self.planner.summary(available_project_ids=self.project_ids())
        if self.canvas is None:
            return summary
        study_minutes = summary["study_seconds"] // 60
        target_minutes = summary["target_minutes"]
        self.canvas.itemconfigure(self.progress_item, text=f"{self.format_minutes(study_minutes)} / {self.format_minutes(target_minutes)}")
        pause_text = " · 今日已结束" if summary["day_ended"] else f" · {summary['paused_label']}中" if summary["paused_label"] else ""
        self.canvas.itemconfigure(self.target_item, text=f"已学 {study_minutes} 分钟 · 目标 {target_minutes} 分钟{pause_text}")
        self.canvas.delete("progress_fill")
        width = max(1, int(self.progress_track_width * summary["progress"]))
        self.progress_bar = rounded_rect(self.canvas, 46, 149, 46 + width, 157, 4, fill=LIQUID.accent, outline="", tags="progress_fill")
        self.draw_schedule()
        return summary
    @staticmethod
    def format_minutes(minutes: int) -> str:
        minutes = max(0, int(minutes))
        hours, remainder = divmod(minutes, 60)
        return f"{hours}小时{remainder:02d}分" if hours else f"{remainder}分钟"
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
        canvas = Canvas(window, width=width, height=height, bg="#06101e", highlightthickness=0, name="canvas")
        self.fullscreen_canvas = canvas
        canvas.pack(fill=BOTH, expand=True)
        draw_vertical_gradient(canvas, width, height, "#06101e", "#11263e")
        card_w, card_h = min(760, width - 80), 390
        x1, y1 = (width - card_w) // 2, max(120, (height - card_h) // 2)
        x2, y2 = x1 + card_w, y1 + card_h
        rounded_rect(canvas, x1 + 4, y1 + 9, x2 + 4, y2 + 9, 40, fill="#020711", outline="")
        rounded_rect(canvas, x1, y1, x2, y2, 40, fill="#142238", outline="#35506f", width=1)
        rounded_rect(canvas, width / 2 - 92, y1 + 34, width / 2 + 92, y1 + 68, 17, fill="#38202a", outline="#794052", width=1)
        canvas.create_text(width / 2, y1 + 51, text="休息计时已结束", fill="#ff9db0", font=("Microsoft YaHei UI", 11, "bold"))
        canvas.create_text(width / 2, y1 + 128, text="现在回来", fill="#f4f8fd", font=("Microsoft YaHei UI", 50, "bold"))
        self.fullscreen_timer_item = canvas.create_text(width / 2, y1 + 196, text=f"已经超时 {fmt_seconds(overtime)}，现在回到学习。", fill="#e2e8f0", font=("Microsoft YaHei UI", 22, "bold"))
        canvas.create_text(width / 2, y1 + 244, text="超过 5 分钟仍未确认，网站会记录一次不专注。", fill="#91a5bd", font=("Microsoft YaHei UI", 12))
        tag, button_w, button_h = "fullscreen_back", 210, 60
        button_x, button_y = int(width / 2 - button_w / 2), y1 + 292
        rounded_rect(canvas, button_x + 2, button_y + 4, button_x + button_w + 2, button_y + button_h + 4, 18, fill="#020711", outline="", tags=tag)
        rounded_rect(canvas, button_x, button_y, button_x + button_w, button_y + button_h, 18, fill="#f4f8fd", outline="#ffffff", width=1, tags=(tag, f"{tag}__surface"))
        canvas.create_text(width / 2, button_y + button_h / 2, text="结束休息", fill="#111c2e", font=("Microsoft YaHei UI", 15, "bold"), tags=(tag, f"{tag}__label"))
        self.button_commands.append(CanvasButton(canvas, tag, self.cancel_break, {
            "surface": f"{tag}__surface",
            "label": f"{tag}__label",
            "normal": "#f4f8fd",
            "hover": "#e2efff",
            "pressed": "#cadcf1",
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
        canvas = Canvas(window, width=width, height=height, bg="#080d18", highlightthickness=0)
        self.fullscreen_canvas = canvas
        canvas.pack(fill=BOTH, expand=True)
        draw_vertical_gradient(canvas, width, height, "#080d18", "#1d1730")
        card_w, card_h = min(820, width - 80), 430
        x1, y1 = (width - card_w) // 2, max(100, (height - card_h) // 2)
        x2, y2 = x1 + card_w, y1 + card_h
        rounded_rect(canvas, x1 + 4, y1 + 10, x2 + 4, y2 + 10, 40, fill="#03050d", outline="")
        rounded_rect(canvas, x1, y1, x2, y2, 40, fill="#181d30", outline="#5a517e", width=1)
        rounded_rect(canvas, width / 2 - 100, y1 + 34, width / 2 + 100, y1 + 70, 17, fill="#342a24", outline="#74552b", width=1)
        canvas.create_text(width / 2, y1 + 52, text="学习进度提醒", fill="#f0b65b", font=("Microsoft YaHei UI", 11, "bold"))
        canvas.create_text(width / 2, y1 + 130, text="今天的学习时长还未达标", fill="#f4f8fd", font=("Microsoft YaHei UI", 40, "bold"))
        canvas.create_text(
            width / 2, y1 + 198,
            text=f"距离上次学习结束已 {snapshot['inactive_minutes']} 分钟\n今日已学 {snapshot['study_minutes']} / {snapshot['target_minutes']} 分钟，请确认是否继续",
            fill="#d8d5ee", font=("Microsoft YaHei UI", 17, "bold"), justify="center",
        )
        canvas.create_text(width / 2, y1 + 266, text="这不是惩罚，只是把今天重新拉回轨道。", fill="#9ea9c4", font=("Microsoft YaHei UI", 12))
        self._fullscreen_button(canvas, int(width / 2 - 220), y1 + 312, 250, 64, "现在开始学习", "lag_start", self.start_study, "#f4f8fd", "#111c2e")
        self._fullscreen_button(canvas, int(width / 2 + 50), y1 + 312, 170, 64, "稍后提醒", "lag_later", self.hide_fullscreen, "#26263d", "#d8d5ee")
        window.bind("<Escape>", lambda _event: self.hide_fullscreen())
        window.after(50, lambda: bring_to_front(window))
        self.last_fullscreen_raise = time.time()
    def _fullscreen_button(self, canvas, x, y, width, height, text, tag, command, fill, foreground) -> None:
        rounded_rect(canvas, x + 2, y + 4, x + width + 2, y + height + 4, 18, fill="#03050d", outline="", tags=tag)
        rounded_rect(canvas, x, y, x + width, y + height, 18, fill=fill, outline="#52627a", width=1, tags=(tag, f"{tag}__surface"))
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
        if self.compact_mode:
            self.refresh_compact_view()
            return
        summary = self.update_progress()
        snapshot = self.machine.snapshot()
        self.set_action_emphasis(True)
        if self.canvas is not None and "btn_day_end" in self.buttons:
            self.canvas.itemconfigure("btn_day_end__label", text="今日总结" if summary["day_ended"] else "结束一天")
        if self.planner.session:
            elapsed = self.planner.study_elapsed()
            started_text = time.strftime("%H:%M", time.localtime(self.planner.session.started_at))
            is_long = elapsed >= self.config.long_study_minutes * 60
            subtitle = "已超过核对阈值 · 结束时请确认实际时长" if is_long else f"{self.planner.session.project_name} · {started_text} 开始 · 正在记录"
            self.set_timer(fmt_seconds(elapsed), subtitle)
            self.set_tone("warning" if is_long else "running")
            if self.canvas is not None:
                self.canvas.itemconfigure("btn_primary__label", text="结束学习并休息")
        elif snapshot["running"]:
            self.refresh_break_view(snapshot)
        elif summary["day_ended"]:
            self.set_timer("今天辛苦了", f"已学 {summary['study_seconds'] // 60} 分钟 · 点击今日总结回顾")
            self.set_tone("idle")
            if self.canvas is not None:
                self.canvas.itemconfigure("btn_primary__label", text="继续今天")
        else:
            project = self.project_by_id(summary["selected_project_id"])
            label = f"开始学习 {project['name']}" if int(project.get("id", 0)) else "等待课程同步"
            self.set_timer(project["name"], f"{summary['paused_label']}暂停中" if summary["paused_label"] else "点击后开始记录学习时间")
            self.set_tone("idle")
            if self.canvas is not None:
                self.canvas.itemconfigure("btn_primary__label", text=label)

    def refresh_break_view(self, snapshot: dict) -> None:
        if snapshot["remaining"] > 0:
            self.set_timer(fmt_seconds(snapshot["remaining"]), "课间休息中，到时会全屏提醒")
            self.set_tone("running")
            label = "提前结束休息"
        else:
            self.set_timer(f"+{fmt_seconds(snapshot['overtime'])}", "休息已结束，请回来")
            self.set_tone("warning")
            label = "结束休息"
        if self.canvas is not None:
            self.canvas.itemconfigure("btn_primary__label", text=label)
    def refresh_compact_view(self) -> None:
        session = self.planner.session
        if not session or self.canvas is None:
            return
        elapsed = self.planner.study_elapsed()
        started_text = time.strftime("%H:%M", time.localtime(session.started_at))
        is_long = elapsed >= self.config.long_study_minutes * 60
        subtitle = "已超过核对阈值 · 结束时确认" if is_long else f"{started_text} 开始 · 已自动记录"
        self.set_timer(fmt_seconds(elapsed), subtitle)
        self.set_tone("warning" if is_long else "running")
        self.canvas.itemconfigure("btn_primary__label", text="结束课程")
        segment = self.planner.segment_snapshot()
        segment_count = len(segment["segments"])
        if segment["active"]:
            status = f"第 {segment['next_sequence_number']} 段 · {fmt_seconds(segment['active_seconds'])}"
            self.canvas.itemconfigure("btn_segment__label", text="结束分段")
            self.buttons["btn_segment"].set_palette(LIQUID.warning_soft, LIQUID.control_hover, LIQUID.control_pressed, LIQUID.warning_text)
        else:
            status = f"已保留 {segment_count} 段 · 累计 {fmt_seconds(segment['total_seconds'])}" if segment_count else "需要时单独标记一段"
            self.canvas.itemconfigure("btn_segment__label", text="开始分段")
            self.buttons["btn_segment"].set_palette(LIQUID.accent_soft, LIQUID.control_hover, LIQUID.control_pressed, LIQUID.accent)
        if self.segment_status_item is not None:
            self.canvas.itemconfigure(self.segment_status_item, text=status)
