from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from seatbot.seats import BookError, book_action, cancel_book

    IMPORT_ERROR = None
except ModuleNotFoundError as exc:
    IMPORT_ERROR = exc


class FakeClient:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def url(self, path):
        return "https://example.test" + path

    def request(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        return SimpleNamespace(url="https://example.test/user/index/book")

    def post_form(self, path, data, **kwargs):
        self.calls.append(("POST", path, data, kwargs))
        return self.payload


@unittest.skipIf(IMPORT_ERROR is not None, f"seatbot dependencies unavailable: {IMPORT_ERROR}")
class SeatActionTests(unittest.TestCase):
    def test_cancel_uses_kiosk_delete_action(self):
        client = FakeClient({"status": 1, "msg": "取消成功"})
        auth = SimpleNamespace(userid="user", access_token="secret")

        result = cancel_book(client, auth, "4316146")

        self.assertEqual(result["status"], 1)
        self.assertEqual(len(client.calls), 2)
        method, prepare_path, prepare_options = client.calls[0]
        self.assertEqual(method, "GET")
        self.assertEqual(prepare_path, "/user/index/index/from/index")
        self.assertIn("referer", prepare_options)
        method, path, data, options = client.calls[1]
        self.assertEqual(method, "POST")
        self.assertEqual(path, "/api.php/profile/books/4316146")
        self.assertEqual(data["_method"], "delete")
        self.assertEqual(data["id"], "4316146")
        self.assertEqual(options["referer"], "https://example.test/user/index/book")

    def test_cancel_surfaces_provider_error(self):
        client = FakeClient({"status": 0, "msg": "预约状态不允许取消"})
        auth = SimpleNamespace(userid="user", access_token="secret")

        with self.assertRaisesRegex(BookError, "预约状态不允许取消"):
            cancel_book(client, auth, "4316146")

    def test_checkout_uses_profile_context(self):
        client = FakeClient({"status": 1, "msg": "签离成功"})
        auth = SimpleNamespace(userid="user", access_token="secret")

        result = book_action(client, auth, "4319283", "checkout")

        self.assertEqual(result["status"], 1)
        self.assertEqual(len(client.calls), 2)
        method, path, data, options = client.calls[1]
        self.assertEqual(method, "POST")
        self.assertEqual(path, "/api.php/profile/books/4319283")
        self.assertEqual(data["_method"], "checkout")
        self.assertEqual(options["referer"], "https://example.test/user/index/book")


if __name__ == "__main__":
    unittest.main()
