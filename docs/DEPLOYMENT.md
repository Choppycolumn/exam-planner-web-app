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

- 项目目录：`/opt/exam-planner`
- Node 入口：`/opt/exam-planner/server/auth-static-server.mjs`
- 监听地址：`127.0.0.1:8080`
- systemd 服务：`exam-planner`
- 反向代理：Nginx
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

## 推荐发布流程

1. 本地确认 `npm run lint && npm test && npm run build` 通过。
2. 在服务器创建备份：`POST /api/backups/run` 或登录服务器执行维护备份。
3. 上传 `dist/`、`server/`、`package.json`、`package-lock.json`。
4. 服务器执行 `npm ci --omit=dev`。
5. 重启服务：`systemctl restart exam-planner`。
6. 验证：`curl http://127.0.0.1:8080/health` 与浏览器访问站点。

## 辅助脚本

`scripts/deploy-exam-planner.ps1` 是一个可复用的部署脚本模板。默认要求 SSH/SCP 可用，并建议使用密钥登录，不在脚本中保存密码。
