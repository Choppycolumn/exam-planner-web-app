# 后端细粒度拆分与维护报告（2026-07-09）

## 完成内容

- 将生产入口 `server/auth-static-server.mjs` 从约 8,828 行缩减到约 7,728 行。
- 新增基础设施层：日期、SQLite CLI、HTTP body/response、静态资源服务、Session/Auth。
- 新增路由层：public、proxy settings、ops、notifications、briefs、library、market copilot。
- 新增服务层：backup service，备份/恢复/校验/保留策略从入口中移出。
- 保留所有原有 API 路径、登录方式、Cookie session、只读模式、通知队列、每日简报推送、Break Guard 同步、Market Copilot 账本接口。
- 新增认证模块回归测试，覆盖 session role 和登录失败锁定返回值。

## 新增核心文件

- `server/core/date-time.mjs`
- `server/core/sqlite-cli.mjs`
- `server/http/http-utils.mjs`
- `server/http/static-assets.mjs`
- `server/auth/session-auth.mjs`
- `server/auth/session-auth.test.mjs`
- `server/services/backup-service.mjs`
- `server/routes/public-api-routes.mjs`
- `server/routes/proxy-settings-routes.mjs`
- `server/routes/ops-routes.mjs`
- `server/routes/notification-routes.mjs`
- `server/routes/brief-routes.mjs`
- `server/routes/library-routes.mjs`
- `server/routes/market-copilot-routes.mjs`
- `server/API_ROUTE_INDEX.md`

## 验证

- `node --check server/auth-static-server.mjs`：通过。
- `npm run lint`：通过。
- `npm test`：通过，14 个测试文件，42 个测试。

## 仍在入口内的内容

以下内容仍保留在 `auth-static-server.mjs`，原因是它们与历史 SQLite 表创建、旧数据迁移、报表/错因分析和命令执行上下文耦合较深，继续拆分需要更大范围回归：

- SQLite 历史表创建与旧 JSON 迁移兼容。
- 学习 CRUD：目标、项目、科目、复盘、模考、学习记录、饮水、问题收件箱。
- 错因分析和 embedding worker 调度。
- 每日简报内部采集与 HTML 邮件生成实现。
- ClawBot/Telegram 命令执行层。

## 后续拆分顺序

1. `learning-repository`：学习 CRUD 和 dashboard 数据。
2. `error-theme-service`：错因分析、embedding、批处理任务。
3. `daily-brief-service`：简报设置、行情、天气、HTML/Markdown 生成。
4. `command-service`：ClawBot/Telegram 命令执行。
5. `schema-service`：把内联建表 SQL 移入 schema/migration 层。
