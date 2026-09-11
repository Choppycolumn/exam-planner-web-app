from __future__ import annotations

import sys
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from seatbot.runtime import WorkerRuntime
from seatbot.work_schedule import next_wake_plan


TZ = ZoneInfo("Asia/Shanghai")


def job_for(day: str, **overrides):
    job = {
        "id": "test-job",
        "date": day,
        "day_offset": None,
        "start_time": "08:30",
        "status": "pending",
        "next_attempt_at": None,
        "result": None,
    }
    job.update(overrides)
    return job


class WorkScheduleTests(unittest.TestCase):
    def test_no_jobs_stays_idle(self):
        plan = next_wake_plan([], "Asia/Shanghai", datetime(2026, 9, 9, 12, 0, tzinfo=TZ))
        self.assertIsNone(plan.at)
        self.assertEqual(plan.reason, "idle")

    def test_far_future_job_preflights_ten_minutes_before_window(self):
        now = datetime(2026, 9, 9, 12, 0, tzinfo=TZ)
        plan = next_wake_plan([job_for("2026-09-13")], "Asia/Shanghai", now)
        self.assertEqual(plan.reason, "preflight")
        self.assertEqual(plan.at, datetime(2026, 9, 10, 23, 50, tzinfo=TZ))

    def test_preflight_done_waits_for_window_entry(self):
        now = datetime(2026, 9, 10, 23, 51, tzinfo=TZ)
        checked = datetime(2026, 9, 10, 23, 50, tzinfo=TZ).astimezone(timezone.utc).isoformat()
        plan = next_wake_plan(
            [job_for("2026-09-13", preflight_checked_at=checked)],
            "Asia/Shanghai",
            now,
        )
        self.assertEqual(plan.reason, "reservation")
        self.assertEqual(plan.at, datetime(2026, 9, 11, 0, 0, tzinfo=TZ))

    def test_same_day_job_is_due_immediately(self):
        now = datetime(2026, 9, 9, 7, 20, tzinfo=TZ)
        plan = next_wake_plan([job_for("2026-09-09")], "Asia/Shanghai", now)
        self.assertEqual(plan.reason, "reservation")
        self.assertEqual(plan.at, now)

    def test_reservation_retry_waits_until_next_attempt(self):
        now = datetime(2026, 9, 9, 7, 20, tzinfo=TZ)
        retry = now + timedelta(minutes=1)
        plan = next_wake_plan(
            [job_for("2026-09-09", status="ready", next_attempt_at=retry.astimezone(timezone.utc).isoformat())],
            "Asia/Shanghai",
            now,
        )
        self.assertEqual(plan.at, retry)

    def test_checkin_waits_until_reservation_start(self):
        now = datetime(2026, 9, 9, 7, 20, tzinfo=TZ)
        plan = next_wake_plan(
            [job_for("2026-09-09", status="success", result={"checkin": "scheduled"})],
            "Asia/Shanghai",
            now,
        )
        self.assertEqual(plan.reason, "checkin")
        self.assertEqual(plan.at, datetime(2026, 9, 9, 8, 30, tzinfo=TZ))

    def test_checkin_attempt_cap_is_processed_without_another_remote_schedule(self):
        now = datetime(2026, 9, 9, 8, 40, tzinfo=TZ)
        plan = next_wake_plan(
            [
                job_for(
                    "2026-09-09",
                    status="success",
                    result={"checkin": "pending", "checkin_attempts": 3},
                )
            ],
            "Asia/Shanghai",
            now,
        )
        self.assertEqual(plan.reason, "checkin")
        self.assertEqual(plan.at, now)

    def test_manual_checkin_does_not_schedule_background_requests(self):
        now = datetime(2026, 9, 9, 8, 40, tzinfo=TZ)
        plan = next_wake_plan(
            [job_for("2026-09-09", status="success", result={"checkin": "manual"})],
            "Asia/Shanghai",
            now,
        )
        self.assertIsNone(plan.at)
        self.assertEqual(plan.reason, "idle")


class WorkerRuntimeTests(unittest.TestCase):
    def test_wake_interrupts_an_indefinite_idle_wait(self):
        runtime = WorkerRuntime()
        revision = runtime.revision()
        result = []

        thread = threading.Thread(target=lambda: result.append(runtime.wait_after(revision, 1.0)))
        thread.start()
        time.sleep(0.02)
        runtime.wake("new job")
        thread.join(timeout=1.0)

        self.assertEqual(result, [True])


if __name__ == "__main__":
    unittest.main()
