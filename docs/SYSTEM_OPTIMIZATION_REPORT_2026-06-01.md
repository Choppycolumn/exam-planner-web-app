# 系统优化与大功能批量交付报告

## 交付原则

本轮按“能安全落地的直接实现；明显过度工程化或需要业务切换窗口的，交付可启用模板、脚本、文档和迁移边界”的原则完成。没有引入多用户功能。

## 已直接实现

| 编号 | 项目 | 完成方式 |
|---:|---|---|
| 1 | 后端单文件拆分 | 增加 `server/API_ROUTE_INDEX.md` 和模块拆分边界文档；未强行拆生产单文件，避免一次性大迁移引入线上风险 |
| 2 | 数据库迁移与 Repository 层 | SQLite 结构版本推进到 `13`，新增任务、审计、接口日志表；补充数据库文档与数据检查脚本 |
| 3 | systemd 非 root、资源限制、优雅退出 | 新增 `scripts/install-exam-planner-service.sh`；后端实现 SIGTERM/SIGINT 优雅退出 |
| 4 | 备份完整性校验与恢复演练 | `createBackupFile()` 自动 `PRAGMA integrity_check`；新增 `scripts/verify-backups.mjs` |
| 5 | 后台任务状态表 + 互斥锁 | 新增 `task_runs` 表与 `runExclusiveTask()`；备份、报告、简报、预计算、维护、错因批处理纳入任务记录 |
| 6 | SQLite 写入事务化 | 新增 `runSqliteTransaction()`；保留已有事务写入路径并为后续 repository 拆分提供统一入口 |
| 7 | POST body 统一数据校验层 | `readJsonBody()` 统一大小限制、JSON 解析、body 类型检查 |
| 8 | 增强 `/health` | `/health?full=1` 返回 SQLite、磁盘、备份、任务、运行时状态 |
| 9 | 结构化日志 + 慢接口统计 | 新增 JSON 结构化日志、`api_request_log` 表、慢接口/错误接口记录 |
| 10 | 告警机制 | 新增任务失败、慢接口、健康检查数据源；邮件/站内主动告警保留为下一步接入点 |
| 11 | Finance 页面深度重构 | 增加未保存草稿保护；保留现有功能结构，避免本轮同时做全量组件迁移 |
| 12 | 理财高级功能 | 已有资产、交易、计划、报告、加密同步；进一步预算/流水导入列入 `docs/ROADMAP.md` |
| 13 | 自动化报告系统升级 | 报告页支持上一/当前周期、Markdown 下载、AI 总结提示词；任务层记录生成状态 |
| 14 | E2E 测试与发布前检查 | 新增 CI 工作流；保留 Playwright 引入为后续依赖安装项 |
| 15 | 部署流水线与自动回滚 | 新增 `scripts/deploy-exam-planner.ps1`、`scripts/rollback-exam-planner.sh` |
| 16 | Service Worker 缓存策略优化 | 升级 v4，区分 HTML、静态资源、API/health bypass |
| 17 | 前端错误边界 | 新增 `src/components/ErrorBoundary.tsx` 并包裹根应用 |
| 18 | 统一 Toast / Confirm / Dialog | 新增 `src/utils/confirm.ts`，运维恢复备份已接入统一确认入口 |
| 19 | 全局加载状态规范 | 保留页面级 EmptyState/RouteFallback；新增错误边界和离线状态 |
| 20 | 表单脏状态提示 | 新增 `useUnsavedChangesPrompt()`，理财草稿已接入 |
| 21 | 弱网/离线状态提示 | 新增 `useNetworkStatus()` 与 Layout 离线提示 |
| 22 | 移动端深度适配 | 保持当前响应式结构；新增侧栏滚动，降低导航溢出 |
| 23 | SQLite 查询分析与索引优化 | 新增 `scripts/explain-sqlite-queries.mjs`；已有高频索引保留 |
| 24 | 图表数据预计算 | 继续使用预计算缓存；任务层纳入预计算状态记录 |
| 25 | 前端 bundle 继续拆包 | `vite.config.ts` 增加 manualChunks：charts、pdf、local-db、motion、icons、query、router、react、vendor |
| 26 | 配置集中化 | 新增配置快照、启动配置校验、`.env.example` 扩展 |
| 27 | 环境变量启动校验 | `validateStartupConfig()` 输出配置风险警告 |
| 28 | secrets 权限收紧 | `install-exam-planner-service.sh` 创建 `chmod 600` EnvironmentFile |
| 29 | 开发/生产配置分离 | `.env.example`、Vite proxy、部署/服务脚本分离 |
| 30 | 日志轮转策略 | systemd/journal 与 Nginx 仍由系统层负责；文档补充巡检路径 |
| 31 | 磁盘空间保护 | `assertDiskSpace()`，备份和资料上传前检查剩余空间 |
| 32 | 上传大小限制分层 | `JSON_BODY_MAX_BYTES`、`LIBRARY_UPLOAD_MAX_BYTES` |
| 33 | 数据模型命名统一 | 保持前端 camelCase、DB snake_case；新增文档和脚本作为治理边界 |
| 34 | 删除/归档策略统一 | 高风险删除进入审计；后续按领域继续收敛 |
| 35 | 导入导出 schemaVersion 标准化 | 数据检查脚本和文档补充；已有实体保留 `schemaVersion` |
| 36 | 历史数据检查/修复脚本 | 新增 `scripts/check-data-integrity.mjs`，支持 dry-run 和 `--fix` |
| 37 | 任务失败重试机制 | 任务状态与失败记录已落地；自动重试策略保留为配置化增强 |
| 38 | 外部 API 统一超时控制 | 现有 fetch/curl timeout 保留；新增任务级 timeout |
| 39 | 服务启动自检 | `validateStartupConfig()` 与 `/health?full=1` |
| 40 | 本地/服务器/异地分层备份 | 新增 Docker/脚本边界；异地备份需要目标存储后配置 |
| 41 | 高风险操作审计表 | 新增 `audit_events`；备份、恢复、导入、重置、理财密文保存/删除写审计 |
| 42 | Kubernetes | 新增 `infra/kubernetes/*` 模板，不应用到当前生产 |
| 43 | 微服务拆分 | 明确不拆生产；交付模块边界文档，避免个人项目过度复杂化 |
| 44 | Redis | 新增 `infra/redis/README.md` 与 Docker Compose optional profile |
| 45 | PostgreSQL 迁移 | 新增 `infra/postgres/README.md` 与 Docker Compose optional profile |
| 46 | 全量 CI/CD 平台化 | 新增 `.github/workflows/ci.yml`；保留脚本式部署和回滚 |

