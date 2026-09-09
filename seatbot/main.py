#!/usr/bin/env python3
"""华科图书馆座位预约。

典型部署：
  本机自动登录:  login_agent.bat  或  python main.py --auto-cas --upload
  本机常驻助手:  agent.bat        或  python main.py --agent
  本机手动浏览器: login.bat
  服务器: python main.py --worker
"""

from __future__ import annotations

import argparse
import sys
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from seatbot.browser_login import interactive_login
from seatbot.cas_login import CasLoginError, auto_cas_login_and_save, upload_session_scp
from seatbot.client import GatewayError, YitClient
from seatbot.config import load_config
from seatbot.jobs import default_jobs_path
from seatbot.keepalive import ping, wait_until_with_keepalive
from seatbot.logger import setup_logger
from seatbot.login import LoginError, login_with_captcha
from seatbot.notify import notify
from seatbot.scheduler import next_run, _zone
from seatbot.seats import (
    BookError,
    book_space,
    fetch_segment,
    fetch_spaces,
    pick_space,
    resolve_target_date,
)
from seatbot.session import load_session, resolve_session_path, save_session
from seatbot.worker import process_due_jobs, trigger_server_login, worker_loop
from seatbot.runtime import WorkerRuntime


def run_once(cfg, log, client: YitClient | None = None) -> int:
    client = client or YitClient(cfg)
    dump_dir = ROOT / "logs"
    store = resolve_session_path(ROOT, cfg.session_file)
    load_session(client, store)

    log.info("目标房间 area_id=%s 座位优先级=%s", cfg.area_id, " > ".join(cfg.seat_nos))
    target_day = resolve_target_date(cfg.date, cfg.day_offset, cfg.timezone)
    log.info(
        "预约日期 %s（day_offset=%s date=%s）",
        target_day.isoformat(),
        cfg.day_offset,
        cfg.date or "-",
    )

    if cfg.dry_run:
        log.warning("dry_run=true，只会登录并查询，不会真正提交预约")

    try:
        auth = login_with_captcha(client, dump_dir=dump_dir)
        save_session(client, store)
    except (LoginError, GatewayError) as exc:
        log.error("登录失败: %s", exc)
        notify(cfg.notify_webhook, f"[拾座] 图书馆登录失败: {exc}")
        return 2

    try:
        seg = fetch_segment(client, cfg.area_id, target_day, cfg.start_time, cfg.end_time)
        log.info(
            "时段 segment=%s day=%s %s-%s",
            seg.id,
            seg.compact_day,
            seg.start_time,
            seg.end_time,
        )
    except (BookError, GatewayError) as exc:
        log.error("解析时段失败: %s", exc)
        return 3

    last_err: Exception | None = None
    for attempt in range(1, cfg.book_retries + 1):
        try:
            spaces = fetch_spaces(client, seg)
            free = sum(1 for s in spaces if s.free)
            log.info(
                "座位查询 [%s/%s] 共 %s 个，空闲 %s 个",
                attempt,
                cfg.book_retries,
                len(spaces),
                free,
            )
            seat = pick_space(spaces, cfg.seat_nos, cfg.fallback_any_free)
            log.info("选定座位 no=%s space_id=%s %s", seat.no, seat.id, seat.status_name)

            if cfg.dry_run:
                log.info(
                    "【演练成功】将提交 POST /api.php/spaces/%s/book userid=%s segment=%s",
                    seat.id,
                    auth.userid,
                    seg.id,
                )
                return 0

            result = book_space(client, auth, seg, seat)
            info = ((result.get("data") or {}).get("list")) or {}
            space_info = info.get("spaceInfo") or {}
            area_info = space_info.get("areaInfo") or {}
            summary = (
                f"预约成功 单号={info.get('no')} 座位={space_info.get('no') or seat.no} "
                f"区域={area_info.get('nameMerge')} "
                f"{info.get('starttime')}~{info.get('endingtime')}"
            )
            print()
            print("=" * 48)
            print("  预约成功")
            print(f"  单号    {info.get('no')}")
            print(f"  座位    {space_info.get('no') or seat.no}")
            print(f"  区域    {area_info.get('nameMerge')}")
            print(f"  时间    {info.get('starttime')} ~ {info.get('endingtime')}")
            print("=" * 48)
            log.info(summary)
            notify(cfg.notify_webhook, f"[拾座] {summary}")
            save_session(client, store)
            return 0
        except BookError as exc:
            last_err = exc
            log.warning("预约未成 [%s/%s] %s", attempt, cfg.book_retries, exc)
            if "不在可预约范围" in str(exc) or "登录" in str(exc):
                break
            time.sleep(cfg.retry_interval)
        except GatewayError as exc:
            log.error("网关异常: %s", exc)
            notify(cfg.notify_webhook, f"[拾座] 网关异常: {exc}")
            return 4
        except Exception as exc:
            last_err = exc
            log.exception("未预期异常 [%s/%s] %s", attempt, cfg.book_retries, exc)
            time.sleep(cfg.retry_interval)

    log.error("预约失败: %s", last_err or "未知错误")
    notify(cfg.notify_webhook, f"[拾座] 预约失败: {last_err}")
    return 1


