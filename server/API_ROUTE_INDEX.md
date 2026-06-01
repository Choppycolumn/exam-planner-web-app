# server/auth-static-server.mjs 路由索引

后端仍是单文件服务。为了后续拆分，先按领域建立索引：

## 认证与静态资源

- `POST /login`
- `GET /health`
- 静态文件与 SPA fallback：`serveStatic()`

## 学习数据

- Dashboard：`/api/dashboard`、`/api/dashboard/charts`
- Goals：`/api/goals*`
- Projects：`/api/projects*`
- Subjects：`/api/subjects*`
- Study records：`/api/study-records*`
- Reviews：`/api/reviews*`
- Mock exams：`/api/mock-exams*`、`/api/exams/save`
- Tasks：`/api/tasks*`
- Water：`/api/water/save`
- Progress：`/api/learning-progress`、`/api/project-progress`

## 自动化

- Reports：`/api/reports*`
- Briefs：`/api/briefs*`
- Error themes：`/api/error-themes*`
- Maintenance：`/api/maintenance/*`

## 资料与词典

- Dictionary：`/api/dictionary/lookup`
- Confusing words：`/api/confusing-words/backup`
- Library：`/api/library*`

## 理财

- Public quotes：`/api/finance-public/*`
- Vault sync：`/api/finance-vault`

## 运维

- Backups：`/api/backups/*`
- Runtime status：`/api/tasks/status`
- Visits：`/api/visits/summary`
- Logs：`/api/ops/logs/summary`

## 拆分建议

优先拆出：

- `server/modules/http.js`：`sendJson`、`sendHtml`、body parser、static serving。
- `server/modules/auth.js`：login、cookie、lockout。
- `server/modules/db.js`：SQLite helper、schema、migration。
- `server/modules/learning.js`：学习数据读写。
- `server/modules/reports.js`：报告、简报、错因。
- `server/modules/finance.js`：理财密文同步和行情。
- `server/modules/library.js`：资料库。
- `server/modules/ops.js`：备份、访问统计、日志摘要。
