from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from .captcha import recognize
from .client import GatewayError, YitClient
from .pause import is_paused, remaining

log = logging.getLogger("seatbot")


class LoginError(RuntimeError):
    pass


@dataclass
class Auth:
    access_token: str
    userid: str
    name: str = ""
    expire: str = ""


def _extract_auth(payload: dict) -> Auth:
    data = payload.get("data") or {}
    h = data.get("_hash_") or {}
    token = h.get("access_token") or h.get("hash") or ""
    userid = str(h.get("userid") or "")
    name = str((data.get("list") or {}).get("name") or "")
    expire = str(h.get("expire") or "")
    if not token or not userid:
        raise LoginError(f"登录响应缺少 token/userid: {payload}")
    return Auth(access_token=str(token), userid=userid, name=name, expire=expire)


def login_with_captcha(
    client: YitClient,
    *,
    dump_dir: Optional[Path] = None,
) -> Auth:
    """拉验证码 → 本地 OCR → 提交登录。失败自动换图重试。"""
    if is_paused():
        raise LoginError(f"登录已暂停（剩余 {int(remaining())} 秒）")
    cfg = client.cfg
    referer = client.url("/home/web/f_second")
    last_msg = ""
    for attempt in range(1, cfg.captcha_retries + 1):
        try:
            img = client.get_bytes("/api.php/check", referer=referer)
        except GatewayError:
            raise
        except Exception as exc:
            last_msg = f"拉取验证码失败: {exc}"
            log.warning("[%s/%s] %s", attempt, cfg.captcha_retries, last_msg)
            continue

        if dump_dir is not None:
            dump_dir.mkdir(parents=True, exist_ok=True)
            (dump_dir / f"captcha_{attempt}.png").write_bytes(img)

        code = recognize(img)
        if not code or len(code) < 4:
            last_msg = f"OCR 未识别出 4 位码: {code!r}"
            log.warning("[%s/%s] %s", attempt, cfg.captcha_retries, last_msg)
            continue

        log.info("[%s/%s] 验证码 OCR=%s，提交登录", attempt, cfg.captcha_retries, code)
        try:
            payload = client.post_form(
                "/api.php/login",
                {
                    "username": cfg.username,
                    "password": cfg.password,
                    "verify": code,
                },
                referer=referer,
            )
        except GatewayError:
            raise
        except Exception as exc:
            last_msg = f"登录请求失败: {exc}"
            log.warning("[%s/%s] %s", attempt, cfg.captcha_retries, last_msg)
            continue

        status = int(payload.get("status") or 0)
        msg = str(payload.get("msg") or "")
        if status == 1:
            auth = _extract_auth(payload)
            log.info("图书馆登录成功 expire=%s", auth.expire)
            return auth

        last_msg = msg or str(payload)
        log.warning("[%s/%s] 登录失败: %s", attempt, cfg.captcha_retries, last_msg)
        if "密码" in msg and "验证码" not in msg:
            break

    raise LoginError(f"登录失败（已重试 {cfg.captcha_retries} 次）: {last_msg}")
