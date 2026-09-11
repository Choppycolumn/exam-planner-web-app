from __future__ import annotations

import json
import logging
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

from .client import GatewayError, YitClient
from .accounts import (
    apply_active_to_config,
    ensure_from_config,
    jobs_name_for,
    load_store,
    public_list,
    remove_account,
    upsert_account,
)
from .config import Config, load_config
from .pause import pause as set_pause, resume as clear_pause, state as pause_state
from .jobs import (
    add_job,
    add_jobs_range,
    cancel_job,
    delete_job,
    get_job,
    in_bookable_window,
    list_jobs,
    resolve_job_date,
)
from .login import login_with_captcha
from .runtime import WorkerRuntime
from .seats import BookError, book_action, cancel_book, fetch_segment, fetch_spaces, list_books
from .session import load_session, resolve_session_path

log = logging.getLogger("seatbot")


def _json_bytes(obj: Any, code: int = 200) -> tuple[int, bytes, str]:
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    return code, body, "application/json; charset=utf-8"


def _date_text(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("date") or ""
    return str(value or "").strip()


def replacement_job_body(book: dict[str, Any]) -> dict[str, Any]:
    """Extract a same-seat, same-session replacement job from a provider book."""
    detail = book.get("spaceDetailInfo") or {}
    if not isinstance(detail, dict):
        detail = {}
    area_info = detail.get("areaInfo") or {}
    if not isinstance(area_info, dict):
        area_info = {}

    area_id = int(detail.get("area") or area_info.get("id") or 0)
    seat_no = str(detail.get("no") or detail.get("name") or "").strip()
    begin = _date_text(book.get("beginTime"))
    end = _date_text(book.get("endTime"))
    try:
        begin_at = datetime.fromisoformat(begin)
        end_at = datetime.fromisoformat(end)
    except ValueError as exc:
        raise BookError("当前预约缺少可识别的起止时间") from exc
    if not area_id or not seat_no:
        raise BookError("当前预约缺少房间或座位信息，无法安全重约")
    if begin_at.date() != end_at.date():
        raise BookError("当前预约跨越多个日期，无法自动重约")

    return {
        "kind": "replacement",
        "source_book_id": str(book.get("id") or ""),
        "source_order_no": str(book.get("no") or ""),
        "area_id": area_id,
        "seat_nos": [seat_no],
        "date": begin_at.date().isoformat(),
        "start_time": begin_at.strftime("%H:%M"),
        "end_time": end_at.strftime("%H:%M"),
        "fallback_any_free": False,
        "max_retries": 10,
        "retry_interval_sec": 15,
    }


class SeatbotAPI:
    def __init__(
        self,
        cfg: Config,
        root: Path,
        jobs_path: Path,
        runtime: WorkerRuntime | None = None,
        recover_session: Callable[[], bool] | None = None,
        start_full_login: Callable[[], bool] | None = None,
    ) -> None:
        self.cfg = cfg
        self.root = root
        self.jobs_path = jobs_path
        self.web_root = root / "web"
        self.config_path = root / "config.yaml"
        self.runtime = runtime or WorkerRuntime()
        self.recover_session = recover_session
        self.start_full_login = start_full_login
        self._replace_lock = threading.Lock()
        try:
            ensure_from_config(root, self.config_path)
        except Exception:
            pass

    def _reload(self) -> None:
        try:
            self.cfg = load_config(self.config_path, require_account=False)
            store = load_store(self.root)
            active = str(store.get("active") or self.cfg.username or "")
            if active:
                self.jobs_path = self.root / jobs_name_for(active)
        except Exception:
            pass

    def handle(self, method: str, path: str, body: bytes) -> tuple[int, bytes, str]:
        parsed = urlparse(path)
        route = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query)
        self._reload()

        if method == "GET" and route in ("/", "/index.html"):
            return self._static("index.html")
        if method == "GET" and route.startswith("/assets/"):
            return self._static(route[1:])

        if method == "GET" and route == "/api/accounts":
            return self._accounts()
        if method == "POST" and route == "/api/accounts":
            return self._add_account(body)
        if method == "POST" and route == "/api/accounts/switch":
            return self._switch_account(body)
        if method == "DELETE" and route.startswith("/api/accounts/"):
            return self._del_account(route.split("/")[-1])
        if method == "GET" and route == "/api/status":
            return self._status()
        if method == "POST" and route == "/api/pause":
            st = set_pause(self.root, 300)
            return _json_bytes({"ok": True, **st})
        if method == "POST" and route == "/api/resume":
            st = clear_pause(self.root)
            self.runtime.wake("预约服务已恢复")
            return _json_bytes({"ok": True, **st})
        if method == "POST" and route == "/api/login/full":
            clear_pause(self.root)
            started = bool(self.start_full_login and self.start_full_login())
            if not started:
                return _json_bytes({"ok": False, "error": "完整登录服务未能启动"}, 503)
            self.runtime.update(
                worker_mode="recovering",
                worker_reason="正在执行完整登录",
            )
            return _json_bytes({"ok": True, "started": True}, 202)
        if method == "GET" and route == "/api/jobs":
            jobs = list_jobs(self.jobs_path)
            for j in jobs:
                try:
                    j["target_date"] = resolve_job_date(j, self.cfg.timezone).isoformat()
                    j["in_window"] = in_bookable_window(j, self.cfg.timezone)
                except Exception:
                    j["target_date"] = None
                    j["in_window"] = False
            return _json_bytes({"ok": True, "jobs": jobs})
        if method == "POST" and route == "/api/jobs":
            try:
                data = json.loads(body.decode("utf-8") or "{}")
                if data.get("date_to") or data.get("date_from"):
                    jobs = add_jobs_range(self.jobs_path, data)
                    self.runtime.wake("新增预约任务")
                    return _json_bytes({"ok": True, "jobs": jobs, "count": len(jobs)}, 201)
                job = add_job(self.jobs_path, data)
                self.runtime.wake("新增预约任务")
                return _json_bytes({"ok": True, "job": job}, 201)
            except Exception as exc:
                return _json_bytes({"ok": False, "error": str(exc)}, 400)
        if method == "POST" and route.startswith("/api/jobs/") and route.endswith("/cancel"):
            job_id = route.split("/")[3]
            ok = cancel_job(self.jobs_path, job_id)
            self.runtime.wake("预约任务已取消")
            return _json_bytes({"ok": ok})
        if method == "DELETE" and route.startswith("/api/jobs/"):
            job_id = route.split("/")[3]
            ok = delete_job(self.jobs_path, job_id)
            self.runtime.wake("预约任务已删除")
            return _json_bytes({"ok": ok})
        if method == "GET" and route == "/api/areas":
            return self._areas()
        if method == "GET" and route == "/api/spaces":
            return self._spaces(qs)
        if method == "GET" and route == "/api/books":
            return self._books(qs)
        if method == "POST" and route.startswith("/api/books/") and route.endswith("/cancel"):
            book_id = route.split("/")[3]
            return self._cancel_book(book_id)
        if method == "POST" and route.startswith("/api/books/") and route.endswith("/replace"):
            book_id = route.split("/")[3]
            return self._replace_book(book_id)
        if method == "POST" and route.startswith("/api/books/") and route.split("/")[-1] in ("checkin", "leave", "checkout"):
            book_id = route.split("/")[3]
            action = route.split("/")[-1]
            return self._book_action(book_id, action)

        # SPA fallback for static
        if method == "GET":
            name = route.lstrip("/")
            if name and (self.web_root / name).is_file():
                return self._static(name)

        return _json_bytes({"ok": False, "error": "not found"}, 404)

    def _static(self, rel: str) -> tuple[int, bytes, str]:
        path = (self.web_root / rel).resolve()
        if not str(path).startswith(str(self.web_root.resolve())) or not path.is_file():
            return _json_bytes({"ok": False, "error": "missing"}, 404)
        data = path.read_bytes()
        ctype = "text/html; charset=utf-8"
        if rel.endswith(".js"):
            ctype = "application/javascript"
        elif rel.endswith(".css"):
            ctype = "text/css"
        elif rel.endswith(".json"):
            ctype = "application/json"
        return 200, data, ctype

    def _accounts(self) -> tuple[int, bytes, str]:
        store = load_store(self.root)
        pub = public_list(store)
        for item in pub["accounts"]:
            sess = self.root / f"session-{item['username']}.json"
            # also common session-safe name
            from .accounts import session_name_for
            sess = self.root / session_name_for(item["username"])
            item["has_session"] = sess.exists()
        return _json_bytes({"ok": True, **pub, "username": self.cfg.username})

    def _add_account(self, body: bytes) -> tuple[int, bytes, str]:
        try:
            data = json.loads(body.decode("utf-8") or "{}")
            upsert_account(
                self.root,
                username=str(data.get("username") or ""),
                password=str(data.get("password") or ""),
                label=str(data.get("label") or ""),
            )
            self.runtime.wake("预约账号已更新")
            return _json_bytes({"ok": True})
        except Exception as exc:
            return _json_bytes({"ok": False, "error": str(exc)}, 400)

    def _switch_account(self, body: bytes) -> tuple[int, bytes, str]:
        try:
            data = json.loads(body.decode("utf-8") or "{}")
            username = str(data.get("username") or "").strip()
            acc = apply_active_to_config(self.root, self.config_path, username)
            self._reload()
            self.runtime.wake("预约账号已切换")
            return _json_bytes({"ok": True, "username": acc["username"], "label": acc.get("label")})
        except Exception as exc:
            return _json_bytes({"ok": False, "error": str(exc)}, 400)

    def _del_account(self, username: str) -> tuple[int, bytes, str]:
        try:
            store = remove_account(self.root, username)
            apply_active_to_config(self.root, self.config_path, store["active"])
            self._reload()
            self.runtime.wake("预约账号已删除")
            return _json_bytes({"ok": True, "active": store["active"]})
        except Exception as exc:
            return _json_bytes({"ok": False, "error": str(exc)}, 400)

    def _status(self) -> tuple[int, bytes, str]:
        store = resolve_session_path(self.root, self.cfg.session_file)
        has_session = store.exists()
        return _json_bytes(
            {
                "ok": True,
                "session": has_session,
                **self.runtime.snapshot(),
                "area_id": self.cfg.area_id,
                "jobs_count": len(list_jobs(self.jobs_path)),
                "username": self.cfg.username,
                **pause_state(self.root),
            }
        )

    def _areas(self) -> tuple[int, bytes, str]:
        try:
            client = YitClient(self.cfg)
            store = resolve_session_path(self.root, self.cfg.session_file)
            load_session(client, store)
            payload = client.get_json("/api.php/areas")
            raw = ((payload.get("data") or {}).get("list") or {}).get("childArea") or []
            items = []
            for a in raw:
                items.append({
                    "id": a.get("id"),
                    "name": str(a.get("name") or "").strip(),
                    "parent_id": a.get("parentId"),
                    "type": a.get("type"),
                    "valid": int(a.get("isValid") or 0) == 1,
                    "seats": a.get("TotalCount"),
                })
            return _json_bytes({"ok": True, "areas": items})
        except Exception as exc:
            return _json_bytes({"ok": False, "error": str(exc)}, 500)

    def _spaces(self, qs: dict) -> tuple[int, bytes, str]:
        try:
            area_id = int((qs.get("area_id") or [self.cfg.area_id])[0])
            day_offset = int((qs.get("day_offset") or [1])[0])
            client = YitClient(self.cfg)
            store = resolve_session_path(self.root, self.cfg.session_file)
            load_session(client, store)
            auth = login_with_captcha(client, dump_dir=self.root / "logs")
            from datetime import datetime, timedelta
            try:
                from zoneinfo import ZoneInfo
                today = datetime.now(ZoneInfo(self.cfg.timezone)).date()
            except Exception:
                today = datetime.now().date()
            target = today + timedelta(days=day_offset)
            preview = False
            try:
                seg = fetch_segment(
                    client, area_id, target, self.cfg.start_time, self.cfg.end_time
                )
            except Exception:
                if day_offset > 2:
                    # 大后天尚未放座：只用已开放日的布局，不沿用当天占用
                    preview = True
                    seg = fetch_segment(
                        client, area_id, today, self.cfg.start_time, self.cfg.end_time
                    )
                else:
                    raise
            spaces = fetch_spaces(client, seg)
            return _json_bytes(
                {
                    "ok": True,
                    "day": target.isoformat(),
                    "segment": 0 if preview else seg.id,
                    "preview": preview,
                    "spaces": [
                        {
                            "id": s.id,
                            "no": s.no,
                            "status": 0 if preview else s.status,
                            "free": False if preview else s.free,
                            "open": not preview,
                            "status_name": "未开放预约" if preview else s.status_name,
                            "x": s.x,
                            "y": s.y,
                            "w": s.w,
                            "h": s.h,
                        }
                        for s in spaces
                    ],
                }
            )
        except Exception as exc:
            return _json_bytes({"ok": False, "error": str(exc)}, 500)

    def _books(self, qs: dict) -> tuple[int, bytes, str]:
        try:
            page = int((qs.get("page") or [1])[0])
            client = YitClient(self.cfg)
            store = resolve_session_path(self.root, self.cfg.session_file)
            load_session(client, store)
            auth = login_with_captcha(client, dump_dir=self.root / "logs")
            items = list_books(client, auth, page=page)
            books = []
            for it in items:
                begin = it.get("beginTime") or {}
                end = it.get("endTime") or {}
                if isinstance(begin, dict):
                    begin = begin.get("date") or ""
                if isinstance(end, dict):
                    end = end.get("date") or ""
                space = it.get("spaceInfo") or {}
                space_name = ""
                if isinstance(space, dict):
                    area = space.get("areaInfo") or {}
                    space_name = " ".join(
                        x for x in (area.get("nameMerge"), space.get("no") or space.get("name")) if x
                    )
                else:
                    space_name = str(space)
                st = int(it.get("status") or 0)
                sub = int(it.get("substatus") or 0)
                submsg = str(it.get("submsg") or "")
                name = str(it.get("statusName") or submsg or "")
                in_use = st == 3
                away = in_use and (sub == 2 or "临时" in submsg or "临时" in name)
                cancellable = st in (1, 2, 3)
                try:
                    replacement_job_body(it)
                    replaceable = cancellable
                except Exception:
                    replaceable = False
                books.append(
                    {
                        "id": it.get("id"),
                        "no": it.get("no"),
                        "status": st,
                        "substatus": sub,
                        "submsg": submsg,
                        "status_name": name + ((" · " + submsg) if submsg and submsg not in name else ""),
                        "space_info": space_name or space,
                        "segment": it.get("bookTimeSegment"),
                        "begin": begin,
                        "end": end,
                        "sign_in": it.get("signIn"),
                        "sign_out": it.get("signOut"),
                        "can_checkin": away or (st in (1, 2) and not it.get("signIn")),
                        "can_leave": in_use and not away,
                        "can_checkout": in_use,
                        "cancellable": cancellable,
                        "replaceable": replaceable,
                    }
                )
            return _json_bytes({"ok": True, "books": books})
        except GatewayError:
            started = bool(self.recover_session and self.recover_session())
            self.runtime.update(
                worker_mode="recovering",
                worker_reason="刷新预约列表时正在恢复统一认证",
            )
            return _json_bytes(
                {
                    "ok": False,
                    "recovering": started,
                    "error": "统一认证会话已失效，正在自动恢复并重试预约列表",
                },
                503,
            )
        except Exception as exc:
            return _json_bytes({"ok": False, "error": str(exc)}, 500)

    def _book_action(self, book_id: str, action: str) -> tuple[int, bytes, str]:
        try:
            client = YitClient(self.cfg)
            store = resolve_session_path(self.root, self.cfg.session_file)
            load_session(client, store)
            auth = login_with_captcha(client, dump_dir=self.root / "logs")
            result = book_action(client, auth, book_id, action)
            msg = str((result or {}).get("msg") or "ok")
            return _json_bytes({"ok": True, "msg": msg, "result": result})
        except Exception as exc:
            return _json_bytes({"ok": False, "error": str(exc)}, 500)

    def _cancel_book(self, book_id: str) -> tuple[int, bytes, str]:
        try:
            client = YitClient(self.cfg)
            store = resolve_session_path(self.root, self.cfg.session_file)
            load_session(client, store)
            auth = login_with_captcha(client, dump_dir=self.root / "logs")
            result = cancel_book(client, auth, book_id)
            return _json_bytes({"ok": True, "result": result})
        except Exception as exc:
            return _json_bytes({"ok": False, "error": str(exc)}, 500)

    def _replace_book(self, book_id: str) -> tuple[int, bytes, str]:
        if not self._replace_lock.acquire(blocking=False):
            return _json_bytes({"ok": False, "error": "已有取消并重约操作正在执行"}, 409)
        try:
            for existing in list_jobs(self.jobs_path):
                if (
                    str(existing.get("source_book_id") or "") == str(book_id)
                    and existing.get("status") in ("pending", "ready")
                ):
                    return _json_bytes(
                        {
                            "ok": False,
                            "error": f"该预约已有重约任务 #{existing.get('id')}，请勿重复操作",
                        },
                        409,
                    )

            client = YitClient(self.cfg)
            store = resolve_session_path(self.root, self.cfg.session_file)
            load_session(client, store)
            auth = login_with_captcha(client, dump_dir=self.root / "logs")
            source = next(
                (item for item in list_books(client, auth, page=1) if str(item.get("id")) == str(book_id)),
                None,
            )
            if not source:
                return _json_bytes({"ok": False, "error": "未找到当前预约，请刷新后重试"}, 404)
            if int(source.get("status") or 0) not in (1, 2, 3):
                return _json_bytes({"ok": False, "error": "该预约已结束或不可取消，无法重约"}, 409)

            job_body = replacement_job_body(source)
            target = datetime.fromisoformat(job_body["date"]).date()
            segment = fetch_segment(
                client,
                job_body["area_id"],
                target,
                job_body["start_time"],
                job_body["end_time"],
            )
            seat_no = job_body["seat_nos"][0]
            if not any(str(space.no).zfill(3) == str(seat_no).zfill(3) for space in fetch_spaces(client, segment)):
                return _json_bytes({"ok": False, "error": "预约区域中已找不到原座位，未执行取消"}, 409)

            cancel_book(client, auth, book_id)
            try:
                job = add_job(self.jobs_path, job_body)
            except Exception as exc:
                log.exception("预约 %s 已取消，但创建重约任务失败", book_id)
                return _json_bytes(
                    {
                        "ok": False,
                        "cancelled": True,
                        "error": f"原预约已取消，但重约任务创建失败：{exc}",
                    },
                    500,
                )
            self.runtime.wake("原预约已取消，正在重约同一座位")
            return _json_bytes(
                {
                    "ok": True,
                    "cancelled": True,
                    "queued": True,
                    "job": job,
                    "message": f"原预约已取消，重约任务 #{job['id']} 已启动",
                },
                202,
            )
        except GatewayError:
            started = bool(self.recover_session and self.recover_session())
            return _json_bytes(
                {
                    "ok": False,
                    "recovering": started,
                    "error": "统一认证会话已失效，正在恢复；本次未执行取消",
                },
                503,
            )
        except BookError as exc:
            return _json_bytes({"ok": False, "error": str(exc)}, 409)
        except Exception as exc:
            return _json_bytes({"ok": False, "error": str(exc)}, 500)
        finally:
            self._replace_lock.release()


