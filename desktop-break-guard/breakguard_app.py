from __future__ import annotations

import queue
import os
import time
from tkinter import Canvas, Tk, Toplevel, messagebox

from breakguard_activity import RuntimeActivityGuard, windows_session_locked
from breakguard_config import Config
from breakguard_instance import SingleInstance
from breakguard_logging import log_error
from breakguard_records import StudyHistoryDialog, StudyMinutesDialog
from breakguard_runtime import DATABASE_FILE, ICON_FILE
from breakguard_settings import ScheduleSettingsDialog
from breakguard_state import BreakStateMachine, utc_iso
from breakguard_storage import BreakGuardStore
from breakguard_study import StudyPlanner
from breakguard_summary import DailySummaryDialog
from breakguard_sync import SyncWorker
from breakguard_tray import WindowsTrayIcon
from breakguard_view import ViewMixin
from breakguard_widgets import CanvasButton, bring_to_front, clamp_window_to_screen, geometry_with_size, saved_window_size
from breakguard_window import WindowMixin
from liquid_style import LIQUID


class BreakGuardApp(WindowMixin, ViewMixin):
    def __init__(self, instance: SingleInstance, tray_actions: "queue.Queue[str]"):
        self.instance = instance
        self.tray_actions = tray_actions
        self.config = Config.load()
        self.store = BreakGuardStore(DATABASE_FILE)
        self.machine = BreakStateMachine(self.store, self.config.break_minutes * 60, self.config.notify_after_seconds, self.config.unfocused_after_seconds)
        self.planner = StudyPlanner(
            self.store,
            self.config.break_minutes,
            self.config.lag_grace_minutes,
            self.config.lag_repeat_minutes,
            self.config.daily_target_minutes,
        )
        self.ui_messages: queue.Queue[str] = queue.Queue()
        self.client = SyncWorker(self.config, self.store, self.ui_messages)
        self.client.start()

        self.root = Tk()
        self.root.title(os.environ.get("BREAK_GUARD_WINDOW_TITLE", "休息守护"))
        self.minimum_width = 428
        self.schedule_rows = self.schedule_row_count()
        self.minimum_height = self.preferred_height()
        self.normal_width, self.normal_height = saved_window_size(self.config.window_geometry, self.minimum_width, self.minimum_height)
        self.normal_geometry = geometry_with_size(self.config.window_geometry, self.normal_width, self.normal_height)
        self.compact_mode = bool(self.planner.session)
        self.width, self.height = self.compact_dimensions() if self.compact_mode else (self.normal_width, self.normal_height)
        self.root.geometry(geometry_with_size(self.config.window_geometry, self.width, self.height))
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", self.config.always_on_top)
        self.root.attributes("-alpha", min(0.995, max(0.985, self.config.opacity)))
        self.root.configure(bg=LIQUID.bg_bottom)
        self.root.protocol("WM_DELETE_WINDOW", self.hide_to_tray)
        self.root.bind("<ButtonPress-1>", self.start_drag)
        self.root.bind("<B1-Motion>", self.drag)
        self.root.bind("<ButtonRelease-1>", self.stop_drag)
        self.root.bind("<Motion>", self.update_resize_cursor)

        self.canvas: Canvas | None = None
        self.timer_item = self.subtitle_item = self.status_item = self.state_dot = None
        self.progress_item = self.target_item = self.primary_label_item = None
        self.segment_status_item = None
        self.button_commands = []
        self.buttons: dict[str, CanvasButton] = {}
        self.drag_offset = (0, 0)
        self.dragging = False
        self.resize_edge = ""
        self.resize_origin = None
        self.resize_target = None
        self.resize_preview: Toplevel | None = None
        self.resize_preview_canvas: Canvas | None = None
        self.resize_preview_border = None
        self.last_resize_update = 0.0
        self.hidden_to_tray = False
        self.exiting = False
        self.fullscreen: Toplevel | None = None
        self.fullscreen_canvas: Canvas | None = None
        self.fullscreen_timer_item = None
        self.fullscreen_kind = ""
        self.settings_dialog = None
        self.summary_dialog = None
        self.history_dialog = None
        self.last_fullscreen_raise = 0.0
        self.last_rollover_check = 0.0
        self.last_lag_check = 0.0
        self.activity_guard = RuntimeActivityGuard()

        self.enable_acrylic()
        self.build_ui()
        self.root.update_idletasks()
        clamp_window_to_screen(self.root, self.width, self.height)
        self.root.update_idletasks()
        self.persist_window_geometry()
        self.tray = WindowsTrayIcon(ICON_FILE, self.tray_actions)
        if self.tray.wait_until_ready() and os.environ.get("BREAK_GUARD_QA_MODE") != "1":
            self.hide_from_taskbar()
        elif not self.tray.available:
            self.set_status("托盘不可用，窗口不会被隐藏")
        self.refresh_view_state()
        self.poll_queues()
        self.tick()
    def project_ids(self) -> list[int]:
        return [int(project["id"]) for project in self.config.available_projects[:12] if int(project.get("id", 0)) > 0]
    def project_by_id(self, project_id: int) -> dict:
        projects = [project for project in self.config.available_projects if int(project.get("id", 0)) > 0]
        if not projects:
            return {"id": 0, "name": "待分配", "color": "#64748b"}
        return next((project for project in projects if int(project["id"]) == int(project_id)), projects[0])
    def select_current_project(self, project_id: int) -> None:
        if self.planner.session:
            self.set_status("课程进行中，结束后再切换当前课程")
            return
        selected = self.planner.select_project(project_id)
        project = self.project_by_id(selected)
        self.set_status(f"已选择课程：{project['name']}")
        self.refresh_view_state()
    def schedule_config_payload(self) -> dict:
        return {
            "dailyTargetMinutes": self.config.daily_target_minutes,
            "longStudyMinutes": self.config.long_study_minutes,
            "breakMinutes": self.config.break_minutes,
            "lagGraceMinutes": self.config.lag_grace_minutes,
            "lagRepeatMinutes": self.config.lag_repeat_minutes,
        }
    def sync_schedule_config(self) -> None:
        payload = self.schedule_config_payload()
        event_id = f"schedule_config_{int(time.time() * 1000)}"
        self.client.post_event("schedule_config_updated", event_id, note="桌面端更新每日学习设置", payload=payload)
    def apply_remote_schedule(self, message: dict) -> None:
        config = message.get("config") or {}
        projects = message.get("projects") or []
        self.config.daily_target_minutes = max(30, min(960, int(config.get("dailyTargetMinutes", self.config.daily_target_minutes))))
        self.config.long_study_minutes = max(60, min(720, int(config.get("longStudyMinutes", self.config.long_study_minutes))))
        self.config.break_minutes = max(1, min(60, int(config.get("breakMinutes", self.config.break_minutes))))
        self.config.lag_grace_minutes = max(0, min(180, int(config.get("lagGraceMinutes", self.config.lag_grace_minutes))))
        self.config.lag_repeat_minutes = max(5, min(180, int(config.get("lagRepeatMinutes", self.config.lag_repeat_minutes))))
        self.config.available_projects = [
            {"id": int(item["id"]), "name": str(item["name"]), "color": str(item.get("color", "#2563eb"))}
            for item in projects if isinstance(item, dict) and item.get("id") and item.get("name")
        ]
        self.config.save()
        self.on_schedule_settings_saved(sync=False)
        self.set_status("已从网站同步课程与每日学习目标")
    def primary_action(self) -> None:
        if self.planner.session:
            self.finish_study(auto=False)
        elif self.machine.session:
            self.cancel_break()
        else:
            self.start_study()

    def toggle_segment(self) -> None:
        if not self.planner.session:
            self.set_status("请先开始课程")
            return
        snapshot = self.planner.segment_snapshot()
        if snapshot["active"]:
            segment = self.planner.finish_segment()
            if segment:
                self.set_status(f"第 {segment['sequence_number']} 段已记录：{segment['duration_seconds'] // 60:02d}:{segment['duration_seconds'] % 60:02d}")
        else:
            started = self.planner.start_segment()
            if started:
                self.set_status(f"第 {started['next_sequence_number']} 段开始计时")
        if self.compact_mode:
            self.rebuild_compact_ui()
        else:
            self.refresh_view_state()
    def start_study(self) -> None:
        if self.machine.session:
            self.set_status("请先结束当前休息")
            return
        summary = self.planner.summary(available_project_ids=self.project_ids())
        if summary["day_ended"]:
            reopen = messagebox.askyesno(
                "继续今天",
                "今天已经结束并生成总结。要重新开启今天并继续学习吗？",
                parent=self.root,
            )
            if not reopen:
                self.show_day_summary(summary)
                return
            self.reopen_day()
            summary = self.planner.summary(available_project_ids=self.project_ids())
        project = self.project_by_id(summary["selected_project_id"])
        if int(project.get("id", 0)) <= 0:
            self.set_status("尚未同步到课程，请稍后再试")
            self.client.last_config_pull = 0.0
            self.client.wake_event.set()
            return
        session = self.planner.start_study(
            project_id=project["id"],
            project_name=project["name"],
        )
        self.hide_fullscreen()
        self.client.post_event(
            "class_started",
            f"{session.session_id}_class_started",
            startedAt=session.started_iso,
            note=f"开始学习：{session.project_name}",
            payload={
                "sessionSequence": session.sequence_number,
                "projectId": session.project_id,
                "projectName": session.project_name,
                "sessionDate": session.session_date,
            },
        )
        self.set_status(f"{session.project_name} 已开始自动计时")
        self.enter_compact_mode()
    def finish_study(self, auto: bool = False) -> None:
        session = self.planner.session
        if not session:
            return
        completed, duration = self.complete_study_record(auto)
        if not completed:
            return
        break_session = self.machine.start()
        self.client.post_event(
            "break_started",
            f"{break_session.session_id}_started",
            startedAt=break_session.started_iso,
            note=f"{completed.project_name}学习结束后自动休息",
        )
        self.exit_compact_mode()
        self.set_status(f"{completed.project_name}学习完成，自动休息 {self.config.break_minutes} 分钟")
        self.refresh_view_state()

    def complete_study_record(self, auto: bool = False):
        session = self.planner.session
        if not session:
            return None, 0
        elapsed = self.planner.study_elapsed()
        duration_override = None
        if not auto and elapsed >= self.config.long_study_minutes * 60:
            duration_override = StudyMinutesDialog(
                self.root,
                title="核对本次学习时长",
                subtitle=f"计时已超过 {self.config.long_study_minutes} 分钟，可能忘记结束",
                project_name=session.project_name,
                elapsed_seconds=elapsed,
                initial_minutes=max(1, elapsed // 60),
                confirm_label="确认并结束",
                cancel_label="继续计时",
            ).wait()
            if duration_override is None:
                self.set_status("已继续计时，本次课程尚未保存")
                return None, 0
        completed, duration = self.planner.complete_study(duration_override_seconds=duration_override)
        if not completed:
            return None, 0
        self.client.post_event(
            "class_completed",
            f"{completed.session_id}_class_completed",
            startedAt=completed.started_iso,
            endedAt=utc_iso(completed.started_at + duration),
            note=f"{completed.project_name}{'到时自动' if auto else '手动'}结束学习",
            payload={
                "sessionId": completed.session_id,
                "sessionSequence": completed.sequence_number,
                "durationSeconds": duration,
                "projectId": completed.project_id,
                "projectName": completed.project_name,
                "sessionDate": completed.session_date,
            },
        )
        return completed, duration

    def end_day(self) -> None:
        if self.planner.session:
            confirmed = messagebox.askyesno(
                "结束一天",
                "当前课程仍在计时。结束课程并生成今日总结吗？\n\n本次课程会正常保存，但不会再开始课间休息。",
                parent=self.root,
            )
            if not confirmed:
                return
            completed, _duration = self.complete_study_record(auto=False)
            if not completed:
                return
            self.exit_compact_mode()
        if self.machine.session:
            confirmed = messagebox.askyesno(
                "结束一天",
                "当前仍在课间休息。结束休息并生成今日总结吗？",
                parent=self.root,
            )
            if not confirmed:
                return
            self.cancel_break()
        current = self.planner.summary(available_project_ids=self.project_ids())
        if current["day_ended"]:
            self.show_day_summary(current)
            return
        now = time.time()
        summary = self.planner.end_day(now, self.project_ids())
        self.store.cancel_pending_events("schedule_lag", "suppressed because the study day ended")
        self.hide_fullscreen()
        self.client.post_event(
            "study_day_completed",
            f"study_day_completed_{summary['date'].replace('-', '')}_{int(now)}",
            endedAt=utc_iso(now),
            note=f"结束一天学习：{summary['session_count']} 次，{summary['study_seconds'] // 60} 分钟",
            payload={
                "sessionDate": summary["date"],
                "sessionCount": summary["session_count"],
                "studySeconds": summary["study_seconds"],
                "targetMinutes": summary["target_minutes"],
                "completionPercent": summary["completion_percent"],
                "projectBreakdown": [
                    {
                        "projectId": item["project_id"],
                        "projectName": item["project_name"],
                        "sessionCount": item["session_count"],
                        "studySeconds": item["study_seconds"],
                    }
                    for item in summary["project_breakdown"]
                ],
            },
        )
        self.set_status("今天已结束，进度提醒暂停到明天")
        self.refresh_view_state()
        self.show_day_summary(summary)

    def show_day_summary(self, summary: dict | None = None) -> None:
        if self.summary_dialog and self.summary_dialog.window.winfo_exists():
            bring_to_front(self.summary_dialog.window)
            return
        data = summary or self.planner.summary(available_project_ids=self.project_ids())
        self.summary_dialog = DailySummaryDialog(
            self.root,
            data,
            self.reopen_day,
            on_close=lambda: setattr(self, "summary_dialog", None),
        )

    def reopen_day(self) -> None:
        self.planner.reopen_day()
        self.set_status("今天已重新开启，可以继续学习")
        self.refresh_view_state()
    def open_schedule_settings(self) -> None:
        if self.settings_dialog and self.settings_dialog.window.winfo_exists():
            bring_to_front(self.settings_dialog.window)
            return
        self.settings_dialog = ScheduleSettingsDialog(self.root, self.config, self.on_schedule_settings_saved, self.open_study_history)

    def open_study_history(self) -> None:
        if self.history_dialog and self.history_dialog.window.winfo_exists():
            bring_to_front(self.history_dialog.window)
            return
        self.history_dialog = StudyHistoryDialog(
            self.root,
            self.store,
            self.update_study_session,
            self.delete_study_session,
            on_close=lambda: setattr(self, "history_dialog", None),
        )

    def update_study_session(self, session_id: str, duration_seconds: int) -> bool:
        try:
            before, after = self.store.update_study_session_duration(session_id, duration_seconds)
        except Exception as exc:
            log_error("study session update failed", exc)
            messagebox.showerror("修改失败", "这条学习记录无法修改，请稍后重试。", parent=self.root)
            return False
        event_id = f"{session_id}_corrected_{int(time.time() * 1000)}"
        self.client.post_event(
            "study_session_corrected",
            event_id,
            note=f"修正 {after['project_name']} 学习时长",
            payload={
                "sessionId": session_id,
                "sessionDate": after["session_date"],
                "sessionSequence": after["sequence_number"],
                "projectId": after["project_id"],
                "projectName": after["project_name"],
                "previousDurationSeconds": before["duration_seconds"],
                "durationSeconds": after["duration_seconds"],
            },
        )
        self.set_status(f"已将 {after['project_name']} 修正为 {after['duration_seconds'] // 60} 分钟")
        self.refresh_view_state()
        return True

    def delete_study_session(self, session_id: str) -> bool:
        try:
            record = self.store.delete_study_session(session_id)
        except Exception as exc:
            log_error("study session deletion failed", exc)
            messagebox.showerror("删除失败", "这条学习记录无法删除，请稍后重试。", parent=self.root)
            return False
        event_id = f"{session_id}_deleted_{int(time.time() * 1000)}"
        self.client.post_event(
            "study_session_deleted",
            event_id,
            note=f"删除 {record['project_name']} 学习记录",
            payload={
                "sessionId": session_id,
                "sessionDate": record["session_date"],
                "sessionSequence": record["sequence_number"],
                "projectId": record["project_id"],
                "projectName": record["project_name"],
                "previousDurationSeconds": record["duration_seconds"],
                "durationSeconds": 0,
            },
        )
        self.set_status(f"已删除 {record['project_name']} 的学习记录")
        self.refresh_view_state()
        return True
    def on_schedule_settings_saved(self, sync: bool = True) -> None:
        self.machine.break_seconds = self.config.break_minutes * 60
        self.planner.configure(
            self.config.break_minutes,
            self.config.lag_grace_minutes,
            self.config.lag_repeat_minutes,
            self.config.daily_target_minutes,
        )
        next_rows = self.schedule_row_count()
        if next_rows != self.schedule_rows:
            self.schedule_rows = next_rows
            self.minimum_height = self.preferred_height()
            if self.compact_mode:
                self.normal_height = max(self.normal_height, self.minimum_height)
                self.normal_geometry = geometry_with_size(self.normal_geometry, self.normal_width, self.normal_height)
                self.config.window_geometry = self.normal_geometry
                self.config.save()
                if sync:
                    self.sync_schedule_config()
                return
            self.height = max(self.height, self.minimum_height)
            x, y = self.root.winfo_x(), self.root.winfo_y()
            self.root.geometry(f"{self.width}x{self.height}+{x}+{y}")
            self.build_ui()
            self.root.update_idletasks()
            self.enable_acrylic()
            clamp_window_to_screen(self.root, self.width, self.height)
            self.persist_window_geometry()
        if sync:
            self.sync_schedule_config()
        self.set_status("每日学习设置已更新")
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
        self.set_status("休息结束，可以选择课程继续学习")
        self.refresh_view_state()
    def meal(self, kind: str) -> None:
        if self.planner.session or self.machine.session:
            self.set_status("请先结束当前课程或休息，再进入吃饭暂停")
            return
        label = "中午吃饭" if kind == "lunch" else "晚上吃饭"
        pause_label = "午饭" if kind == "lunch" else "晚饭"
        self.planner.set_pause(pause_label)
        self.store.cancel_pending_events("schedule_lag")
        self.client.post_event(kind, endedAt=utc_iso(), note=label)
        self.set_tone("meal")
        self.set_status(f"{label}暂停中；开始学习时自动恢复进度提醒")
        self.refresh_view_state()
    def update_study_state(self) -> None:
        if not self.planner.session:
            return
        if self.compact_mode:
            self.refresh_compact_view()
        else:
            self.refresh_view_state()
    def update_break_state(self) -> None:
        snapshot = self.machine.snapshot()
        if not snapshot["running"]:
            return
        self.refresh_break_view(snapshot)
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
    def update_day_rollover(self) -> None:
        rollover = self.planner.rollover_day()
        if not rollover["changed"] and not rollover["closed_dates"]:
            return
        self.store.cancel_schedule_lag_events_before(rollover["current_date"])
        if self.fullscreen_kind == "lag":
            self.hide_fullscreen()
        if rollover["changed"]:
            self.set_status("新的一天已开始，昨日学习记录已自动收口")
        else:
            self.set_status("此前未结束的学习日已自动收口")
        self.refresh_view_state()
    def update_schedule_lag(self) -> None:
        if self.machine.session or self.planner.session:
            return
        now = time.time()
        snapshot = self.planner.lag_snapshot(now, available_project_ids=self.project_ids())
        if not snapshot.get("due"):
            return
        self.planner.mark_lag_reminded(snapshot["project_id"], now)
        session_date = snapshot["date"]
        repeat_seconds = self.config.lag_repeat_minutes * 60
        repeat_index = int(max(0, now - snapshot["due_at"]) // repeat_seconds)
        self.client.post_event(
            "schedule_lag",
            f"schedule_lag_{session_date}_{int(snapshot['inactivity_started_at'])}_{repeat_index}",
            note=f"每日学习时长未达标，已学 {snapshot['study_minutes']} / {snapshot['target_minutes']} 分钟",
            payload={
                "sessionDate": session_date,
                "projectId": snapshot["project_id"],
                "studyMinutes": snapshot["study_minutes"],
                "targetMinutes": snapshot["target_minutes"],
                "behindMinutes": snapshot["behind_minutes"],
            },
        )
        self.set_status("学习时长未达标，已触发强提醒并同步网站")
        self.show_progress_warning(snapshot)
    def tick(self) -> None:
        try:
            now = time.time()
            excluded = self.activity_guard.observe(now, windows_session_locked())
            if excluded and self.planner.session:
                excluded = self.planner.exclude_inactive_time(excluded, now)
                if excluded:
                    self.set_status(f"已自动剔除 {max(1, excluded // 60)} 分钟休眠或锁屏时间")
            if now - self.last_rollover_check >= 15:
                self.update_day_rollover()
                self.last_rollover_check = now
            self.update_study_state()
            self.update_break_state()
            if now - self.last_lag_check >= 15:
                self.update_schedule_lag()
                self.last_lag_check = now
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
        self.close_resize_preview()
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
        raise
