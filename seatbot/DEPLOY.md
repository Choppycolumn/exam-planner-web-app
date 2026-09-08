# 拾座 · 部署说明

> 当前生产形态以 `python main.py --worker` 为准，同时提供本地管理 API。
> systemd 单元见 `scripts/systemd/`，Nginx 接入见
> `scripts/nginx-seatbot.conf.example`。旧的 `--keepalive-only + cron` 内容仅用于
> 理解早期部署方式，不应覆盖当前 worker 服务。

本文说明如何把程序部署到 **本机 + 服务器** 两台环境上长期使用。

核心原则：

- **本机**：负责过统一认证（动态验证码），生成 `session.json`
- **服务器**：负责心跳保活 + 到点 OCR 图书馆验证码并预约
- 不要把 `config.yaml`、`session.json` 提交到 Git 或发到公开网盘

```
本机                              服务器
────────────────────              ────────────────────
1. 安装依赖、填 config.yaml
2. python main.py --login         3. 安装依赖、填同一份 config.yaml
   └ 写出 session.json            4. 收到 session.json
5. scp / upload_session.sh ────►  5. 保活 + 到点抢座
```

---

## 一、环境要求

| 项目 | 本机 | 服务器 |
|------|------|--------|
| 系统 | Windows / macOS / Linux | 建议 Linux（Ubuntu 20.04+ 等） |
| Python | 3.10+ | 3.10+ |
| 网络 | 能打开 libresource / pass.hust | 能访问 `libresource.hust.edu.cn` |
| 图形界面 | 用 Playwright 时需要 | 不需要 |
| 可选 | Playwright（弹浏览器登录） | systemd / cron |

有校园 VPN 的服务器更稳；纯校外则必须依赖本机传上来的 `session.json`。

---

## 二、本机部署（登录端）

### 1. 解压并安装

```bash
# 解压 seatbot.zip 后进入目录
cd seatbot

python3 -m venv .venv

# Linux / macOS
source .venv/bin/activate

# Windows (PowerShell)
# .venv\Scripts\Activate.ps1

pip install -r requirements.txt
```

可选：图形化登录（推荐）

```bash
pip install playwright
playwright install chromium
```

### 2. 填写配置

```bash
cp config.example.yaml config.yaml
```

用编辑器打开 `config.yaml`，至少填写：

| 字段 | 示例 | 说明 |
|------|------|------|
| `username` | 学号 | 图书馆账号 |
| `password` | 密码 | 图书馆密码 |
| `area_id` | `101` | 房间 ID（东区馆 4 楼中厅示例） |
| `seat_nos` | `["002", "004"]` | 座位优先级 |
| `day_offset` | `1` | 0=今天 1=明天 2=后天 |
| `grab_at` | `"06:00:00"` | 开抢时刻（北京时间） |
| `keepalive_interval` | `180` | 服务器心跳秒数，建议 120–300 |
| `notify_webhook` | 企业微信机器人 URL | 可选，失效/成功通知 |

本机与服务器建议使用**同一份** `config.yaml`（或至少座位、时间一致）。

### 3. 本机登录，采集会话

```bash
python main.py --login
```

- **已装 Playwright**：会弹出浏览器，打开图书馆资源页；你在 `pass.hust.edu.cn` 完成动态验证码，登录成功后脚本自动抓 Cookie。
- **未装 Playwright**：按终端提示，在浏览器登录后把 Cookie 整段粘贴进来，空行结束。

成功后项目根目录生成：

```text
session.json
```

可用下面命令自检（本机也能跑心跳）：

```bash
python main.py --dry-run --now
```

若提示跳到统一认证，说明 Cookie 无效，重新 `--login`。

### 4. 上传会话到服务器

```bash
chmod +x scripts/upload_session.sh

# 方式 A：脚本
./scripts/upload_session.sh user@你的服务器IP:/opt/seatbot/

# 方式 B：环境变量
export SEATBOT_REMOTE=user@你的服务器IP:/opt/seatbot/
./scripts/upload_session.sh

# 方式 C：直接 scp
scp session.json user@你的服务器IP:/opt/seatbot/
```

把 `user@你的服务器IP` 和路径换成你的实际 SSH 账号与部署目录。

---

## 三、服务器部署（保活 + 抢座）

以下以部署目录 `/opt/seatbot`、系统用户 `seatbot` 为例，可按需修改。

### 1. 创建目录与用户（可选）

```bash
sudo useradd -r -m -d /opt/seatbot -s /bin/bash seatbot || true
sudo mkdir -p /opt/seatbot
sudo chown -R seatbot:seatbot /opt/seatbot
```

### 2. 上传代码

在你**本机**执行（与上传 session 类似）：

```bash
# 把整个项目拷到服务器（不要带本机 .venv）
rsync -av --exclude '.venv' --exclude 'logs' --exclude '__pycache__' \
  ./seatbot/ user@你的服务器IP:/opt/seatbot/
```

或先在服务器上解压 `seatbot.zip`：

```bash
scp seatbot.zip user@你的服务器IP:/tmp/
ssh user@你的服务器IP
sudo unzip -o /tmp/seatbot.zip -d /opt/
sudo chown -R seatbot:seatbot /opt/seatbot
```

### 3. 安装依赖

