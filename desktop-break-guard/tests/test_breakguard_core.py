from __future__ import annotations

import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from breakguard_secrets import protect_secret, unprotect_secret
from breakguard_study import StudyPlanner
from breakguard_state import BreakStateMachine
from breakguard_storage import BreakGuardStore


class BreakGuardCoreTests(unittest.TestCase):
    def test_ui_modules_import_after_split(self):
        import breakguard_app
        import breakguard_view
        import breakguard_widgets
        import breakguard_window

        self.assertTrue(callable(breakguard_app.main))
        self.assertTrue(hasattr(breakguard_view, "ViewMixin"))
        self.assertTrue(hasattr(breakguard_window, "WindowMixin"))
        self.assertIsInstance(breakguard_widgets.IS_WINDOWS, bool)

    def test_course_row_growth_reapplies_the_windows_region(self):
        from breakguard_app import BreakGuardApp

        app = BreakGuardApp.__new__(BreakGuardApp)
        app.config = SimpleNamespace(
            break_minutes=10,
            lag_grace_minutes=20,
            lag_repeat_minutes=30,
            daily_target_minutes=600,
            available_projects=[{"id": index, "name": f"课程 {index}"} for index in range(1, 8)],
        )
        app.machine = SimpleNamespace(break_seconds=600)
        app.planner = SimpleNamespace(configure=Mock())
        app.schedule_rows = 3
        app.minimum_height = 694
        app.compact_mode = False
        app.width = app.normal_width = 428
        app.height = app.normal_height = 694
        app.normal_geometry = "428x694+100+100"
        app.root = SimpleNamespace(
            winfo_x=Mock(return_value=100),
            winfo_y=Mock(return_value=100),
            winfo_screenwidth=Mock(return_value=1920),
            winfo_screenheight=Mock(return_value=1080),
            geometry=Mock(),
            update_idletasks=Mock(),
        )
        app.build_ui = Mock()
        app.enable_acrylic = Mock()
        app.persist_window_geometry = Mock()
        app.set_status = Mock()
        app.refresh_view_state = Mock()

        app.on_schedule_settings_saved(sync=False)

        self.assertEqual(app.schedule_rows, 4)
        self.assertEqual(app.height, 748)
        app.build_ui.assert_called_once()
        app.enable_acrylic.assert_called_once()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = Path(self.temporary.name) / "break-guard.sqlite"
        self.store = BreakGuardStore(self.database)

    def tearDown(self):
        self.temporary.cleanup()

    def test_active_break_survives_restart(self):
        machine = BreakStateMachine(self.store, 600, 60, 300)
        session = machine.start(now=1_000)
        restored = BreakStateMachine(BreakGuardStore(self.database), 600, 60, 300)
        self.assertEqual(restored.session.session_id, session.session_id)
        self.assertEqual(restored.snapshot(now=1_100)["remaining"], 500)

    def test_thresholds_are_persisted(self):
        machine = BreakStateMachine(self.store, 600, 60, 300)
        machine.start(now=1_000)
        self.assertTrue(machine.snapshot(now=1_661)["warning_due"])
        machine.mark_warning_sent()
        restored = BreakStateMachine(BreakGuardStore(self.database), 600, 60, 300)
        self.assertFalse(restored.snapshot(now=1_661)["warning_due"])
        self.assertTrue(restored.snapshot(now=1_901)["unfocused_due"])

    def test_outbox_deduplicates_event_ids(self):
        first = self.store.enqueue_event("unfocused", {"overdueSeconds": 300}, "session_unfocused")
        second = self.store.enqueue_event("unfocused", {"overdueSeconds": 301}, "session_unfocused")
        self.assertEqual(first, second)
        self.assertEqual(self.store.pending_count(), 1)

    def test_retry_state_survives_restart(self):
        event_id = self.store.enqueue_event("break_started", {}, "session_started")
        self.store.mark_retry(event_id, 2, 30, "offline")
        restarted = BreakGuardStore(self.database)
        self.assertEqual(restarted.pending_count(), 1)

    def test_permanent_sync_failure_stops_retrying(self):
        event_id = self.store.enqueue_event("break_started", {}, "invalid_token_event")
        self.store.mark_failed(event_id, "HTTP 401")
        restarted = BreakGuardStore(self.database)
        self.assertEqual(restarted.pending_count(), 0)
        self.assertEqual(restarted.failed_count(), 1)

    def test_meal_pause_cancels_pending_schedule_lag_events(self):
        self.store.enqueue_event("schedule_lag", {}, "schedule_lag_pending")
        self.store.enqueue_event("class_started", {}, "class_started_pending")
        self.assertEqual(self.store.cancel_pending_events("schedule_lag"), 1)
        self.assertEqual(self.store.pending_count(), 1)

    def test_secret_round_trip(self):
        protected = protect_secret("local-test-token")
        self.assertNotIn("local-test-token", protected)
        self.assertEqual(unprotect_secret(protected), "local-test-token")

    def planner(self):
        return StudyPlanner(self.store, 10, 20, 30, 200)

    def planner_with_target(self, target_minutes: int):
        return StudyPlanner(self.store, 10, 20, 30, target_minutes)

    def test_course_completion_persists_daily_progress(self):
        start = datetime(2026, 7, 12, 8, 0).timestamp()
        planner = self.planner()
        session = planner.start_study(start, project_id=19, project_name="信号与系统")
        completed, duration = planner.complete_study(start + 50 * 60)
        self.assertEqual(completed.session_id, session.session_id)
        self.assertEqual(duration, 3000)
        restarted = StudyPlanner(BreakGuardStore(self.database), 10, 20, 30, 200)
        summary = restarted.summary(start + 3600)
        self.assertEqual(summary["session_count"], 1)
        self.assertEqual(summary["study_seconds"], 3000)

    def test_active_course_survives_restart(self):
        start = datetime(2026, 7, 12, 9, 0).timestamp()
        planner = self.planner()
        session = planner.start_study(start, project_id=19, project_name="信号与系统")
        restored = StudyPlanner(BreakGuardStore(self.database), 10, 20, 30, 200)
        self.assertEqual(restored.session.session_id, session.session_id)
        self.assertEqual(restored.study_elapsed(start + 600), 600)

    def test_course_uses_actual_elapsed_time_without_fixed_length(self):
        start = datetime(2026, 7, 12, 9, 0).timestamp()
        planner = self.planner()
        planner.start_study(start, project_id=19, project_name="信号与系统")
        self.assertEqual(planner.study_elapsed(start + 75 * 60), 4500)
        self.assertIsNotNone(planner.session)
        _session, duration = planner.complete_study(start + 75 * 60)
        self.assertEqual(duration, 4500)

    def test_course_segments_persist_until_the_total_timer_ends(self):
        start = datetime(2026, 7, 12, 9, 0).timestamp()
        planner = self.planner()
        planner.start_study(start, project_id=19, project_name="信号与系统")

        first_start = planner.start_segment(start + 5 * 60)
        self.assertTrue(first_start["active"])
        self.assertEqual(first_start["next_sequence_number"], 1)

        restored = StudyPlanner(BreakGuardStore(self.database), 10, 20, 30, 200)
        self.assertTrue(restored.segment_snapshot(start + 8 * 60)["active"])
        first = restored.finish_segment(start + 15 * 60)
        self.assertEqual(first["duration_seconds"], 600)

        restored.start_segment(start + 20 * 60)
        restored.start_segment(start + 22 * 60)
        second = restored.finish_segment(start + 25 * 60)
        self.assertEqual(second["duration_seconds"], 300)
        snapshot = restored.segment_snapshot(start + 30 * 60)
        self.assertFalse(snapshot["active"])
        self.assertEqual([item["duration_seconds"] for item in snapshot["segments"]], [600, 300])
        self.assertEqual(snapshot["total_seconds"], 900)

        restarted = StudyPlanner(BreakGuardStore(self.database), 10, 20, 30, 200)
        self.assertEqual(len(restarted.segment_snapshot(start + 30 * 60)["segments"]), 2)
        restarted.complete_study(start + 40 * 60)
        after_completion = StudyPlanner(BreakGuardStore(self.database), 10, 20, 30, 200)
        self.assertEqual(after_completion.segment_snapshot()["segments"], [])

    def test_progress_uses_study_time(self):
        start = datetime(2026, 7, 12, 9, 0).timestamp()
        planner = self.planner_with_target(120)
        planner.start_study(start, project_id=19, project_name="信号与系统")
        planner.complete_study(start + 30 * 60)
        summary = planner.summary(start + 31 * 60)
        self.assertEqual(summary["study_seconds"], 1800)
        self.assertEqual(summary["target_minutes"], 120)
        self.assertEqual(summary["progress"], 0.25)

    def test_active_course_time_is_included_in_progress(self):
        start = datetime(2026, 7, 12, 9, 0).timestamp()
        planner = self.planner_with_target(60)
        planner.start_study(start, project_id=19, project_name="信号与系统")
        summary = planner.summary(start + 15 * 60)
        self.assertEqual(summary["study_seconds"], 900)
        self.assertEqual(summary["progress"], 0.25)

    def test_reaching_time_target_suppresses_progress_warning(self):
        start = datetime(2026, 7, 12, 8, 0).timestamp()
        planner = self.planner_with_target(50)
        planner.start_study(start, project_id=19, project_name="信号与系统")
        planner.complete_study(start + 50 * 60)
        self.assertFalse(planner.lag_snapshot(start + 180 * 60)["due"])

    def test_user_can_select_and_complete_any_project(self):
        start = datetime(2026, 7, 12, 10, 0).timestamp()
        planner = self.planner()
        planner.select_project(19, start)
        session = planner.start_study(start, project_id=19, project_name="信号与系统")
        self.assertEqual(session.project_id, 19)
        self.assertEqual(session.sequence_number, 1)
        planner.complete_study(start + 50 * 60)
        self.assertEqual(planner.summary(start + 51 * 60, [19, 20])["selected_project_id"], 19)
        self.assertEqual(planner.summary(start + 51 * 60, [19, 20])["session_count"], 1)

    def test_selected_project_survives_restart(self):
        now = datetime(2026, 7, 12, 8, 0).timestamp()
        self.planner().select_project(19, now)
        restored = StudyPlanner(BreakGuardStore(self.database), 10, 20, 30, 200)
        self.assertEqual(restored.summary(now, [18, 19])["selected_project_id"], 19)

    def test_lag_reminder_repeats_only_after_cooldown(self):
        start = datetime(2026, 7, 12, 8, 0).timestamp()
        planner = self.planner()
        planner.start_study(start, project_id=19, project_name="信号与系统")
        planner.complete_study(start + 50 * 60)
        due = start + 81 * 60
        snapshot = planner.lag_snapshot(due)
        self.assertTrue(snapshot["due"])
        self.assertEqual(snapshot["project_id"], 19)
        planner.mark_lag_reminded(19, due)
        self.assertFalse(planner.lag_snapshot(due + 29 * 60)["due"])
        self.assertTrue(planner.lag_snapshot(due + 31 * 60)["due"])

    def test_meal_pause_suppresses_progress_warning_until_next_course(self):
        now = datetime(2026, 7, 12, 12, 0).timestamp()
        planner = self.planner()
        planner.set_pause("午饭", now)
        self.assertFalse(planner.lag_snapshot(now)["due"])
        planner.select_project(19, now + 30 * 60)
        self.assertEqual(planner.summary(now + 30 * 60)["paused_label"], "午饭")
        self.assertFalse(planner.lag_snapshot(now + 30 * 60)["due"])
        planner.start_study(now + 60 * 60, project_id=19, project_name="信号与系统")
        self.assertEqual(planner.summary(now + 60 * 60)["paused_label"], "")

    def test_completed_meal_pause_is_excluded_from_inactive_time(self):
        start = datetime(2026, 7, 12, 8, 0).timestamp()
        planner = self.planner()
        planner.start_study(start, project_id=19, project_name="信号与系统")
        planner.complete_study(start + 50 * 60)
        planner.set_pause("午饭", start + 55 * 60)
        planner.select_project(20, start + 100 * 60)

        restarted = StudyPlanner(BreakGuardStore(self.database), 10, 20, 30, 200)
        self.assertEqual(restarted.summary(start + 100 * 60)["paused_label"], "午饭")
        restarted.clear_pause(start + 130 * 60)

        self.assertFalse(restarted.lag_snapshot(start + 154 * 60)["due"])
        snapshot = restarted.lag_snapshot(start + 156 * 60)
        self.assertTrue(snapshot["due"])
        self.assertEqual(snapshot["inactive_minutes"], 31)
        self.assertEqual(snapshot["behind_minutes"], 1)


if __name__ == "__main__":
    unittest.main()
