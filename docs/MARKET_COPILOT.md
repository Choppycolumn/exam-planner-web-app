# 理财情报台运维说明

## 定位

理财情报台现在是本地投资账本和 ChatGPT 研究提示词生成器。网站不再自动采集行情、新闻、宏观日历或交易所数据，也不连接下单接口。实时研究流程是：先在网站维护真实账本，再复制“ChatGPT 研究提示词”，由 ChatGPT 联网核验行情和事件。

## 使用流程

1. 在“交易流水”新增、编辑、删除、恢复或冲销交易。
2. 在“仓位与资金”查看移动加权成本、已实现盈亏、可用资金和锁定资金。
3. 如需估算未实现盈亏，手动录入参考价；参考价不是实时行情。
4. 在“Day 单计划”记录计划档位，并在 Bitget 手动确认真实订单状态。
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

Day 单计划只用于记录和提醒。状态包括：

- `planned`
- `placed_manually`
- `filled_manually`
- `cancelled_manually`
- `expired_unconfirmed`

系统不得写“已撤单”或“已成交”，除非用户手动确认后更新状态或转换为交易记录。

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
