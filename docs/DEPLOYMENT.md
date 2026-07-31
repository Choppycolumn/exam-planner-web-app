# 部署说明

## 本地开发

```bash
npm install
npm run dev
```

Vite 默认地址：

```text
http://127.0.0.1:5173/
```

如需连接生产后端，可以在 `.env.local` 配置：

```text
VITE_API_PROXY_TARGET=http://127.0.0.1:8080
```

## 构建

```bash
npm run lint
npm test
npm run build
npm run check:bundle
```

构建产物在 `dist/`。

## 生产运行

当前服务器运行方式：

- 共享数据目录：`/opt/exam-planner/data`
- 版本目录：`/opt/exam-planner/releases/<release-id>`
- 当前版本链接：`/opt/exam-planner/current`
- Node 入口：`/opt/exam-planner/current/server/web.mjs`
- 监听地址：`127.0.0.1:8080`
- systemd 服务：`exam-planner`
- 反向代理：Nginx
- 静态资源池：`/opt/exam-planner/shared/assets`（按内容哈希命名，默认保留 14 天）
- 当前 HTML：由 Node 从 `/opt/exam-planner/current/dist` 提供
- 公网：80 跳转 443，443 反代到 8080
- HTTPS：Certbot/Let's Encrypt
- Docker：未发现
- PM2：未发现

## systemd 建议

不要把真实密码写进仓库。生产环境变量建议放在：

```text
/etc/systemd/system/exam-planner.service
/etc/systemd/system/exam-planner.service.d/*.conf
```

变量名见 `.env.example`。

Telegram Bot 可以在通知中心配置。Webhook URL 填写网站 HTTPS 根地址，服务会注册 `/api/telegram/webhook`；只允许配置的 Telegram 用户和 Chat 操作，运维动作使用 5 分钟有效的一次性确认按钮。

## 发布流程

1. 本地确认 `npm run lint && npm test && npm run build` 通过。
2. `scripts/deploy-production.ps1` 上传完整候选包。
3. 服务器暂停正在运行的 HBR，取得统一重 I/O 锁，在临时目录执行语法、健康、认证写入和 Break Guard 幂等测试。
4. 切换线上服务前检查负载、可用内存、I/O wait 和 D 状态进程；超出预算则停止发布。
5. 创建并校验部署前 SQLite 快照。
6. 候选包移动到新的版本目录；切换前把所有仍可回滚版本及候选版的内容哈希资源发布到共享资源池。
7. 以原子软链接切换 `current`，启动 Web 和 Worker，验证 `/health`、`/ready`，并逐字节核对 Nginx 返回的主 JavaScript与当前版本构建产物一致。
8. 发布成功后记录当前版本、上一版本和激活时间，供运行时健康守护判断是否允许自动回滚。
9. 失败时把 `current` 立即切回上一版本；共享数据目录和旧版静态资源不会被版本切换覆盖。

HBR 原服务不再开机常驻，而由 03:05 开窗、06:45 关窗的 systemd timer 控制。运行期间每 2 分钟检查一次压力；超预算会自动停止 HBR。发布结束后只会在合法维护窗口且压力检查通过时恢复它。

手动回滚：

```bash
bash /opt/exam-planner/current/scripts/rollback-release.sh previous
```

默认保留最近 5 个版本；这些版本的静态资源会持续续期，版本目录被淘汰后仍默认保留 14 天，因此旧标签页和缓存 HTML 在发布后仍可加载原版本资源。资源过期清理由发布脚本执行，且不会覆盖同名不同内容的文件。

## 运行时恢复

`exam-planner-health-watchdog.timer` 每 2 分钟检查一次 Web、Worker、特权服务、Nginx、`/ready` 以及当前主 JavaScript 的长度、哈希和 MIME：

- 首次失败只记录，避免瞬时抖动触发操作。
- 连续失败时重启异常服务，并有 10 分钟动作冷却。
- 新版本激活后 6 小时内连续失败达到阈值时，只能自动回滚到发布元数据明确记录的上一版本。
- 每个版本最多自动回滚一次；部署与回滚共用文件锁，禁止并发切换。

## 辅助脚本

`scripts/deploy-production.ps1` 与 `scripts/remote-deploy.sh` 是当前生产发布入口。脚本不在仓库保存服务器密码。