def cmd_login(cfg, log) -> int:
    client = YitClient(cfg)
    store = resolve_session_path(ROOT, cfg.session_file)
    try:
        interactive_login(client, store)
    except Exception as exc:
        log.error("登录采集失败: %s", exc)
        return 2
    for i in range(1, 4):
        if ping(client):
            log.info("网关会话有效。请上传到服务器：")
            log.info("  scp %s seatbot@你的服务器:/opt/seatbot/", store.name)
            return 0
        log.warning("登录后心跳未通过（第 %s 次），稍后重试…", i)
        time.sleep(2)
    log.error(
        "Cookie 已写入 %s，但本机心跳仍失败。"
        "可能是网络闪断，不一定是 Cookie 无效。"
        "可稍后再试 login.bat，或直接把 session.json 上传到服务器。",
        store.name,
    )
    return 3


def cmd_auto_cas(cfg, log, *, upload: bool) -> int:
    """本机自动 CAS 登录（路线 B），可选上传 session.json。"""
    client = YitClient(cfg)
    store = resolve_session_path(ROOT, cfg.session_file)
    try:
        auto_cas_login_and_save(client, store)
    except CasLoginError as exc:
        log.error("自动 CAS 登录失败: %s", exc)
        log.info("可回退: login.bat（浏览器手动过验证码）")
        return 2
    except Exception as exc:
        log.exception("自动登录异常: %s", exc)
        return 2

    ok = False
    for i in range(1, 4):
        if ping(client):
            ok = True
            break
        log.warning("登录后心跳未通过（第 %s 次）…", i)
        time.sleep(2)
    if not ok:
        log.error("已保存 %s，但本机心跳失败。仍可尝试 --upload 到服务器再测。", store)
        if not upload:
            return 3

    if upload:
        if not cfg.server_host:
            log.error("未配置 server_host")
            return 4
        try:
            upload_session_scp(
                store,
                host=cfg.server_host,
                user=cfg.server_user,
                remote_dir=cfg.server_path,
                password=cfg.server_ssh_password or None,
                port=cfg.server_ssh_port,
            )
            log.info("上传完成。服务器 worker 会自动加载新会话。")
        except Exception as exc:
            log.error("上传失败: %s", exc)
            log.info("请手动: scp %s %s@%s:%s/", store.name, cfg.server_user, cfg.server_host, cfg.server_path)
            return 5
    else:
        log.info("未加 --upload。需要时执行: python main.py --auto-cas --upload")
    return 0 if ok else 3


def cmd_agent(cfg, log) -> int:
    """本机常驻：周期性检查网关，失效则自动 CAS 并上传。"""
    store = resolve_session_path(ROOT, cfg.session_file)
    log.info(
        "登录助手启动 interval=%ss server=%s@%s:%s",
        cfg.agent_interval,
        cfg.server_user,
        cfg.server_host,
        cfg.server_path,
    )
    while True:
        client = YitClient(cfg)
        load_session(client, store)
        alive = False
        try:
            alive = ping(client, retries=2)
        except Exception as exc:
            log.warning("检测异常: %s", exc)
        if alive:
            log.info("会话有效，%s 秒后再次检查", cfg.agent_interval)
            save_session(client, store)
        else:
            log.warning("会话失效，开始自动 CAS 登录…")
            code = cmd_auto_cas(cfg, log, upload=True)
            if code not in (0, 3):
                log.error("自动恢复失败 code=%s，%s 秒后重试", code, cfg.agent_interval)
        try:
            time.sleep(cfg.agent_interval)
        except KeyboardInterrupt:
            log.info("助手已停止")
            return 0


