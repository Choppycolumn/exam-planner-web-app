from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from .client import YitClient
from .login import Auth

log = logging.getLogger("seatbot")


class BookError(RuntimeError):
    pass


@dataclass
class Segment:
    id: int
    compact_day: str
    start_time: str
    end_time: str
    area_id: int


@dataclass
class Space:
    id: int
    no: str
    status: int
    status_name: str
    x: float | None = None
    y: float | None = None
    w: float | None = None
    h: float | None = None

    @property
    def free(self) -> bool:
        return self.status == 1


def compact_date(d: date) -> str:
    return f"{d.year}-{d.month}-{d.day}"


def resolve_target_date(date_str: str, day_offset: int, tz_name: str) -> date:
    if date_str:
        parts = date_str.replace("/", "-").split("-")
        if len(parts) != 3:
            raise BookError(f"日期格式错误: {date_str}")
        y, m, d = (int(parts[0]), int(parts[1]), int(parts[2]))
        return date(y, m, d)
    now = datetime.now(ZoneInfo(tz_name)).date()
    return now + timedelta(days=day_offset)


def _hm(value: Any, fallback: str = "") -> str:
    """从字符串或 {date: 'YYYY-MM-DD HH:MM:SS'} 里抽出 HH:MM。"""
    if value is None:
        return fallback
    if isinstance(value, dict):
        value = value.get("date") or value.get("time") or ""
    text = str(value).strip()
    # '2026-08-22 08:30:00' or '08:30'
    if " " in text:
        text = text.split(" ", 1)[1]
    return text[:5] if len(text) >= 5 else (text or fallback)


def _norm_day(day: str) -> str:
    try:
        y, m, d = day.replace("/", "-").split("-")[:3]
        return f"{int(y)}-{int(m)}-{int(d)}"
    except Exception:
        return day


def fetch_segment(
    client: YitClient,
    area_id: int,
    target: date,
    start_time: str,
    end_time: str,
) -> Segment:
    referer = client.url(f"/home/web/seat/area/{area_id}")
    payload = client.get_json(f"/api.php/v3areadays/{area_id}", referer=referer)
    if int(payload.get("status") or 0) != 1:
        raise BookError(f"获取时段失败: {payload.get('msg') or payload}")
    items = (payload.get("data") or {}).get("list") or payload.get("data") or []
    if isinstance(items, dict):
        items = list(items.values()) if items else []
    day_key = compact_date(target)
    want_st = start_time[:5]
    want_et = end_time[:5]
    open_alias = {"08:00", "08:30"}
    close_alias = {"21:59", "22:00"}

    def _st_ok(got: str, want: str) -> bool:
        g, w = (got or "")[:5], (want or "")[:5]
        if g == w:
            return True
        return g in open_alias and w in open_alias

    def _et_ok(got: str, want: str) -> bool:
        g, w = (got or "")[:5], (want or "")[:5]
        if g == w or (g and w and g.startswith(w[:4])):
            return True
        return g in close_alias and w in close_alias

    # 1) 同日 + 起止时间（08:00/08:30、21:59/22:00 视为同一开闭馆）
    for item in items:
        day_norm = _norm_day(str(item.get("day") or item.get("date") or ""))
        if day_norm != day_key:
            continue
        st = _hm(item.get("startTime") or item.get("start_time"), want_st)
        et = _hm(item.get("endTime") or item.get("end_time"), want_et)
        seg_id = int(item.get("id") or item.get("segment") or 0)
        if not seg_id:
            continue
        if _st_ok(st, want_st) and _et_ok(et, want_et):
            return Segment(
                id=seg_id,
                compact_day=day_key,
                start_time=st or want_st,
                end_time=et or want_et,
                area_id=area_id,
            )

    # 2) 宽松：同日任意时段（API 里 startTime.date 常写死成当天，不可靠）
    for item in items:
        day_norm = _norm_day(str(item.get("day") or item.get("date") or ""))
        if day_norm != day_key:
            continue
        seg_id = int(item.get("id") or item.get("segment") or 0)
        if not seg_id:
            continue
        st = _hm(item.get("startTime") or item.get("start_time"), want_st)
        et = _hm(item.get("endTime") or item.get("end_time"), want_et)
        log.warning(
            "按日期匹配时段 segment=%s day=%s %s-%s（未严格校验时刻）",
            seg_id,
            day_key,
            st,
            et,
        )
        return Segment(
            id=seg_id,
            compact_day=day_key,
            start_time=st or want_st,
            end_time=et or want_et,
            area_id=area_id,
        )
    raise BookError(f"未找到时段 area={area_id} day={day_key} {start_time}-{end_time}")


