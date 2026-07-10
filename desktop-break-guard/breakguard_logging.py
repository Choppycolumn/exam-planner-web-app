from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler

from breakguard_runtime import LOG_FILE

logger = logging.getLogger("break_guard")
if not logger.handlers:
    logger.setLevel(logging.INFO)
    handler = RotatingFileHandler(LOG_FILE, maxBytes=512 * 1024, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(threadName)s %(message)s"))
    logger.addHandler(handler)


def log_error(message: str, exc: BaseException | None = None) -> None:
    logger.error(message, exc_info=(type(exc), exc, exc.__traceback__) if exc else None)
