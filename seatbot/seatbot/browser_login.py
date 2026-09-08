from __future__ import annotations

import logging
import time
from pathlib import Path

from .client import YitClient
from .session import cookie_header_to_items, save_session

log = logging.getLogger("seatbot")


def _apply_cookies(client: YitClient, raw: list[dict]) -> None:
    """把 Playwright Cookie 写入 requests，尽量不丢 domain/path。"""
    client.session.cookies.clear()
    for c in raw:
        name = c.get("name") or ""
        value = c.get("value") or ""
        if not name:
            continue
        domain = (c.get("domain") or "").lstrip()
        path = c.get("path") or "/"
        # requests 对 domain 较挑剔：空 domain 让它按当前 URL 匹配
        kwargs = {"path": path}
        if domain:
            # 去掉前导点有时反而匹配失败，两种都试：先原样
            try:
                client.session.cookies.set(name, value, domain=domain, **kwargs)
            except Exception:
                client.session.cookies.set(name, value, **kwargs)
        else:
            client.session.cookies.set(name, value, **kwargs)
    log.info(
        "已载入 Cookie：%s",
        ", ".join(sorted({c.get("name") for c in raw if c.get("name")})),
    )


def login_via_playwright(client: YitClient, path: Path) -> bool:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return False

    area = client.cfg.area_id
    start = client.url(f"/home/web/seat/area/{area}")
    log.info("打开浏览器，请在页面上完成统一认证（含动态验证码）")
    log.info("目标页: %s", start)
    log.info("登录成功并看到座位区域后，脚本会再刷新一次目标页再抓 Cookie")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            locale="zh-CN",
        )
        page = context.new_page()
        page.goto(start, wait_until="domcontentloaded")

        # 等到离开 CAS
        page.wait_for_function(
            """() => {
                const u = location.href;
                return u.includes('libresource.hust.edu.cn')
                    && !u.includes('pass.hust.edu.cn')
                    && !u.includes('gologin')
                    && !u.includes('/cas/login');
            }""",
            timeout=10 * 60 * 1000,
        )
        log.info("已离开统一认证，当前 URL: %s", page.url)

        # 强制再进一次 yitlink 座位页，让网关种全 Cookie
        try:
            page.goto(start, wait_until="networkidle", timeout=60_000)
        except Exception as exc:
            log.warning("刷新目标页时: %s（继续抓 Cookie）", exc)
        time.sleep(2)
        log.info("抓 Cookie 前 URL: %s", page.url)

        if "pass.hust.edu.cn" in page.url or "/cas/login" in page.url:
            browser.close()
            raise RuntimeError("仍停在统一认证页，请确认验证码/账号密码正确后再试")

        raw = context.cookies()
        browser.close()

    if not raw:
        raise RuntimeError("浏览器未返回任何 Cookie")

    _apply_cookies(client, raw)
    save_session(client, path)
    return True


def login_via_paste(client: YitClient, path: Path) -> None:
    print()
    print("未安装 Playwright，改为手动贴 Cookie。")
    print("1. 浏览器打开并登录成功后，地址栏应类似：")
    print("   https://libresource.hust.edu.cn/http/.../yitlink/home/web/seat/...")
    print("2. F12 → Network → 刷新 → 点开任意 api.php 请求")
    print("3. Request Headers 里复制 Cookie: 后面整段")
    print("4. 粘贴到下方，空行结束")
    print()
    lines: list[str] = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if not line.strip():
            if lines:
                break
            continue
        lines.append(line.strip())
    header = " ".join(lines).strip()
    if header.lower().startswith("cookie:"):
        header = header.split(":", 1)[1].strip()
    if not header:
        raise RuntimeError("没有读到 Cookie")
    items = cookie_header_to_items(header)
    if not items:
        raise RuntimeError("Cookie 格式不对")
    client.session.cookies.clear()
    for item in items:
        client.session.cookies.set(item["name"], item["value"])
    save_session(client, path)


def interactive_login(client: YitClient, path: Path) -> None:
    if login_via_playwright(client, path):
        return
    login_via_paste(client, path)