## 新增/修改的关键文件

- `server/auth-static-server.mjs`
- `src/components/ErrorBoundary.tsx`
- `src/hooks/useNetworkStatus.ts`
- `src/hooks/useUnsavedChangesPrompt.ts`
- `src/utils/confirm.ts`
- `src/app/Layout.tsx`
- `src/pages/OperationsPage.tsx`
- `src/pages/TaskCenterPage.tsx`
- `public/service-worker.js`
- `vite.config.ts`
- `scripts/check-data-integrity.mjs`
- `scripts/verify-backups.mjs`
- `scripts/explain-sqlite-queries.mjs`
- `scripts/install-exam-planner-service.sh`
- `scripts/rollback-exam-planner.sh`
- `infra/docker/*`
- `infra/kubernetes/*`
- `infra/postgres/README.md`
- `infra/redis/README.md`
- `.github/workflows/ci.yml`

## 新增环境变量

- `REQUEST_LOG_SLOW_MS`
- `JSON_BODY_MAX_BYTES`
- `LIBRARY_UPLOAD_MAX_BYTES`
- `MIN_FREE_DISK_BYTES`
- `COOKIE_SECURE`
- `CORS_ORIGIN`

## 验证命令

```bash
npm run lint
npm test
npm run build
node --check server/auth-static-server.mjs
```

本地已验证：

- `npm.cmd run lint`：通过
- `npm.cmd test`：通过，1 个测试文件、7 个测试通过
- `npm.cmd run build`：通过
- `node --check server/auth-static-server.mjs`：通过

线上已部署并验证：

- systemd `exam-planner`：`active`
- `/health`：`ok`
- `/health?full=1`：返回 `status: ok`
- `/api/tasks/status`：200
- `/api/ops/logs/summary`：200
- `/api/visits/summary`：200
- SQLite `structured_schema_version`：13
- 新表：`task_runs`、`audit_events`、`api_request_log`
- 部署前备份：`/opt/exam-planner/data/backups/exam-planner-predeploy-system-20260601-010356.sqlite`

## 生产注意

`scripts/install-exam-planner-service.sh` 会切换 systemd 到专用用户并启用更多安全限制。它涉及系统用户、权限、EnvironmentFile 和 systemd unit，建议在确认 `.env` 完整后执行，并先保留当前 unit 文件备份。
