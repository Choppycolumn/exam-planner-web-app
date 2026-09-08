from __future__ import annotations

"""华科统一认证 (pass.hust.edu.cn) 自动登录 → 种下资源网关 Cookie。

验证码为图片数字码（可 OCR）；密码使用与前端 JSEncrypt 相同的 RSA PKCS1 加密。
"""

import base64
import logging
import re
import time
from typing import Optional
from urllib.parse import quote

import requests
from Crypto.Cipher import PKCS1_v1_5
from Crypto.PublicKey import RSA

from .captcha import recognize_cas
from .client import USER_AGENT, YitClient
from .session import save_session

log = logging.getLogger("seatbot")

CAS_BASE = "https://pass.hust.edu.cn/cas"
CAS_LOGIN = f"{CAS_BASE}/login"
CAS_RSA = f"{CAS_BASE}/rsa"
CAS_CODE = f"{CAS_BASE}/code"


class CasLoginError(RuntimeError):
    pass


def _rsa_encrypt(public_key_b64: str, text: str) -> str:
    """JSEncrypt 兼容：PKCS#1 v1.5 + Base64。"""
    der = base64.b64decode(public_key_b64)
    key = RSA.import_key(der)
    cipher = PKCS1_v1_5.new(key)
    encrypted = cipher.encrypt(text.encode("utf-8"))
    return base64.b64encode(encrypted).decode("ascii")


def _parse_hidden(html: str, name: str) -> str:
    # name="lt" value="..."
    m = re.search(
        rf'<input[^>]*name=["\']{re.escape(name)}["\'][^>]*value=["\']([^"\']*)["\']',
        html,
        re.I,
    )
    if m:
        return m.group(1)
    m = re.search(
        rf'<input[^>]*value=["\']([^"\']*)["\'][^>]*name=["\']{re.escape(name)}["\']',
        html,
        re.I,
    )
    return m.group(1) if m else ""


def cas_login_to_client(
    client: YitClient,
    *,
    max_retries: int = 15,
) -> None:
    """在 client.session 上完成 CAS + 跳转图书馆网关，Cookie 写入同一 session。"""
    cfg = client.cfg
    if not cfg.username or not cfg.password:
        raise CasLoginError("config.yaml 缺少 username/password")

    service = client.url(f"/home/web/seat/area/{cfg.area_id}")
    login_url = f"{CAS_LOGIN}?service={quote(service, safe='')}"

    sess = client.session
    sess.headers.setdefault("User-Agent", USER_AGENT)

    last_err = ""
    for attempt in range(1, max_retries + 1):
        try:
            page = sess.get(login_url, timeout=20)
            page.raise_for_status()
            html = page.text
            # 已登录并跳转
            if "libresource.hust.edu.cn" in page.url and "pass.hust.edu.cn" not in page.url:
                log.info("CAS 已有会话，直接进入资源网: %s", page.url[:100])
                _finalize_gateway(client, service, page.url)
                return

            lt = _parse_hidden(html, "lt")
            execution = _parse_hidden(html, "execution") or "e1s1"
            event_id = _parse_hidden(html, "_eventId") or "submit"
            if not lt:
                last_err = "登录页未找到 lt，可能被 WAF 拦截"
                log.warning("[%s/%s] %s", attempt, max_retries, last_err)
                time.sleep(1.5)
                continue

            rsa_resp = sess.post(CAS_RSA, timeout=15)
            rsa_resp.raise_for_status()
            public_key = (rsa_resp.json() or {}).get("publicKey") or ""
            if not public_key:
                raise CasLoginError(f"获取 RSA 公钥失败: {rsa_resp.text[:200]}")

            code_img = sess.get(CAS_CODE, timeout=15).content
            # 调试：保存原图便于核对
            try:
                from pathlib import Path as _P
                dump = _P("logs")
                dump.mkdir(parents=True, exist_ok=True)
                (dump / f"cas_code_{attempt}.bin").write_bytes(code_img)
            except Exception:
                pass
            code = recognize_cas(code_img) or ""
            code = re.sub(r"\D", "", code)
            # GIF 分帧各显示部分数字，叠帧后目标 4 位
            if len(code) < 4:
                last_err = f"CAS 验证码 OCR 不足 4 位: {code!r}（叠帧图 logs/cas_stacked.png）"
                log.warning("[%s/%s] %s", attempt, max_retries, last_err)
                time.sleep(0.5)
                continue
            code = code[:4]

            ul = _rsa_encrypt(public_key, cfg.username)
            pl = _rsa_encrypt(public_key, cfg.password)

            data = {
                "rsa": "",
                "ul": ul,
                "pl": pl,
                "code": code,
                "phoneCode": "",
                "lt": lt,
                "execution": execution,
                "_eventId": event_id,
            }
            log.info("[%s/%s] CAS 提交登录 OCR=%s", attempt, max_retries, code)
            resp = sess.post(
                login_url,
                data=data,
                timeout=25,
                allow_redirects=True,
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": login_url,
                    "Origin": "https://pass.hust.edu.cn",
                },
            )

            final = resp.url or ""
            if "pass.hust.edu.cn" in final and "login" in final:
                # 仍在登录页
                if "验证码" in resp.text or "code" in resp.text.lower():
                    last_err = "验证码错误或表单被拒"
                elif "密码" in resp.text or "credential" in resp.text.lower():
                    last_err = "账号或密码错误"
                    log.error(last_err)
                    raise CasLoginError(last_err)
                else:
                    last_err = "仍停在 CAS 登录页"
                log.warning("[%s/%s] %s final=%s", attempt, max_retries, last_err, final[:80])
                time.sleep(1.0)
                continue

            log.info("CAS 登录跳转成功 → %s", final[:120])
            _finalize_gateway(client, service, final)
            return
        except CasLoginError:
            raise
        except Exception as exc:
            last_err = str(exc)
            log.warning("[%s/%s] CAS 异常: %s", attempt, max_retries, last_err)
            time.sleep(1.5)

    raise CasLoginError(f"CAS 自动登录失败（已重试 {max_retries} 次）: {last_err}")


