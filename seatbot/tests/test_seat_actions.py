from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from seatbot.seats import BookError, cancel_book

    IMPORT_ERROR = None
except ModuleNotFoundError as exc:
    IMPORT_ERROR = exc


class FakeClient:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def post_form(self, path, data):
        self.calls.append((path, data))
        return self.payload


@unittest.skipIf(IMPORT_ERROR is not None, f"seatbot dependencies unavailable: {IMPORT_ERROR}")
class SeatActionTests(unittest.TestCase):
    def test_cancel_uses_kiosk_delete_action(self):
        client = FakeClient({"status": 1, "msg": "取消成功"})
        auth = SimpleNamespace(userid="user", access_token="secret")

        result = cancel_book(client, auth, "4316146")

        self.assertEqual(result["status"], 1)
        self.assertEqual(len(client.calls), 1)
        path, data = client.calls[0]
        self.assertEqual(path, "/api.php/profile/books/4316146")
        self.assertEqual(data["_method"], "delete")
        self.assertEqual(data["id"], "4316146")

    def test_cancel_surfaces_provider_error(self):
        client = FakeClient({"status": 0, "msg": "预约状态不允许取消"})
        auth = SimpleNamespace(userid="user", access_token="secret")

        with self.assertRaisesRegex(BookError, "预约状态不允许取消"):
            cancel_book(client, auth, "4316146")


if __name__ == "__main__":
    unittest.main()