def fetch_spaces(client: YitClient, seg: Segment) -> list[Space]:
    referer = client.url(f"/web/seat3?area={seg.area_id}")
    path = (
        f"/api.php/spaces_old?area={seg.area_id}"
        f"&segment={seg.id}&day={seg.compact_day}"
        f"&startTime={seg.start_time}&endTime={seg.end_time}"
    )
    payload = client.get_json(path, referer=referer)
    if int(payload.get("status") or 0) != 1:
        raise BookError(f"查询座位失败: {payload.get('msg') or payload}")
    data = payload.get("data") or {}
    raw = data.get("list") or data
    if isinstance(raw, dict):
        raw = list(raw.values())
    spaces: list[Space] = []
    for item in raw or []:
        def _f(key):
            try:
                v = item.get(key)
                return float(v) if v is not None and v != "" else None
            except Exception:
                return None
        spaces.append(
            Space(
                id=int(item.get("id") or 0),
                no=str(item.get("no") or item.get("name") or "").strip(),
                status=int(item.get("status") or 0),
                status_name=str(item.get("status_name") or item.get("statusName") or ""),
                x=_f("point_x"),
                y=_f("point_y"),
                w=_f("width"),
                h=_f("height"),
            )
        )
    return spaces


def pick_space(spaces: list[Space], prefer: list[str], fallback_any: bool) -> Space:
    by_no = {s.no.zfill(3) if s.no.isdigit() else s.no: s for s in spaces}
    for no in prefer:
        key = no.zfill(3) if no.isdigit() else no
        seat = by_no.get(key) or by_no.get(no)
        if seat and seat.free:
            return seat
        if seat:
            log.info("座位 %s 不可用: %s", no, seat.status_name or seat.status)
    if fallback_any:
        for s in spaces:
            if s.free:
                log.info("首选均不可用，改约空闲座位 %s", s.no)
                return s
    raise BookError(f"目标座位均不可用: {prefer}")


def book_space(client: YitClient, auth: Auth, seg: Segment, seat: Space) -> dict[str, Any]:
    referer = client.url(f"/web/seat3?area={seg.area_id}")
    payload = client.post_form(
        f"/api.php/spaces/{seat.id}/book",
        {
            "access_token": auth.access_token,
            "userid": auth.userid,
            "segment": str(seg.id),
            "type": "1",
        },
        referer=referer,
    )
    if int(payload.get("status") or 0) != 1:
        raise BookError(str(payload.get("msg") or payload))
    return payload


def list_books(client: YitClient, auth: Auth, page: int = 1) -> list[dict[str, Any]]:
    path = f"/api.php/profile/books?userid={auth.userid}&access_token={auth.access_token}&page={page}"
    payload = client.get_json(path)
    if int(payload.get("status") or 0) != 1:
        raise BookError(str(payload.get("msg") or payload))
    data = payload.get("data") or {}
    items = data.get("list") or []
    if isinstance(items, dict):
        items = [items]
    return list(items or [])


def cancel_book(client: YitClient, auth: Auth, book_id: int | str) -> dict[str, Any]:
    """取消已成功的预约。优先 POST cancel，失败再试 DELETE。"""
    bid = str(book_id)
    data = {"access_token": auth.access_token, "userid": auth.userid, "id": bid}
    # 常见 yitlink 取消路径
    for path in (
        f"/api.php/profile/books/{bid}/cancel",
        f"/api.php/spaces/book/{bid}/cancel",
        "/api.php/profile/booksCancel",
    ):
        try:
            payload = client.post_form(path, data)
            msg = str(payload.get("msg") or "")
            # 成功时常见 msg 含 取消 / status=1 且不是「用户基本信息」
            if int(payload.get("status") or 0) == 1 and (
                "取消" in msg or "成功" in msg or "cancel" in msg.lower()
            ):
                return payload
            if int(payload.get("status") or 0) == 1 and "基本信息" not in msg and "获取用户预约" not in msg:
                return payload
        except Exception as exc:
            log.debug("cancel try %s: %s", path, exc)
    try:
        resp = client.request(
            "DELETE",
            f"/api.php/profile/books/{bid}",
            data=data,
        )
        payload = resp.json()
        if int(payload.get("status") or 0) == 1 or "成功" in str(payload.get("msg") or ""):
            return payload
        raise BookError(str(payload.get("msg") or payload))
    except BookError:
        raise
    except Exception as exc:
        raise BookError(f"取消失败: {exc}") from exc


def book_action(client: YitClient, auth: Auth, book_id: int | str, method: str) -> dict[str, Any]:
    """一体机同款：checkin / leave / checkout / delete。"""
    method = str(method or "").lower().strip()
    if method not in {"checkin", "leave", "checkout", "delete"}:
        raise BookError(f"不支持的操作: {method}")
    bid = str(book_id)
    data = {
        "_method": method,
        "id": bid,
        "userid": auth.userid,
        "access_token": auth.access_token,
    }
    payload = client.post_form(f"/api.php/profile/books/{bid}", data)
    msg = str(payload.get("msg") or "")
    if int(payload.get("status") or 0) == 1:
        return payload
    raise BookError(msg or str(payload))