```bash
ssh user@你的服务器IP
cd /opt/seatbot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

服务器**不需要** Playwright。需要 `ddddocr` 做图书馆 4 位验证码识别。

### 4. 配置文件

```bash
cp config.example.yaml config.yaml
nano config.yaml   # 或 vim
```

与本机保持一致：学号、密码、区域、座位、`grab_at`、`keepalive_interval`。
确认 `session_file: "session.json"`，且本机已把 `session.json` 传到该目录。

权限建议：

```bash
chmod 600 config.yaml session.json
```

### 5. 试跑

```bash
cd /opt/seatbot
source .venv/bin/activate

# 只查不订，验证会话与接口
python main.py --dry-run --now

# 立刻真实跑一轮（确认无误再用）
# python main.py --now
```

### 6. 正式运行方式（三选一）

#### 方式 A：前台 / screen（最简单）

到点前启动，保活直到 `grab_at` 再抢：

```bash
cd /opt/seatbot
source .venv/bin/activate
python main.py
```

用 `screen` / `tmux` 挂后台：

```bash
screen -S seatbot
python main.py
# Ctrl+A D 脱离
```

#### 方式 B：systemd 常驻保活 + cron 开抢

1）编辑 service 路径后安装：

```bash
sudo cp /opt/seatbot/scripts/seatbot.service /etc/systemd/system/
sudo nano /etc/systemd/system/seatbot.service
```

确认类似：

```ini
WorkingDirectory=/opt/seatbot
ExecStart=/opt/seatbot/.venv/bin/python /opt/seatbot/main.py --keepalive-only
User=seatbot
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now seatbot
sudo systemctl status seatbot
```

2）开抢前几分钟用 cron 触发一次预约（示例：每天 05:55）：

```bash
sudo crontab -u seatbot -e
```

写入：

```cron
55 5 * * * cd /opt/seatbot && /opt/seatbot/.venv/bin/python main.py --now >> /opt/seatbot/logs/cron.log 2>&1
```

时区请确认服务器为 `Asia/Shanghai`，或在 cron 前设置：

```bash
timedatectl   # 查看
# 如需：sudo timedatectl set-timezone Asia/Shanghai
```

#### 方式 C：只靠 cron（不常驻）

适合你每天开抢前手动上传一次新 `session.json`：

```cron
# 每天 05:50 开抢（会话需事先有效）
50 5 * * * cd /opt/seatbot && .venv/bin/python main.py --now >> logs/cron.log 2>&1
```

注意：无常驻保活时，网关 Cookie 更容易过期，开抢前最好重新 `--login` 并上传。

---

## 四、日常操作清单

| 场景 | 操作 |
|------|------|
| 每天/每次开抢前 | 本机 `python main.py --login` → 上传 `session.json` |
| 会话还有效 | 可只依赖服务器心跳，不必每天重登 |
| 收到失效通知 / 日志报 CAS | 本机重新登录并上传 |
| 改座位或时间 | 改本机与服务器的 `config.yaml`，重启相关进程 |
| 查看日志 | 服务器 `tail -f /opt/seatbot/logs/seatbot.log` |

会话失效时，若配置了 `notify_webhook`，会推送提示；进程会监视 `session.json` 更新，你上传新文件后自动继续保活。

---

## 五、关于「能保活多久」

根据 HAR 实测：

- **图书馆 `access_token`**：约 **10 分钟**（抢座前脚本会重新 OCR 登录换票）
- **网关 Cookie（session.json）**：HAR 无法给出准确上限；有心跳时通常可撑数小时，长时间空闲更容易失效

因此推荐：

- 服务器 `keepalive_interval: 180`（3 分钟）左右
- 开抢前数小时内完成本机登录并上传
- 不要把心跳设得过密（如几秒一次），容易触发风控

---

## 六、常见问题

**1. 提示被重定向到 pass.hust.edu.cn**
网关会话失效。本机重新 `python main.py --login`，再上传 `session.json`。

**2. 验证码总失败**
图书馆 4 位码由 `ddddocr` 识别，可增大 `captcha_retries`。与统一认证动态码无关。

**3. 服务器装 ddddocr / onnxruntime 失败**
确认 Python 版本 ≥ 3.10；必要时换国内 pip 源：

```bash
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

**4. 到点没抢上**
检查：服务器时区、`grab_at`、`day_offset`、座位是否已被占、日志里是否登录失败或网关失效。

**5. Windows 本机没有 bash**
上传用 PowerShell：

```powershell
scp session.json user@服务器:/opt/seatbot/
```

---

## 七、安全建议

1. `chmod 600 config.yaml session.json`
2. 仅用 SSH/scp 传输会话，不要发到 QQ/网盘公开链接
3. `.gitignore` 已排除 `config.yaml`、`session.json`、`logs/`
4. 仅预约本人座位，遵守图书馆使用规则
5. 服务器防火墙只开放你需要的 SSH，不要把项目目录做成公开 HTTP 站点

---

## 八、命令速查

```bash
# 本机
python main.py --login
./scripts/upload_session.sh user@host:/opt/seatbot/

# 服务器
python main.py                  # 保活直到 grab_at 再抢
python main.py --now            # 立即执行
python main.py --dry-run --now  # 演练
python main.py --keepalive-only # 只保活

# systemd
sudo systemctl status seatbot
sudo systemctl restart seatbot
journalctl -u seatbot -f
```

更完整的接口与模块说明见同目录 `README.md`。