def _apply_callback_token(sess: requests.Session, url: str) -> str:
    """从 callBack?token=... 提取并写入 x-yit-token（与浏览器行为一致）。"""
    from urllib.parse import urlparse, parse_qs

    token = ""
    try:
        q = parse_qs(urlparse(url).query)
        token = (q.get("token") or [""])[0]
    except Exception:
        token = ""
    if not token and "token=" in url:
        token = url.split("token=", 1)[-1].split("&", 1)[0]
    if token:
        # 浏览器成功登录后 x-yit-token 与 callBack 的 token 相同
        sess.cookies.set("x-yit-token", token, domain="libresource.hust.edu.cn", path="/")
        sess.cookies.set("yit_sw", "true", domain="libresource.hust.edu.cn", path="/")
        log.info("已写入 x-yit-token（来自 callBack，长度 %s）", len(token))
    return token


def _safe_get(sess: requests.Session, url: str, *, max_hops: int = 8) -> requests.Response | None:
    """有限跳转，避免被 CAS 死循环拖垮。"""
    current = url
    last = None
    for _ in range(max_hops):
        try:
            last = sess.get(current, timeout=20, allow_redirects=False)
        except Exception as exc:
            log.warning("请求失败 %s: %s", current[:80], exc)
            return last
        if last.is_redirect or last.status_code in (301, 302, 303, 307, 308):
            loc = last.headers.get("Location") or ""
            if not loc:
                break
            if loc.startswith("/"):
                from urllib.parse import urljoin

                loc = urljoin(current, loc)
            if "pass.hust.edu.cn" in loc and "/cas/login" in loc:
                log.warning("跳转又回到 CAS，停止跟随: %s", loc[:100])
                break
            current = loc
            continue
        break
    return last


def _finalize_gateway(client: YitClient, service_url: str, final_url: str = "") -> None:
    """callBack 收 token → 写 Cookie → 再进 yitlink 座位页。"""
    sess = client.session
    if final_url:
        _apply_callback_token(sess, final_url)
        # 再 GET 一次 callBack，让服务端种其它 Cookie
        if "callBack" in final_url or "token=" in final_url:
            _safe_get(sess, final_url, max_hops=5)

    origin = "https://libresource.hust.edu.cn"
    for url in (
        origin + "/",
        origin + "/next/user/callBack",
        service_url,
        client.url("/home/web/f_second"),
        client.url(f"/api.php/v3areadays/{client.cfg.area_id}"),
    ):
        try:
            r = _safe_get(sess, url, max_hops=6)
            if r is not None:
                log.info(
                    "访问 %s → %s cookies=%s",
                    url[:60],
                    r.status_code,
                    len(sess.cookies),
                )
        except Exception as exc:
            log.warning("访问 %s: %s", url[:60], exc)

    names = sorted({c.name for c in sess.cookies})
    log.info("当前 Cookie: %s", ", ".join(names))

    try:
        from .keepalive import ping

        if ping(client, retries=3):
            log.info("网关 Cookie 已就绪（心跳通过）")
        else:
            log.warning(
                "网关 Cookie 未完全生效。已有: %s。可再试一次 --auto-cas，或 login.bat",
                ", ".join(names),
            )
    except Exception as exp:
        log.warning("心跳检查异常: %s", exp)


def auto_cas_login_and_save(client: YitClient, path) -> None:
    cas_login_to_client(client)
    save_session(client, path)


def upload_session_scp(
    local_path,
    host: str,
    user: str,
    remote_dir: str,
    password: Optional[str] = None,
    port: int = 22,
) -> None:
    """上传 session.json。

    若配置了 password：直接用 paramiko，避免系统 scp 交互式要密码。
    未配置 password：尝试免密 scp（需已 ssh-copy-id）。
    """
    import subprocess
    from pathlib import Path

    local_path = Path(local_path)
    if not local_path.is_file():
        raise FileNotFoundError(str(local_path))
    remote = f"{user}@{host}:{remote_dir.rstrip('/')}/session.json"
    remote_file = remote_dir.rstrip("/") + "/session.json"

    def _via_paramiko(pw: str) -> None:
        import paramiko

        transport = paramiko.Transport((host, port))
        transport.connect(username=user, password=pw)
        sftp = paramiko.SFTPClient.from_transport(transport)
        assert sftp is not None
        sftp.put(str(local_path), remote_file)
        sftp.close()
        transport.close()
        log.info("已 paramiko 上传 → %s:%s", host, remote_file)

    # 有密码：绝不走交互式 scp
    if password:
        try:
            _via_paramiko(password)
            return
        except Exception as exc:
            log.warning("paramiko 上传失败: %s，尝试 BatchMode scp", exc)

    # 无密码或 paramiko 失败：仅非交互 scp（有密钥才成功，不会卡住要密码）
    try:
        cmd = [
            "scp",
            "-P",
            str(port),
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=15",
            str(local_path),
            remote,
        ]
        subprocess.run(cmd, check=True, timeout=30)
        log.info("已 scp 上传 → %s", remote)
        return
    except Exception as exc:
        if password:
            # 再试一次 paramiko
            _via_paramiko(password)
            return
        raise RuntimeError(
            "上传失败：请在 config.yaml 填写 server_ssh_password，或配置 SSH 公钥免密。"
            f" 详情: {exc}"
        ) from exc
