# 2026-06-01 第二阶段系统升级实施报告

## 1. 本次目标范围

本轮继续执行个人网页项目的系统升级，重点包括：

- P0 优化继续落地：后端迁移体系、通知模型、日历接口、Finance 导入分析能力、首页驾驶舱增强。
- P1 中除前两个 Finance 预算/月报方向以外的事项继续落地：E2E 深化、运维通知预备、通知渠道扩展预案。
- 高优先级新功能落地：AI 周/月报中心增强、目标复盘系统、个人驾驶舱首页 3.0、日历视图。
- 工商银行一个月流水 PDF 解析可行性验证，并接入 Finance 页面导入入口。
- 部署到服务器并验证服务健康。

说明：用户明确要求暂不做 P1 前两个，即 Finance 预算系统和 Finance 周/月报 2.0，因此本轮未实现这两项。

## 2. 后端与数据库升级

新增正式 SQL migration 机制：

- 新增 `server/modules/migration-runner.mjs`
- 新增 `server/migrations/014_notifications_and_calendar.sql`
- `server/auth-static-server.mjs` 已接入 `runStructuredMigrations()`
- 服务器 SQLite `structured_schema_version` 已升级到 `14`

新增通知相关表：

- `notification_channels`
- `notification_rules`
- `notification_events`
- `notification_deliveries`

新增通知/日历仓储：

- `server/modules/notification-repository.mjs`
- `server/modules/calendar-repository.mjs`
- `server/modules/notification-dispatcher.mjs`

新增后端接口：

- `GET /api/notifications/center`
- `POST /api/notifications/ack`
- `GET /api/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`

日报和学习报告现在会写入统一通知事件模型。运维检查会在任务中心和运维日志接口读取时尝试沉淀磁盘、任务失败、接口错误等预警事件。

## 3. 通知模型与外部通道预案

当前已完成：

- 站内通知事件模型
- 通知通道表
- 通知规则表
- 通知投递表
- 通知中心前端展示
- 事件确认能力
- 通道 readiness 展示
- Telegram、企业微信/微信中转、通用 Webhook 的投递请求构造骨架

预留环境变量：

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `WECOM_WEBHOOK_URL`
- `NOTIFICATION_WEBHOOK_URL`

建议下次拍板：

- Telegram：通过 Bot API `sendMessage` 发送文本通知。
- 企业微信：优先使用群机器人 Webhook，支持 `markdown`/`text`。
- 微信个人通知/Claw：建议先接通用 Webhook，由 Claw 或中转服务负责转发到微信侧。
- 不建议直接接微信公众号模板消息，除非已经准备好公众号、模板、用户 openid 和服务端授权流程。

当前没有真正对外发送消息，避免在未拍板前产生外部通知。

## 4. 日历视图

新增页面：

- `src/pages/CalendarPage.tsx`

新增路由：

- `/calendar`

日历聚合数据来源：

- 学习时间记录
- 每日复盘
- 短期任务
- 学习周报/月报
- 站内通知事件

日历页支持：

- 月份切换
- 回到本月
- 每日事件聚合
- 学习/复盘/任务/报告/通知分类统计
- 桌面和移动端 E2E 冒烟覆盖

## 5. 目标复盘系统

新增页面：

- `src/pages/GoalReviewPage.tsx`

新增路由：

- `/goal-review`

目标复盘系统会聚合：

- 当前长期目标
- 总学习时长和目标时长
- 最近主项目
- 项目动量
- 最近学习报告
- 未完成短期任务
- 今日/昨日复盘信息

它的定位是每周打开一次，用来回答“长期目标是否偏航、主项目是否仍然正确、哪些项目该暂停或恢复、今天最小推进动作是什么”。

## 6. 个人驾驶舱首页 3.0

首页新增三个快速入口：

- 目标复盘
- 本月日历
- 未确认通知

首页现在能更快进入“目标校准、节奏查看、通知处理”三个系统级动作，避免新功能散落在导航里。

## 7. Finance 工行流水 PDF 导入与分析

新增浏览器端 PDF 解析能力：

- `src/features/finance/bankImport.ts`
- `src/features/finance/bankImport.test.ts`

Finance 页面新增入口：

- 在同步/导入区域增加“导入工行流水 PDF”

实现方式：

- 使用 `pdfjs-dist` 在浏览器端解析 PDF。
- 明文流水只在浏览器端解析，不上传服务端。
- 导入后转换为 Finance `transactions`。
- 保存时仍进入本地加密保险箱，再按原有机制同步密文。

本地验证脚本：

- `scripts/parse-icbc-statement.py`

对用户提供的文件：

- `E:\download\工商银行历史明细（申请单号：26060112055154853819）.pdf`

解析结果：

- 识别流水：228 条
- 跳过片段：50 条
- 跳过内容主要是页眉、页脚、页码、下单时间、二维码说明等非交易文本
- 本地生成了解析预览文件到 `data/analysis`
- `data/analysis` 已加入 `.gitignore`，避免流水明文进入版本管理

解析汇总：

- 收入：714.56 CNY
- 支出：2397.97 CNY
- 投资流出/流入合计分类：827.40 CNY
- 转账类：12639.19 CNY
- 净现金流：-1683.41 CNY

注意：

