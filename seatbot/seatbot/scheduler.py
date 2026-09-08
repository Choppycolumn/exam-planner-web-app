from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

log = logging.getLogger("seatbot")


def _zone(tz_name: str):
    """Windows 上无 tzdata 时 ZoneInfo('Asia/Shanghai') 会失败，做兜底。"""
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(tz_name)
    except Exception as exc:
        log.warning("时区 %s 不可用 (%s)，改用 UTC+8 固定偏移", tz_name, exc)
        return timezone(timedelta(hours=8), name=tz_name or "UTC+8")


def next_run(hms: str, tz_name: str, clock_offset: float = 0.0) -> datetime:
    """计算下一次 grab_at（北京时间语义）。"""
    tz = _zone(tz_name)
    now = datetime.now(tz) + timedelta(seconds=clock_offset)
    parts = [int(x) for x in hms.split(":")]
    hh = parts[0] if len(parts) > 0 else 0
    mm = parts[1] if len(parts) > 1 else 0
    ss = parts[2] if len(parts) > 2 else 0
    target = now.replace(hour=hh, minute=mm, second=ss, microsecond=0)
    if target <= now:
        target = target + timedelta(days=1)
    return target


def wait_until(target: datetime, tz_name: str, clock_offset: float = 0.0) -> None:
    tz = _zone(tz_name)
    while True:
        now = datetime.now(tz) + timedelta(seconds=clock_offset)
        remain = (target - now).total_seconds()
        if remain <= 0:
            return
        if remain > 60:
            log.info("距开抢还有 %.0f 秒", remain)
            time.sleep(min(30.0, remain - 5))
        else:
            time.sleep(min(0.2, remain))
