# 本轮优化与新功能交付报告

## 交付范围

已按要求跳过：资料库增强、对外个人主页入口、笔记/知识库、RSS/公开输出、多语言、多用户功能。

本轮完成：文档补全、环境变量模板、忽略规则、Lint 修复、API 错误统一、深色模式、学习进度仪表盘、项目进展看板、学习报告导出与 AI 总结提示词、访问统计、备份管理、日志摘要、部署脚本、数据库结构版本推进。

## 关键新增页面

- `/progress`：学习进度仪表盘，展示近 30 天学习趋势、目标达成、复盘评分、任务完成、项目投入。
- `/project-progress`：项目进展看板，展示各学习项目总投入、近 30 天投入、占比、最近活跃时间和趋势。
- `/operations`：运维观察台，集中展示备份管理、访问统计、热门路径、最近访问和日志摘要。
- `/reports`：增强为当前/上一周期周报月报生成、Markdown 下载、复制报告、复制 AI 总结提示词。
- `/finance`：保留并接入导航，作为本地加密理财管理页，支持资产、交易、计划、密文同步和报表导出。

## 后端/API 新增

- `GET /api/learning-progress`
- `GET /api/project-progress`
- `GET /api/visits/summary`
- `GET /api/ops/logs/summary`

访问统计新增 SQLite 表 `visit_events`，只记录路径、角色、脱敏访客哈希、浏览器摘要和时间；不保存明文 IP。SQLite 结构版本当日推进到 `12`，2026-06-01 系统优化继续推进到 `13`。

## 运维与部署

已部署到服务器 `/opt/exam-planner`，服务 `exam-planner` 已重启并验证 `active`。部署前创建 SQLite 备份：

```text
data/backups/exam-planner-predeploy-20260531-222054.sqlite
```

部署时保留：

- `dist.prev`
- `server/auth-static-server.mjs.predeploy-20260531-222054`
- `package.json.predeploy-20260531-222054`
- `package-lock.json.predeploy-20260531-222054`

## 本地验证

已通过：

```bash
npm run lint
npm test
npm run build
node --check server/auth-static-server.mjs
```

远程验证：

- `systemctl is-active exam-planner`：active
- `curl http://127.0.0.1:8080/health`：ok
- HTTPS 首页：200
- `/api/learning-progress`：200
- `/api/project-progress`：200
- `/api/visits/summary`：200
- `/api/ops/logs/summary`：200
- `structured_schema_version`：12，当日之后系统优化版本为 13
- `visit_events`：已存在

## 文档

- `docs/ARCHITECTURE.md`
- `docs/API.md`
- `docs/DATABASE.md`
- `docs/DEPLOYMENT.md`
- `docs/OPERATIONS.md`
- `docs/ROADMAP.md`
- `server/API_ROUTE_INDEX.md`

## 仍建议后续处理

- 将 `server/auth-static-server.mjs` 按领域拆分，降低单文件维护成本。
- 将 systemd 服务从 root 切换到专用低权限用户。
- 生产环境设置 `COOKIE_SECURE=1`。
- 将 `CORS_ORIGIN` 从 `*` 收窄到明确来源；当前默认保留 `*` 是为了兼容本地易混词跨源备份。
- Finance 页面继续拆组件，当前功能完整但页面文件较大。
- 对关键后端 API 增加集成测试。
