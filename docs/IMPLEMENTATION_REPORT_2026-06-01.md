# 2026-06-01 大规模优化与功能实施报告

## 1. 本次完成范围

本次按用户确认的组合一次性完成以下工作：

- 后端模块化与 Repository 层起步重构。
- Finance 页面组件级重构，并新增流水/现金流分析系统。
- 通知中心重构：增加统计、筛选、搜索、生成并推送入口。
- 系统设置中心重构：增加分组式设置导航，降低长页面维护和使用成本。
- 个人数据仪表盘 2.0：增加稳定性、活跃学习天、复盘覆盖、低投入天等综合指标。
- 后台任务控制台升级：增加任务总览、成功/失败、近 24 小时、平均耗时、按任务名聚合统计。
- Playwright E2E 测试体系：覆盖桌面和移动端基础页面冒烟。
- 本地验证、构建、E2E、服务器部署和远端健康检查。

## 2. 后端模块化与 Repository 层

新增文件：

- `server/modules/sqlite-repository.mjs`
- `server/modules/task-runs-repository.mjs`
- `server/modules/ops-repository.mjs`

实现内容：

- 抽出 SQLite 访问基础 Repository，统一封装 `run/json/scalar/transaction`。
- 抽出任务运行记录 Repository，提供最近任务列表和聚合指标。
- 抽出运维日志 Repository，提供审计事件、慢接口列表和接口指标。
- `server/auth-static-server.mjs` 已实际接入这些 Repository：
  - `/api/tasks/status` 返回 `tasks.metrics`。
  - `/api/ops/logs/summary` 返回 `apiMetrics`。
  - `lastTaskRuns()` 改为通过 Repository 获取。

说明：

- 这是低风险的真实拆分：先拆读多写少的运维和任务模块，避免一次性把整个单文件服务端重构成多服务导致上线风险。
- 当前主服务仍保留大量业务函数，后续可以继续按 Goals、Reviews、Reports、Library 等模块拆分。

## 3. Finance 流水分析系统

新增文件：

- `src/features/finance/cashflow.ts`
- `src/features/finance/components/CashflowPanel.tsx`
- `src/features/finance/cashflow.test.ts`

改动文件：

- `src/types/finance.ts`
- `src/pages/FinancePage.tsx`
- `src/features/finance/reports.ts`

实现内容：

- 新增交易流水字段：
  - `cashflowKind`
  - `cashflowCategory`
  - `merchant`
  - `counterparty`
  - `tags`
- 新增流水性质：
  - 收入、支出、投资、转账、费用、校正。
- 新增流水分类：
  - 工资、奖金、日常、餐饮、居住、交通、医疗健康、教育、订阅、娱乐、税费、现金流入/流出、投资买入/卖出、分红、利息、奖励、换汇、内部转账、手续费、校正、其他。
- 新增流水分析视图：
  - 总收入、总支出、净现金流、投资净流出。
  - 储蓄率。
  - 月度收入/支出/投资流出趋势图。
  - 支出、收入、投资分类排行。
  - 最近流水表，支持跳回交易编辑。
  - CSV 导出。
- 报告导出中新增“流水与现金流分析”章节。
- 单元测试覆盖收入、支出、投资买入、储蓄率和分类排行。

设计说明：

- 现金流分析优先使用交易上的显式分类；没有显式分类时按交易类型自动推断。
- 已确认交易计入统计，pending/cancelled 会出现在提示中但不计入现金流。
- 外币通过现有汇率逻辑折算为 CNY；缺汇率时给出提示。
- Finance 明文数据仍保留在浏览器端加密保险箱中，服务端只同步密文，不做明文财务分析。

## 4. 通知中心重构

改动文件：

- `src/pages/NotificationsPage.tsx`

实现内容：

- 新增通知统计：
  - 简报总数。
  - 已推送。
  - 未推送。
  - 推送失败。
- 新增筛选：
  - 全部、已推送、未推送、失败。
- 新增搜索：
  - 按标题或日期搜索。
- 新增动作：
  - 生成今日简报。
  - 生成并推送。
  - 发送最新简报。

价值：

- 通知中心从“简报列表”升级为“通知投递状态中心”。
- 邮件失败、未发送和已发送状态更容易追踪。

## 5. 系统设置中心重构

改动文件：

