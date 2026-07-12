from __future__ import annotations

import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from breakguard_secrets import protect_secret, unprotect_secret
from breakguard_schedule import CoursePlanner
from breakguard_state import BreakStateMachine
from breakguard_storage import BreakGuardStore


class BreakGuardCoreTests(unittest.TestCase):
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

    def test_secret_round_trip(self):
        protected = protect_secret("local-test-token")
        self.assertNotIn("local-test-token", protected)
        self.assertEqual(unprotect_secret(protected), "local-test-token")

    def planner(self):
        return CoursePlanner(self.store, 4, 50, 10, "08:00", 20, 30)

    def test_course_completion_persists_daily_progress(self):
        start = datetime(2026, 7, 12, 8, 0).timestamp()
        planner = self.planner()
        session = planner.start_course(start)
        completed, duration = planner.complete_course(start + 50 * 60)
        self.assertEqual(completed.session_id, session.session_id)
        self.assertEqual(duration, 3000)
        restarted = CoursePlanner(BreakGuardStore(self.database), 4, 50, 10, "08:00", 20, 30)
        summary = restarted.summary(start + 3600)
        self.assertEqual(summary["completed_lessons"], 1)
        self.assertEqual(summary["study_seconds"], 3000)

    def test_active_course_survives_restart(self):
        start = datetime(2026, 7, 12, 9, 0).timestamp()
        planner = self.planner()
        session = planner.start_course(start)
        restored = CoursePlanner(BreakGuardStore(self.database), 4, 50, 10, "08:00", 20, 30)
        self.assertEqual(restored.session.session_id, session.session_id)
        self.assertEqual(restored.course_elapsed(start + 600), 600)

    def test_schedule_slots_include_class_and_break_cadence(self):
        now = datetime(2026, 7, 12, 7, 0).timestamp()
        slots = self.planner().schedule_slots(now)
        self.assertEqual((slots[0]["start_text"], slots[0]["end_text"]), ("08:00", "08:50"))
        self.assertEqual((slots[1]["start_text"], slots[1]["end_text"]), ("09:00", "09:50"))

    def test_lag_reminder_repeats_only_after_cooldown(self):
        due = datetime(2026, 7, 12, 9, 11).timestamp()
        planner = self.planner()
        snapshot = planner.lag_snapshot(due)
        self.assertTrue(snapshot["due"])
        self.assertEqual(snapshot["lesson_number"], 1)
        planner.mark_lag_reminded(1, due)
        self.assertFalse(planner.lag_snapshot(due + 29 * 60)["due"])
        self.assertTrue(planner.lag_snapshot(due + 31 * 60)["due"])

    def test_meal_pause_suppresses_progress_warning_until_next_course(self):
        now = datetime(2026, 7, 12, 12, 0).timestamp()
        planner = self.planner()
        planner.set_pause("午饭", now)
        self.assertFalse(planner.lag_snapshot(now)["due"])
        planner.start_course(now + 60)
        self.assertEqual(planner.summary(now + 60)["paused_label"], "")


if __name__ == "__main__":
    unittest.main()
