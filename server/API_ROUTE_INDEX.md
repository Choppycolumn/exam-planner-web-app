# 后端路由与模块索引

`server/auth-static-server.mjs` 现在作为生产入口和兼容编排层保留，不再承担所有基础设施与路由细节。新增拆分边界如下：

## 基础设施

- `server/core/date-time.mjs`：日期、周/月周期、ISO 日期工具。
- `server/core/sqlite-cli.mjs`：SQLite CLI 执行、JSON/scalar 查询、SQL 值转义。
- `server/http/http-utils.mjs`：JSON/HTML 响应、受限 JSON body、header 工具。
- `server/http/static-assets.mjs`：静态资源与 SPA fallback。
- `server/auth/session-auth.mjs`：Cookie session、只读/写入角色、登录失败锁定、客户端 IP/hash、secret 比较。

## 服务层

- `server/services/backup-service.mjs`：SQLite 备份、恢复、备份校验缓存、每日/每周保留策略、备份状态。

## 路由层

- `server/routes/public-api-routes.mjs`
  - `POST /api/import`
  - `POST /api/break-guard/events`
  - `GET /api/dictionary/lookup`
  - `/api/confusing-words/backup*`
  - `POST /api/telegram/webhook`

- `server/routes/proxy-settings-routes.mjs`
  - `GET /api/settings/mihomo`
  - `POST /api/settings/mihomo/subscription`
  - `POST /api/settings/mihomo/import`
  - `POST /api/settings/mihomo/select`
  - `POST /api/settings/mihomo/test`

- `server/routes/ops-routes.mjs`
  - `/api/backups/*`
  - `GET /api/tasks/status`
  - `GET /api/learning-progress`
  - `GET /api/project-progress`
  - `GET /api/visits/summary`
  - `GET /api/ops/logs/summary`
  - `/api/maintenance/*`

- `server/routes/notification-routes.mjs`
  - `GET /api/notifications/center`
  - `POST /api/notifications/ack`
  - `POST /api/notifications/retry-delivery`
  - `POST /api/notifications/bark/test`
  - `/api/notifications/telegram/*`

- `server/routes/brief-routes.mjs`
  - `GET /api/briefs/settings`
  - `GET /api/briefs/today`
  - `GET /api/briefs`
  - `POST /api/briefs/settings`
  - `POST /api/briefs/generate`
  - `POST /api/briefs/send-latest`

- `server/routes/learning-read-routes.mjs`
  - Dashboard、目标、项目、科目、复盘、学习记录、模考、报告和错因分析只读接口。

- `server/routes/learning-write-routes.mjs`
  - 目标、项目、科目、任务、复盘、学习记录、饮水和问题收件箱写入接口。

已下线的 `/api/library/*` 与 `/api/market-copilot*` 统一返回 `410 Gone`。实现代码已经从生产运行时移除，历史数据库表和资料文件只由备份系统保留。

## 仍在入口内的兼容逻辑

以下逻辑仍在 `auth-static-server.mjs` 内，主要因为它们与历史 SQLite 表创建、旧数据迁移、报表/错因分析、Telegram 命令执行上下文耦合较深：

- SQLite 历史表创建与旧 JSON 迁移兼容。
- 学习领域的数据计算和 SQLite repository 实现；HTTP 路由已完成拆分。
- 错因主题分析与 embedding worker 调度。
- 每日简报的数据采集与 HTML 邮件生成内部实现。
- Telegram 命令解释的业务执行函数。

后续继续拆分时，优先顺序建议：

1. 学习 CRUD repository：goals/projects/subjects/reviews/study-records/mock-exams/tasks。
2. 错因分析 service：rule candidates、embedding candidates、batch job。
3. Daily brief service：设置、行情采集、天气、市场指数评估、HTML/Markdown 生成。
4. Telegram command service：命令解析后的执行层。
5. SQLite schema builder：逐步把历史内联建表 SQL 迁入版本化 migration；现有生产表暂不破坏性重建。