def make_handler(api: SeatbotAPI):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: Any) -> None:
            log.debug("api " + fmt, *args)

        def _read_body(self) -> bytes:
            n = int(self.headers.get("Content-Length") or 0)
            return self.rfile.read(n) if n else b""

        def _send(self, code: int, body: bytes, ctype: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self._send(204, b"", "text/plain")

        def do_GET(self) -> None:  # noqa: N802
            code, body, ctype = api.handle("GET", self.path, b"")
            self._send(code, body, ctype)

        def do_POST(self) -> None:  # noqa: N802
            code, body, ctype = api.handle("POST", self.path, self._read_body())
            self._send(code, body, ctype)

        def do_DELETE(self) -> None:  # noqa: N802
            code, body, ctype = api.handle("DELETE", self.path, b"")
            self._send(code, body, ctype)

    return Handler


def serve_api(
    cfg: Config,
    root: Path,
    jobs_path: Path,
    host: str = "127.0.0.1",
    port: int = 8766,
    runtime: WorkerRuntime | None = None,
    recover_session: Callable[[], bool] | None = None,
    start_full_login: Callable[[], bool] | None = None,
) -> ThreadingHTTPServer:
    api = SeatbotAPI(
        cfg,
        root,
        jobs_path,
        runtime=runtime,
        recover_session=recover_session,
        start_full_login=start_full_login,
    )
    server = ThreadingHTTPServer((host, port), make_handler(api))
    log.info("API 监听 http://%s:%s  (面板 / )", host, port)
    return server
