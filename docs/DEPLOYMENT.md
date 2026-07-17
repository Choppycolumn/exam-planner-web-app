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
- 静态资源根目录：`/opt/exam-planner/current/dist`（必须跟随 `current`，不能固定到旧版 `dist`）
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
3. 服务器在临时目录执行语法、健康、认证写入和 Break Guard 幂等测试。
4. 创建并校验部署前 SQLite 快照。
5. 候选包移动到新的版本目录，以原子软链接切换 `current`。
6. 启动 Web 和 Worker，验证 `/health`、`/ready`，并逐字节核对 Nginx 返回的主 JavaScript 与当前版本构建产物一致。
7. 失败时把 `current` 立即切回上一版本；共享数据目录不会被版本切换覆盖。

手动回滚：

```bash
bash /opt/exam-planner/current/scripts/rollback-release.sh previous
```

默认保留最近 5 个版本。

## 辅助脚本

`scripts/deploy-production.ps1` 与 `scripts/remote-deploy.sh` 是当前生产发布入口。脚本不在仓库保存服务器密码。