- 工行 PDF 内存在换行拆分、页脚日期误识别、商户名跨行等问题。本轮解析器已经通过“日期时间锚点切分”解决主要结构问题，但仍建议导入后在 Finance 页面人工抽查分类。
- 当前分类是规则推断，不等于银行官方消费分类。

## 8. AI 周/月报中心增强

已有 Reports 页面继续作为 AI 报告中心使用：

- 周报/月报生成
- Markdown 导出
- AI 总结提示词复制
- 报告会写入通知事件

本轮没有实现 Finance 月报 2.0，因为这是用户明确排除的 P1 前两项之一。

## 9. E2E 与验证

本地验证已通过：

- `npm run lint`
- `npm test`
- `npm run build`
- `npm run e2e`
- `node --check server/auth-static-server.mjs`
- `node --check server/modules/notification-dispatcher.mjs`
- `python -m py_compile scripts/parse-icbc-statement.py`

E2E 覆盖：

- 首页
- 运维页
- 后台任务中心
- 日历视图
- 通知中心
- 目标复盘
- Finance 页面
- 桌面 Chromium
- 移动端 Pixel 7

远端验证已通过：

- 已部署到 `/opt/exam-planner`
- `systemctl is-active exam-planner` 返回 `active`
- `/health` 返回 `ok`
- `/health?full=1` 返回 `status: ok`
- SQLite schema version 确认为 `14`
- 通知表存在
- `/api/notifications/center` 登录后可访问，返回 5 个通道
- `/api/calendar` 登录后可访问，2026-06 月区间返回 4 个事件
- `/api/tasks/status` 登录后可访问，并返回任务指标

远端公网 E2E 说明：

- 使用公网 HTTPS 跑 E2E 时，前面误用错误网页密码触发了登录锁。
- 因登录锁，公网浏览器 E2E 暂时无法继续完成。
- 这不影响部署状态，因为远端服务健康检查和带登录 cookie 的 API 验证已经通过。

## 10. 部署说明

修复了部署脚本：

- `scripts/deploy-exam-planner.ps1` 中 `scp "${target}:..."` 的 PowerShell 变量拼接已修复。
- 部署脚本已包含 `server/migrations` 上传。

实际部署使用 Paramiko 完成：

- 上传 `dist`
- 上传 `package.json` / `package-lock.json`
- 上传 `server/auth-static-server.mjs`
- 上传 `server/modules`
- 上传 `server/migrations`
- 上传 `public`
- 远端执行 `npm ci --omit=dev`
- 重启 `exam-planner`
- 健康检查通过

远端 Node 版本提醒：

- 服务器当前 Node 是 `v18.19.1`
- 部分新前端构建依赖声明推荐 Node 20+
- 生产运行当前正常，因为构建在本地完成，远端只运行服务端和静态产物
- 后续建议把服务器 Node 升级到 20 LTS，降低依赖兼容风险

## 11. 仍需注意的点

后端没有把 `auth-static-server.mjs` 完全拆成多个业务路由文件。原因是该文件承载大量已有逻辑，单次强拆风险高。本轮采取的是安全增量拆分：

- migration runner 独立
- notification repository 独立
- calendar repository 独立
- notification dispatcher 独立
- task/ops/sqlite repository 已沿用上一轮拆分

Finance 页面仍然较大。本轮新增的 PDF 解析和现金流分析已放到 feature 层，但 `FinancePage.tsx` 仍可继续拆：

- vault/sync 面板
- asset editor
- transaction editor
- plan/target panel
- import panel
- report panel

通知事件目前只做站内事件和投递预案，还没有真正执行外部投递。下次拍板后建议做：

- `notification_deliveries` pending 队列
- 投递 worker
- 重试策略
- 投递日志
- 通道启停设置 UI

## 12. 变更文件摘要

新增重点文件：

- `server/migrations/014_notifications_and_calendar.sql`
- `server/modules/migration-runner.mjs`
- `server/modules/notification-repository.mjs`
- `server/modules/calendar-repository.mjs`
- `server/modules/notification-dispatcher.mjs`
- `src/pages/CalendarPage.tsx`
- `src/pages/GoalReviewPage.tsx`
- `src/features/finance/bankImport.ts`
- `src/features/finance/bankImport.test.ts`
- `scripts/parse-icbc-statement.py`

修改重点文件：

- `server/auth-static-server.mjs`
- `src/api/client.ts`
- `src/api/queryClient.ts`
- `src/app/Layout.tsx`
- `src/router/AppRouter.tsx`
- `src/router/preload.ts`
- `src/pages/DashboardPage.tsx`
- `src/pages/NotificationsPage.tsx`
- `src/pages/FinancePage.tsx`
- `e2e/app-smoke.e2e.ts`
- `playwright.config.ts`
- `scripts/deploy-exam-planner.ps1`
- `.gitignore`

## 13. 下次推荐继续做

1. 拍板通知外发通道：Telegram、企业微信、Claw/微信中转三选一或多选。
2. 实现通知投递 worker：把 `notification_events` 真正投递到外部通道，并写入 `notification_deliveries`。
3. 继续拆 Finance 页面：优先拆 vault/sync、transaction editor、asset editor。
4. 继续拆后端主文件：优先拆 reports、reviews、library、settings。
5. 升级服务器 Node 到 20 LTS。
6. 等公网登录锁解除后，再跑一次远端 HTTPS E2E。
