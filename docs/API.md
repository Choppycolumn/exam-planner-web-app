# API 说明

所有业务接口都以 `/api` 开头。前端统一通过 `src/api/client.ts` 的 `serverApi` 调用。

## 通用约定

- 成功响应：JSON。
- 失败响应：`{ "error": { "code", "message", "requestId" }, "message", "requestId" }`。
- `shared/api-contracts.js` 是前后端共享的路径、方法、基础字段和 capability 来源。
- 前端 `apiContractRequest()` 统一拼接查询参数、超时、错误和凭据。
- 非 GET 写入接口在只读会话下返回 `403`；缺少 capability 同样返回 `403`。

## 认证

- `POST /login`：表单登录。
- `POST /register-invite`：使用一次性邀请码建立成员学习空间。
- `GET /health`：健康检查，不需要登录。
- `GET /ready`：启动、静态资源、数据库和迁移就绪检查。
- Cookie：`exam_planner_session`，HttpOnly，SameSite=Lax。

## 账户与权限

- `GET /api/session`
- `GET /api/users`
- `POST /api/users/invites`
- `POST /api/users/invites/revoke`
- `POST /api/users/update`
- `POST /api/users/reset-password`
- `POST /api/users/revoke-sessions`

用户管理只允许 `users.manage`。停用账户、重置密码和手动撤销都会使现有会话失效。

## 学习核心

- `GET /api/dashboard`
- `GET /api/dashboard/charts`
- `GET /api/state`
- `GET /api/goals`
- `POST /api/goals/save`
- `POST /api/goals/activate`
- `POST /api/goals/remove`
- `GET /api/projects`
- `POST /api/projects/save`
- `POST /api/projects/remove`
- `GET /api/subjects`
- `POST /api/subjects/save`
- `POST /api/subjects/remove`
- `GET /api/study-records?date=YYYY-MM-DD`
- `POST /api/study-records/save-day`
- `GET /api/reviews`
- `GET /api/reviews/prefill`
- `GET /api/reviews/trend`
- `POST /api/reviews/upsert`
- `GET /api/statistics/summary`
- `GET /api/learning-progress`
- `GET /api/project-progress`
- `GET /api/study-comparison`
- `GET /api/focus-timer`
- `POST /api/focus-timer/action`

## 报告与错因

- `GET /api/reports`
- `POST /api/reports/generate`
- `GET /api/error-themes/analysis`
- `GET /api/error-themes/detail`
- `GET /api/error-themes/options`
- `GET /api/error-themes/embedding/status`
- `GET /api/error-themes/batch/status`
- `POST /api/error-themes/batch/run`
- `POST /api/error-themes/corrections/save`

## 通知简报

- `GET /api/briefs`
- `GET /api/briefs/today`
- `GET /api/briefs/settings`
- `POST /api/briefs/settings`
- `POST /api/briefs/generate`
- `POST /api/briefs/send-latest`

## Telegram Bot

- `POST /api/telegram/webhook`：Telegram 更新入口，使用 Webhook Secret Header 校验。
- `POST /api/notifications/telegram/settings`：保存 Bot Token、Chat ID、授权用户和 Webhook URL。
- `POST /api/notifications/telegram/register`：注册 Webhook 与命令菜单。
- `POST /api/notifications/telegram/test`：发送测试消息。

支持待办创建、查询、完成、延期、简报查询、健康状态查询，以及经过一次性按钮确认的备份、SQLite 维护和简报重发。

## 词典与多端备份

- `GET /api/dictionary/lookup`
- `GET /api/confusing-words/backup`
- `POST /api/confusing-words/backup`

资料库与理财情报台已经下线，`/api/library/*` 和 `/api/market-copilot*` 仅保留 `410 Gone` 兼容响应，避免旧客户端误写数据。

## 运维

- `GET /api/backups/status`
- `POST /api/backups/run`
- `POST /api/backups/restore`
- `GET /api/tasks/status`
- `POST /api/maintenance/sqlite`
- `POST /api/maintenance/precompute`
- `GET /api/visits/summary`
- `GET /api/ops/logs/summary`
- `POST /api/client-errors`

日志接口会脱敏 Cookie、Password、Token、Secret、Authorization 等敏感片段。`/api/client-errors` 用于前端错误摘要上报，读写会话都允许调用，但不会保存完整 URL 查询串或敏感值。
