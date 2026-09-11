from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from seatbot.api import SeatbotAPI, replacement_job_body
    from seatbot.config import Config
    from seatbot.jobs import list_jobs
    from seatbot.runtime import WorkerRuntime

    IMPORT_ERROR = None
except ModuleNotFoundError as exc:
    IMPORT_ERROR = exc


BOOK = {
    "id": 4317356,
    "no": "202609110238",
    "status": 3,
    "beginTime": {"date": "2026-09-11 09:00:17"},
    "endTime": {"date": "2026-09-11 22:00:00"},
    "spaceDetailInfo": {
        "id": 5904,
        "no": "017",
        "area": 84,
        "areaInfo": {"id": 84, "name": "203"},
    },
}


@unittest.skipIf(IMPORT_ERROR is not None, f"seatbot dependencies unavailable: {IMPORT_ERROR}")
class ReplacementBookingTests(unittest.TestCase):
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

    def test_extracts_exact_seat_and_session(self):
        body = replacement_job_body(BOOK)
        self.assertEqual(body["area_id"], 84)
        self.assertEqual(body["seat_nos"], ["017"])
        self.assertEqual(body["date"], "2026-09-11")
        self.assertEqual(body["start_time"], "09:00")
        self.assertEqual(body["end_time"], "22:00")
        self.assertFalse(body["fallback_any_free"])

    def test_cancel_then_queues_same_seat_replacement(self):
        before = self.runtime.revision()
        seat = SimpleNamespace(no="017")
        with (
            patch("seatbot.api.YitClient", return_value=object()),
            patch("seatbot.api.load_session"),
            patch("seatbot.api.login_with_captcha", return_value=object()),
            patch("seatbot.api.list_books", return_value=[BOOK]),
            patch("seatbot.api.fetch_segment", return_value=object()),
            patch("seatbot.api.fetch_spaces", return_value=[seat]),
            patch("seatbot.api.cancel_book", return_value={"status": 1}) as cancel,
        ):
            code, raw, _ = self.api.handle("POST", "/api/books/4317356/replace", b"{}")

        payload = json.loads(raw)
        self.assertEqual(code, 202)
        self.assertTrue(payload["cancelled"])
        cancel.assert_called_once()
        [job] = list_jobs(self.jobs_path)
        self.assertEqual(job["kind"], "replacement")
        self.assertEqual(job["source_book_id"], "4317356")
        self.assertEqual(job["area_id"], 84)
        self.assertEqual(job["seat_nos"], ["017"])
        self.assertGreater(self.runtime.revision(), before)

    def test_invalid_source_does_not_cancel(self):
        invalid = {**BOOK, "spaceDetailInfo": {}}
        with (
            patch("seatbot.api.YitClient", return_value=object()),
            patch("seatbot.api.load_session"),
            patch("seatbot.api.login_with_captcha", return_value=object()),
            patch("seatbot.api.list_books", return_value=[invalid]),
            patch("seatbot.api.cancel_book") as cancel,
        ):
            code, raw, _ = self.api.handle("POST", "/api/books/4317356/replace", b"{}")

        self.assertEqual(code, 409)
        self.assertIn("缺少房间或座位信息", json.loads(raw)["error"])
        cancel.assert_not_called()


if __name__ == "__main__":
    unittest.main()
