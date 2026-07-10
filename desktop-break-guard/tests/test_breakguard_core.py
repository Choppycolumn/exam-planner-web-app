from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from breakguard_secrets import protect_secret, unprotect_secret
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


if __name__ == "__main__":
    unittest.main()