- `src/pages/SettingsPage.tsx`

实现内容：

- 新增设置中心分组导航：
  - 全部。
  - 基础。
  - 通知。
  - 备份。
  - 目标。
  - 词典。
  - 危险区。
- 原有设置块没有删除，仅通过分组显隐组织。

价值：

- 避免设置页继续变成单一长页面。
- 后续新增配置可以按模块归档，不必继续堆叠。

## 6. 个人数据仪表盘 2.0

改动文件：

- `src/pages/LearningProgressPage.tsx`

实现内容：

- 新增综合稳定性分数。
- 新增活跃学习天统计。
- 新增活跃日均学习时长。
- 新增最佳单日学习。
- 新增复盘覆盖率。
- 新增有学习但未达目标的低投入天数。

价值：

- 从单纯展示学习时长，升级为“连续性 + 目标命中 + 复盘覆盖”的综合仪表盘。
- 更容易判断近期学习状态是否稳定，而不是只看总时长。

## 7. 后台任务控制台升级

改动文件：

- `src/pages/TaskCenterPage.tsx`
- `src/api/client.ts`
- `server/auth-static-server.mjs`
- `server/modules/task-runs-repository.mjs`

实现内容：

- 新增任务总运行次数。
- 新增近 24 小时运行次数。
- 新增成功、失败、运行中统计。
- 新增平均耗时和最长耗时。
- 新增按任务名聚合列表：
  - 任务名。
  - 总次数。
  - 失败次数。
  - 最近开始时间。
  - 平均耗时。

价值：

- 后台任务中心从“最近运行记录”升级为“任务运行质量看板”。
- 更容易定位失败任务、慢任务和异常频繁任务。

## 8. Playwright E2E

新增文件：

- `playwright.config.ts`
- `e2e/app-smoke.e2e.ts`

改动文件：

- `package.json`
- `package-lock.json`
- `.gitignore`

新增脚本：

- `npm run e2e`
- `npm run e2e:ui`

覆盖内容：

- 桌面 Chromium。
- 移动端 Pixel 7。
- 首页基础加载。
- 运维页。
- 后台任务中心。
- Finance 页面。

说明：

- 已安装本机 Playwright Chromium 运行时。
- `.gitignore` 已排除 `test-results` 和 `playwright-report`。

## 9. 验证结果

本地验证全部通过：

- `npm run lint`：通过。
- `npm test`：通过，2 个测试文件、8 个测试。
- `npm run build`：通过。
- `npm run e2e`：通过，6 个 E2E 测试。
- `node --check server/auth-static-server.mjs`：通过。
- `node --check server/modules/*.mjs`：通过。

服务器验证：

- 已部署到 `/opt/exam-planner`。
- `systemctl restart exam-planner` 成功。
- `systemctl is-active exam-planner` 返回 `active`。
- `http://127.0.0.1:8080/health` 返回 `ok`。
- `http://127.0.0.1:8080/health?full=1` 返回 `status: ok`。
- 登录后验证：
  - `/api/tasks/status` 已返回 `tasks.metrics`。
  - `/api/ops/logs/summary` 已返回 `apiMetrics`。

## 10. 当前风险与后续建议

低风险后续建议：

- 继续把 `server/auth-static-server.mjs` 按业务域拆分：
  - reviews repository/service。
  - reports repository/service。
  - library repository/service。
  - settings repository/service。
- Finance 页面仍然较大，下一步可以继续拆：
  - AssetEditor。
  - TransactionEditor。
  - HoldingsTable。
  - PlansPanel。
  - ReportsPanel。
- E2E 可以继续补：
  - 登录流程。
  - 设置中心分组切换。
  - 通知筛选。
  - Finance 流水视图。
  - 任务中心指标展示。

中风险后续建议：

- 为服务端 API 增加统一路由表和请求校验层。
- 为 Repository 引入更强的 schema/migration 版本管理。
- 把通知系统从“每日简报”扩展为通用通知模型：
  - notification_rules。
  - notification_events。
  - notification_deliveries。
  - delivery channels: email/browser/webhook。

高风险后续建议：

- 将单文件 Node 服务迁移为 Express/Fastify/Nest 等结构化框架。
- Finance 明文分析如需跨设备后台生成，必须重新设计端到端加密与密钥授权，不能直接把明文财务数据落服务端。
