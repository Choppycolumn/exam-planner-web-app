from __future__ import annotations

import logging
import time
from email.utils import parsedate_to_datetime
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import requests

from .config import Config

log = logging.getLogger("seatbot")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0"
)

_SENSITIVE_QUERY_KEYS = {
    "access_token",
    "token",
    "password",
    "cookie",
    "authorization",
}


def _safe_url_for_log(url: str) -> str:
    parts = urlsplit(url)
    query = urlencode(
        [
            (key, "[redacted]" if key.lower() in _SENSITIVE_QUERY_KEYS else value)
            for key, value in parse_qsl(parts.query, keep_blank_values=True)
        ]
    )
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query, parts.fragment))


class GatewayError(RuntimeError):
    """资源网关把请求踢到了统一身份认证。"""


def _load_cookie_header(session: requests.Session, header: str) -> None:
    for part in header.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        name, value = part.split("=", 1)
        session.cookies.set(name.strip(), value.strip())


class YitClient:
    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.base = cfg.base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "X-Requested-With": "XMLHttpRequest",
                "Origin": cfg.origin if cfg.origin.startswith("http") else "https://libresource.hust.edu.cn",
            }
        )
        if cfg.cookie:
            _load_cookie_header(self.session, cfg.cookie)
        self.clock_offset = 0.0

    def url(self, path: str) -> str:
        if path.startswith("http"):
            return path
        return urljoin(self.base + "/", path.lstrip("/"))

    def _sync_clock(self, resp: requests.Response) -> None:
        date_hdr = resp.headers.get("Date")
        if not date_hdr:
            return
        try:
            server = parsedate_to_datetime(date_hdr).timestamp()
            self.clock_offset = server - resp.elapsed.total_seconds() / 2 - time.time()
        except Exception:
            return

    def _guard(self, resp: requests.Response) -> None:
        final = resp.url or ""
        if "pass.hust.edu.cn" in final or "/cas/login" in final or "/gologin" in final:
            raise GatewayError(
                "请求被重定向到统一身份认证（pass.hust.edu.cn）。"
                "请在本机运行 python main.py --login 后上传 session.json。"
            )
        ctype = (resp.headers.get("Content-Type") or "").lower()
        if "text/html" in ctype and "api.php" in (resp.request.url or ""):
            snippet = resp.text[:180].replace("\n", " ")
            raise GatewayError(f"接口返回 HTML 而非 JSON，可能未通过资源网关。片段: {snippet}")

    def request(
        self,
        method: str,
        path: str,
        *,
        referer: Optional[str] = None,
        **kwargs: Any,
    ) -> requests.Response:
        headers = dict(kwargs.pop("headers", {}) or {})
        if referer:
            headers["Referer"] = referer
        timeout = kwargs.pop("timeout", 15)
        url = self.url(path)
        log.debug("%s %s", method.upper(), _safe_url_for_log(url))
        kwargs.setdefault("allow_redirects", True)
        try:
            resp = self.session.request(
                method, url, headers=headers, timeout=timeout, **kwargs
            )
        except requests.exceptions.TooManyRedirects as exc:
            raise GatewayError(
                "跳转超过上限（通常未通过资源网关，被反复踢到统一认证）。"
                "请重新 login，并确认登录后在 libresource 的 yitlink 座位页。"
            ) from exc
        self._sync_clock(resp)
        self._guard(resp)
        return resp

    def get_json(self, path: str, **kwargs: Any) -> Any:
        resp = self.request("GET", path, **kwargs)
        resp.raise_for_status()
        try:
            return resp.json()
        except ValueError as exc:
            raise GatewayError(f"无法解析 JSON: {resp.text[:200]!r}") from exc

    def post_form(self, path: str, data: dict[str, Any], **kwargs: Any) -> Any:
        headers = dict(kwargs.pop("headers", {}) or {})
        headers.setdefault("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
        resp = self.request("POST", path, data=data, headers=headers, **kwargs)
        resp.raise_for_status()
        try:
            return resp.json()
        except ValueError as exc:
            raise GatewayError(f"无法解析 JSON: {resp.text[:200]!r}") from exc

    def get_bytes(self, path: str, **kwargs: Any) -> bytes:
        resp = self.request("GET", path, **kwargs)
        resp.raise_for_status()
        return resp.content
