# 运维与巡检

## 日常巡检页面

前端新增 `/operations`：

- 备份管理：查看备份、手动备份、确认后恢复。
- 访问统计：今日访问、近 7 天访问、近 14 天趋势、热门路径。
- 日志摘要：读取 systemd 与 Nginx 日志尾部，并脱敏敏感字段。

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

## 安全基线

已经完成：

- `.env.example` 只列变量名，不写真实密钥。
- `remote-audit/`、zip、临时报告加入 `.gitignore`。
- 前端 API 错误统一解析。
- CORS 可通过 `CORS_ORIGIN` 收窄；默认保留 `*` 以兼容本地易混词跨源备份。
- 日志摘要接口对 Cookie、Token、Password、Secret 做脱敏。
- 访问统计不保存明文 IP。

仍建议继续做：

- 生产 systemd 不要使用 root 用户运行。
- Cookie 在 HTTPS 下追加 `Secure`。
- 减小 CORS 范围，避免长期使用 `*`。
- 把真实 secret 从 systemd 主文件迁移到权限更严格的 EnvironmentFile。
- 对恢复备份、清空数据等高风险操作增加二次确认和操作审计。

## 备份恢复注意

恢复备份会覆盖当前 SQLite。虽然服务端会先创建 `pre-restore` 安全备份，仍建议只在数据异常、误操作或迁移失败时使用。
