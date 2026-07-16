# 运维与巡检

## 日常巡检页面

前端新增 `/operations`：

- 备份管理：查看备份、手动备份、确认后恢复。
- 访问统计：今日访问、近 7 天访问、近 14 天趋势、热门路径。
- 日志摘要：读取 systemd 与 Nginx 日志尾部，并脱敏敏感字段。
- 前端页面错误：浏览器渲染错误、全局 JS 错误和 Promise 未处理错误会写入脱敏摘要，方便定位空白页或页面崩溃。
- 通知通道健康：展示每个通道近 24 小时成功/失败、连续失败、熔断截止时间和可执行建议。
- 资源预算：展示后台重任务的运行、等待、可用内存和负载阈值。

后台任务中心 `/task-center` 继续保留：

- 周报/月报生成。
- 每日简报。
- 错因主题整理。
- SQLite 维护。
- 预计算刷新。
- PWA 安装入口。

## 健康检查

```bash
curl http://127.0.0.1:8080/health
systemctl status exam-planner
journalctl -u exam-planner -n 120 --no-pager
nginx -t
```

## 日志位置

- systemd：`journalctl -u exam-planner`
- Nginx access：`/var/log/nginx/access.log`
- Nginx error：`/var/log/nginx/error.log`
- 本地 Vite 日志：`vite-*.log`，已加入忽略规则。
- SQLite 客户端错误表：`client_error_log`，只保存脱敏摘要、路径、来源、角色和时间。

## 自动清理策略

夜间 SQLite 维护会执行：

- 访问统计保留 180 天。
- API 慢/错请求日志保留 90 天。
- 前端页面错误摘要保留 120 天。
- 后台任务运行记录保留 180 天。
- 错因整理默认 03:10 运行，SQLite 维护默认 04:20 运行，重任务通过单并发资源闸门错峰执行。

备份使用分类保留策略：

- daily 7 份、weekly 4 份。
- deploy 5 份、manual 5 份、migration 5 份、other 3 份。
- 每类只在至少一个保留文件通过完整性校验后删除溢出文件。
- 部署脚本保留最近 5 个可直接切换的版本目录，以及最近 5 组 systemd 单元备份。

## 服务资源限制

- Web：Node 堆上限 192 MB，`MemoryHigh=240M`，`MemoryMax=320M`。
- Worker：Node 堆上限 224 MB，`MemoryHigh=300M`，`MemoryMax=400M`，较低 CPU 权重和 `Nice=5`。
- 后台重任务默认单并发；可用内存或系统负载不满足阈值时先等待，不与其他重任务争抢资源。

## 通知熔断

- 每个主动通知通道独立记录成功和失败，不会因一个通道故障阻塞其他通道。
- 连续 3 次可重试失败后暂时熔断 15 分钟。
- 微信会话失效等不可重试错误立即熔断 30 分钟，并保留站内通知兜底。
- 任意一次发送成功会自动恢复该通道。

## 安全基线

已经完成：

- `.env.example` 只列变量名，不写真实密钥。
- `SETTINGS_ENCRYPTION_KEY` 与登录 Cookie 密钥分离，生产环境缺失时拒绝启动。
- 设置页密文使用带版本的 AES-256-GCM；旧密文解密成功后自动迁移，失败告警按密文指纹去重。
- `remote-audit/`、zip、临时报告加入 `.gitignore`。
- 前端 API 错误统一解析。
- CORS 可通过 `CORS_ORIGIN` 收窄；默认保留 `*` 以兼容本地易混词跨源备份。
- 日志摘要接口对 Cookie、Token、Password、Secret 做脱敏。
- 前端页面错误上报会移除 URL 查询参数，并脱敏 Cookie、Token、Password、Secret、Authorization。
- 访问统计不保存明文 IP。

生产服务使用专用 `examplanner` 用户，真实密钥来自权限受限的 `/etc/exam-planner/runtime.env`。仍建议持续收窄 CORS，并定期演练备份恢复。

## 备份恢复注意

恢复备份会覆盖当前 SQLite。虽然服务端会先创建 `pre-restore` 安全备份，仍建议只在数据异常、误操作或迁移失败时使用。