def cmd_worker(cfg, log) -> int:
    """事件驱动任务队列：无任务时不访问馆方接口。"""
    jobs_path = default_jobs_path(ROOT)
    log.info("worker 模式 jobs=%s", jobs_path)
    runtime = WorkerRuntime()

    # 可选：同进程起 API（127.0.0.1:8766），nginx 反代 /seat-api/
    try:
        from seatbot.api import serve_api

        server = serve_api(
            cfg,
            ROOT,
            jobs_path,
            host="127.0.0.1",
            port=8766,
            runtime=runtime,
            recover_session=lambda: trigger_server_login(ROOT),
        )

        def _serve() -> None:
            server.serve_forever()

        threading.Thread(target=_serve, name="seatbot-api", daemon=True).start()
    except Exception as exc:
        log.warning("API 未启动: %s", exc)

    try:
        worker_loop(cfg, ROOT, jobs_path, runtime=runtime)
    except KeyboardInterrupt:
        log.info("worker 停止")
        return 0
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="华科图书馆座位自动预约")
    parser.add_argument("-c", "--config", default=str(ROOT / "config.yaml"))
    parser.add_argument("--now", action="store_true", help="忽略 grab_at，立即执行")
    parser.add_argument("--dry-run", action="store_true", help="只登录查询，不提交预约")
    parser.add_argument("--login", action="store_true", help="本机浏览器采集网关会话")
    parser.add_argument(
        "--auto-cas",
        action="store_true",
        help="本机自动 CAS 登录（OCR 验证码，无需手动点浏览器）",
    )
    parser.add_argument(
        "--upload",
        action="store_true",
        help="登录成功后上传 session.json 到 server_host",
    )
    parser.add_argument(
        "--agent",
        action="store_true",
        help="本机常驻助手：会话失效时自动 CAS 并上传",
    )
    parser.add_argument(
        "--keepalive-only",
        action="store_true",
        help="只保活不抢座",
    )
    parser.add_argument(
        "--worker",
        action="store_true",
        help="事件驱动多任务 worker（无任务时不访问馆方接口）",
    )
    args = parser.parse_args(argv)

    log = setup_logger(ROOT / "logs")

    try:
        need_account = args.auto_cas or args.agent or not args.login
        cfg = load_config(args.config, require_account=need_account)
    except Exception as exc:
        print(f"配置错误: {exc}", file=sys.stderr)
        return 2

    if args.dry_run:
        cfg.dry_run = True

    if args.agent:
        return cmd_agent(cfg, log)

    if args.auto_cas:
        return cmd_auto_cas(cfg, log, upload=args.upload)

    if args.login:
        return cmd_login(cfg, log)

    log.info("拾座启动  base=%s  dry_run=%s", cfg.base_url, cfg.dry_run)

    if args.worker:
        return cmd_worker(cfg, log)

    client = YitClient(cfg)
    store = resolve_session_path(ROOT, cfg.session_file)
    if not load_session(client, store) and not cfg.cookie:
        log.warning(
            "未找到 %s。校外请先本机 login 并上传会话。",
            store.name,
        )

    if args.keepalive_only:
        far = datetime.now(_zone(cfg.timezone)) + timedelta(days=365)
        try:
            wait_until_with_keepalive(
                client, far, cfg.timezone, cfg.keepalive_interval, store
            )
        except KeyboardInterrupt:
            log.info("停止保活")
            return 0
        return 0

    if cfg.grab_at and not args.now:
        target = next_run(cfg.grab_at, cfg.timezone, client.clock_offset)
        wait_until_with_keepalive(
            client, target, cfg.timezone, cfg.keepalive_interval, store
        )

    return run_once(cfg, log, client)


if __name__ == "__main__":
    raise SystemExit(main())
