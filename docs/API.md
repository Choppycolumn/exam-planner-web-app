# API 说明

所有业务接口都以 `/api` 开头。前端统一通过 `src/api/client.ts` 的 `serverApi` 调用。

## 通用约定

- 成功响应：JSON。
- 失败响应：`{ "error": "..." }` 或纯文本错误。
- 前端 `apiRequest()` 已统一解析错误文案，并附加 `error.status`。
- 非 GET 写入接口在只读会话下会返回 `403`。

## 认证

- `POST /login`：表单登录。
- `GET /health`：健康检查，不需要登录。
- Cookie：`exam_planner_session`，HttpOnly，SameSite=Lax。

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

## 理财

- `GET /api/finance-public/fund`
- `GET /api/finance-public/usd-cny`
- `GET /api/finance-public/stablecoin-rates`
- `GET /api/finance-vault`
- `POST /api/finance-vault`
- `DELETE /api/finance-vault`

理财明文数据只在浏览器解密；服务端只保存 AES-GCM 密文与同步元数据。

## 资料库与词典

- `GET /api/dictionary/lookup`
- `GET /api/confusing-words/backup`
- `POST /api/confusing-words/backup`
- `GET /api/library/books`
- `GET /api/library/books/:id`
- `GET /api/library/books/:id/text`
- `GET /api/library/books/:id/file`
- `GET /api/library/search`
- `POST /api/library/upload`
- `POST /api/library/books/save`
- `POST /api/library/books/remove`
- `POST /api/library/progress`
- `POST /api/library/notes/save`
- `POST /api/library/bookmarks/save`
- `POST /api/library/bookmarks/remove`

## 运维

- `GET /api/backups/status`
- `POST /api/backups/run`
- `POST /api/backups/restore`
- `GET /api/tasks/status`
- `POST /api/maintenance/sqlite`
- `POST /api/maintenance/precompute`
- `GET /api/visits/summary`
- `GET /api/ops/logs/summary`

日志接口会脱敏 Cookie、Password、Token、Secret、Authorization 等敏感片段。
