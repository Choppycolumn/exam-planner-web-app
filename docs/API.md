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
- `GET /api/finance-exchange/status`
- `POST /api/finance-exchange/sync`
- `GET /api/finance-vault`
- `POST /api/finance-vault`
- `DELETE /api/finance-vault`

理财明文数据只在浏览器解密；服务端只保存 AES-GCM 密文与同步元数据。

交易所同步接口只在写入会话下可用，API Key 只从服务端环境变量读取，不返回给前端。Binance 和 Bitget 税务 Key 都按服务端密钥调用；Binance `LD*` 理财资产会按底层币种估值并归类为 Earn。Bitget Earn/活期理财余额来自 `/api/v2/earn/account/assets` 和 `/api/v2/earn/savings/assets`，需要带 passphrase 的只读 API；没有 passphrase 时会跳过现货/Earn 余额接口，只同步税务流水，并优先用流水里的 `balance` 字段生成资产快照；若没有 `balance` 字段，则按所选时间窗口内的税务流水金额累计生成估算资产。

- `GET /api/finance-exchange/status`：返回 Binance / Bitget 是否已配置、是否支持余额和税务流水同步。
- `POST /api/finance-exchange/sync`：请求体示例：

```json
{
  "providers": ["binance", "bitget"],
  "historyDays": 7,
  "includeTaxRecords": true
}
```

返回值包含规范化后的 `assets` 和 `transactions`。前端在浏览器中把它们合并进已解密的理财保险箱，再重新加密保存。

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
