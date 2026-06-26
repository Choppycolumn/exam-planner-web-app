# 理财情报台运维说明

## 定位

理财情报台现在是本地投资账本和 ChatGPT 研究提示词生成器。网站不再自动采集行情、新闻、宏观日历或交易所数据，也不连接下单接口。实时研究流程是：先在网站维护真实账本，再复制“ChatGPT 研究提示词”，由 ChatGPT 联网核验行情和事件。

核心指数代理资产现在包括：

- `rQQQ`：成长增强仓，用于 QQQ / 纳指100 经济敞口。
- `rSPY`：核心分散仓，用于 SPY / 标普500 经济敞口。

`rQQQ` 与 `rSPY` 的数量、移动均价、已实现盈亏、未实现盈亏、Day 单计划金额和指数仓占比均独立计算。系统只展示账本事实和预算是否超限，不自动建议买 rQQQ 或 rSPY。

## 使用流程

1. 在“交易流水”新增、编辑、删除、恢复或冲销交易。
2. 在“仓位与资金”查看 rQQQ / rSPY 的移动加权成本、已实现盈亏、指数仓资金分配、可用资金和锁定资金。
3. 如需估算未实现盈亏，手动录入 rQQQ 或 rSPY 参考价；参考价不是实时行情。
4. 在“Day 单计划”选择 rQQQ 或 rSPY，记录计划档位，并在 Bitget 手动确认真实订单状态。
5. 在“账户核对”输入平台实际余额，系统只展示差异，不会直接改账。
6. 在“ChatGPT 研究提示词”生成 Markdown，复制给 ChatGPT 联网研究。
7. 在“迁移核对与系统状态”确认旧数据是否真实计入账本。

## 数据模型

新账本表使用 `investment_` 前缀：

- `investment_accounts`：账户与锁定属性。
- `investment_transactions`：交易主表，支持状态、软删除、冲销、迁移状态。
- `investment_transaction_legs`：交易分录。
- `investment_transaction_revisions`：创建、编辑、删除、恢复、冲销审计记录。
- `investment_day_order_plans` / `investment_day_order_plan_legs`：Day 单计划。
- `investment_reconciliation_records`：账户核对记录。
- `investment_prompt_reports`：生成过的 ChatGPT 研究提示词。
- `investment_import_batches`：CSV 导入批次。
- `investment_audit_events`：最小审计事件。

旧的 Market Copilot 表没有删除，只保留兼容和审计用途；新页面不再依赖旧行情、新闻、宏观表。

## 交易编辑与删除

- 编辑交易会替换当前分录并写入 revision。
- 删除是软删除，会进入回收站，并立即从持仓和资金计算中排除。
- 恢复会重新纳入计算。
- 冲销会保留原交易，并生成反向调整交易。
- 锁定、转账等同组交易使用 `transaction_group_id`，删除和恢复按组处理。

## 账户核对

核对不会自动改账。若平台实际余额与账本不一致，应新增 `adjustment` 调整交易，并在备注中写明原因。

## Day 单计划

Day 单计划只用于记录和提醒，可同时维护 rQQQ 与 rSPY。页面会展示：

- rQQQ 已持仓名义金额。
- rSPY 已持仓名义金额。
- rQQQ Day 单计划金额。
- rSPY Day 单计划金额。
- 两者合计占用 USDT。
- 未分配现金。
- 是否超出实际可动用 USDT。

锁定仓、PoolX、USDGO、rSPCX 和其他高风险资产不会计入可用预算。状态包括：

- `planned`
- `placed_manually`
- `filled_manually`
- `cancelled_manually`
- `expired_unconfirmed`

系统不得写“已撤单”或“已成交”，除非用户手动确认后更新状态或转换为交易记录。

## ChatGPT 研究提示词

提示词标题为“美股指数代理仓每日研究请求：rQQQ / rSPY”。账本状态会分别输出：

- 成长增强仓：rQQQ 的数量、均价、账户、手动参考价、未实现盈亏和当前 Day 单。
- 核心分散仓：rSPY 的数量、均价、账户、手动参考价、未实现盈亏和当前 Day 单。
- 可自由 USDT、已计划用于 rQQQ / rSPY 的金额、未分配现金、可用于美股指数代理资产的实际弹药。

提示词要求 ChatGPT 同时研究 QQQ 和 SPY，并明确评估 QQQ 相对 SPY 的强弱、科技/AI 独有风险与标普500广泛风险。用户备注会作为数据字段展示，不能覆盖“不得使用锁定资金”“rQQQ 与 rSPY 风险等级不同”等约束。

## 备份

线上数据库路径：

```bash
/opt/exam-planner/data/exam-planner.sqlite
```

只读校验：

```bash
sqlite3 /opt/exam-planner/data/exam-planner.sqlite "PRAGMA quick_check;"
```

手动备份：

```bash
sqlite3 /opt/exam-planner/data/exam-planner.sqlite ".backup '/opt/exam-planner/data/backups/market-copilot-manual.sqlite'"
```

恢复前必须先停止服务并再次备份当前库，不要直接覆盖线上库。

## 环境变量

`MARKET_COPILOT_TELEGRAM_ENABLED=0` 为默认值。设为 `1` 后，只发送“ChatGPT 研究提示词已生成”这类事件通知，不发送密钥、Token、服务器路径或完整财务明细。

本模块不需要市场行情或新闻 API Key。
