# 理财情报台运维说明

## 备份

理财情报台使用现有 `data/exam-planner.sqlite`，和网站其他数据共用 SQLite。服务器已存在每日/每周 SQLite 备份机制。手动备份可在“运维与健康”中执行“创建备份”。

命令行只读校验：

```bash
sqlite3 /opt/exam-planner/data/exam-planner.sqlite "PRAGMA quick_check;"
```

手动备份示例：

```bash
sqlite3 /opt/exam-planner/data/exam-planner.sqlite ".backup '/opt/exam-planner/data/backups/market-copilot-manual.sqlite'"
```

## 恢复

恢复前必须先停止应用服务并复制当前数据库作为安全备份。不要直接覆盖线上库。推荐优先使用网站“运维与健康”中的备份恢复入口。

## 通知

`MARKET_COPILOT_TELEGRAM_ENABLED=0` 为默认值。设置为 `1` 后，定时生成的情报包会进入现有通知中心，由 Telegram/Bark/站内通知队列处理。通知内容只包含“情报包已生成”的摘要，不发送 API Key、完整 Token 或敏感路径。

## 数据源降级

无外部 API Key 时，系统使用延迟公开数据与手动价格。缺失数据会标记为 `unavailable`、`single_source` 或 `unverified`，不会伪装成实时已验证数据。
