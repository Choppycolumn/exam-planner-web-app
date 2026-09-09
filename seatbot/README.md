# 拾座 · 华科图书馆座位预约（事件驱动）

接口来自 `libresource.hust.edu.cn` 真实 HAR，不靠猜测。

**一键启动：** `./一键启动.sh`（Windows：`一键启动.bat`）。座位预约面板：`./一键启动.sh web` 或打开 `web/index.html`（风格对齐考研计划管理站点）。

**部署请先看 [DEPLOY.md](./DEPLOY.md)**（本机登录、上传会话、服务器安装、systemd/cron、常见问题）。

## 架构

```
本机（你操作）                         服务器（自动跑）
─────────────────                     ─────────────────
python main.py --login                收到 session.json
  └ 浏览器过统一认证                     API 常驻、任务调度休眠
  └ 写出 session.json                   有任务时登录、查询并预约
scp / upload_session.sh  ──────────►  失效则通知，等你再传会话
```

生产环境还会以 `python main.py --worker` 启动一个仅监听
`127.0.0.1:8766` 的管理 API。ExamPlanner 的 `/seat-assistant` 页面通过
iframe 打开 `/seat/`，Nginx 将 `/seat-api/` 转发给该 API。

Worker 使用事件驱动调度：没有待执行任务时不访问馆方接口；远期任务会在
进入“今明后”窗口前 10 分钟做一次会话预检，到达窗口后执行；当天新建任务
会立即唤醒。失败预约按任务配置有限重试，自动签到仅在预约开始后的 30 分钟
内最多尝试 3 次。旧的固定心跳、全量预约扫描和午夜 sprint 定时器不应启用。

管理界面支持：

- 多账号添加、切换和删除；
- 楼层、房间、日期、时段和座位选择；
- 单日或连续日期预约任务；
- 预约结果、签到、临时离开、回来签到、签离和取消；
- 会话健康状态、暂停登录、后台重试和 Bark 提醒。

`/seat/` 和 `/seat-api/` 必须同时受 ExamPlanner 登录与
`seat_assistant.manage` 权限保护。可直接采用
[`scripts/nginx-seatbot.conf.example`](./scripts/nginx-seatbot.conf.example)；
不要把没有鉴权的 8766 端口暴露到公网。

`scripts/systemd/` 中的 preflight 与 sprint 单元仅用于历史恢复，不应启用。
当前 worker 自己计算预检时间，而且不会为了预约临时停止主站。

统一认证动态验证码**不能跳过**，由你在本机完成；图书馆 4 位静态码由服务器本地 `ddddocr` 识别。

## 目录

```
main.py
config.example.yaml
requirements.txt
scripts/upload_session.sh
scripts/seatbot.service
seatbot/
  client.py login.py captcha.py seats.py
  session.py keepalive.py browser_login.py
  config.py logger.py scheduler.py notify.py
```

## 本机准备（只需一次环境）

```bash
cd seatbot
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# 可选：图形登录
# pip install playwright && playwright install chromium
cp config.example.yaml config.yaml
# 编辑学号、密码、区域、座位、grab_at
```

## 日常流程

### 1. 本机登录（过统一认证）

```bash
python main.py --login
```

- 已装 Playwright：会弹浏览器，你完成动态验证码即可。
- 未装：按提示粘贴浏览器 Cookie。

成功后生成 `session.json`。

### 2. 上传到服务器

```bash
chmod +x scripts/upload_session.sh
./scripts/upload_session.sh user@your-server:/opt/seatbot/
# 或
scp session.json user@your-server:/opt/seatbot/
```

### 3. 服务器运行

```bash
# 保活直到 grab_at，然后抢座
python main.py

# 立刻跑一轮（调试）
python main.py --now

# 只查不订
python main.py --dry-run

# 常驻只保活（配合 cron 在开抢前几分钟再 --now）
python main.py --keepalive-only
```

会话失效时进程会暂停并打日志；若配置了 `notify_webhook`（企业微信机器人等）会推送。你本机重新 `--login` 再上传后，服务器自动恢复。

## 配置要点

| 字段 | 说明 |
|------|------|
| `grab_at` | 开抢时刻，如 `06:00:00`；空则立即 |
| `keepalive_interval` | 心跳秒数，建议 120–300 |
| `session_file` | 会话文件名，默认 `session.json` |
| `notify_webhook` | 可选，失效/成功通知 |
| `seat_nos` | 座位优先级列表 |
| `day_offset` | 0 今天 / 1 明天 |

## systemd 常驻 API 与事件调度器（推荐）

```bash
sudo cp scripts/seatbot.service /etc/systemd/system/
# 按实际路径改 WorkingDirectory / ExecStart / User
sudo systemctl enable --now seatbot
```

无需另配 cron、固定心跳或午夜预检 timer。服务常驻只用于本地 API 和等待任务，
空闲时不会登录、识别验证码或请求馆方接口。

## 安全

- 不要把 `config.yaml`、`accounts.json`、`jobs*.json`、`session*.json`、
  `bark.env` 或 `logs/` 提交到 Git（已在 `.gitignore`）。
- 上传只用 scp/rsync，不要发到公开网盘。
- API 只监听 `127.0.0.1`，Nginx 必须通过主站 session 做 `auth_request`。
- 仅预约本人座位，遵守图书馆规则。

## 关键接口（HAR）

| 步骤 | 方法 | 路径 |
|------|------|------|
| 验证码 | GET | `/api.php/check` |
| 登录 | POST | `/api.php/login` |
| 时段/心跳 | GET | `/api.php/v3areadays/{area}` |
| 座位 | GET | `/api.php/spaces_old` |
| 预约 | POST | `/api.php/spaces/{id}/book` |

前缀：`https://libresource.hust.edu.cn/http/80/133/9/114/202/yitlink`
