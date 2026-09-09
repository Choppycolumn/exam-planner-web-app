from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from seatbot.client import _safe_url_for_log

    IMPORT_ERROR = None
except ModuleNotFoundError as exc:
    IMPORT_ERROR = exc


@unittest.skipIf(IMPORT_ERROR is not None, f"seatbot dependencies unavailable: {IMPORT_ERROR}")
class LogRedactionTests(unittest.TestCase):
    def test_sensitive_query_values_are_redacted(self):
        safe = _safe_url_for_log(
            "https://example.test/books?userid=abc&access_token=secret&token=other&page=1"
        )
        self.assertNotIn("secret", safe)
        self.assertNotIn("other", safe)
        self.assertIn("userid=abc", safe)
        self.assertIn("access_token=%5Bredacted%5D", safe)


if __name__ == "__main__":
    unittest.main()
