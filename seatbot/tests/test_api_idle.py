from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from seatbot.api import SeatbotAPI
    from seatbot.config import Config
    from seatbot.runtime import WorkerRuntime

    IMPORT_ERROR = None
except ModuleNotFoundError as exc:  # Local checkout may not have optional seatbot deps.
    IMPORT_ERROR = exc


@unittest.skipIf(IMPORT_ERROR is not None, f"seatbot dependencies unavailable: {IMPORT_ERROR}")
class IdleApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.jobs_path = self.root / "jobs.json"
        self.runtime = WorkerRuntime()
        self.api = SeatbotAPI(
            Config(username="test", password="test"),
            self.root,
            self.jobs_path,
            runtime=self.runtime,
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_status_is_local_only(self):
        with patch("seatbot.api.YitClient", side_effect=AssertionError("network client created")):
            code, body, _ = self.api._status()
        payload = json.loads(body)
        self.assertEqual(code, 200)
        self.assertIsNone(payload["gateway_alive"])
        self.assertEqual(payload["worker_mode"], "starting")

    def test_new_job_wakes_worker(self):
        before = self.runtime.revision()
        body = json.dumps(
            {
                "date": "2026-09-09",
                "area_id": 101,
                "seat_nos": ["001"],
            }
        ).encode()
        code, _, _ = self.api.handle("POST", "/api/jobs", body)
        self.assertEqual(code, 201)
        self.assertGreater(self.runtime.revision(), before)


if __name__ == "__main__":
    unittest.main()
