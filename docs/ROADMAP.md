# 后续开发路线

## 已完成的本轮新增

- 理财页面已接入导航，并保留本地加密、云端密文同步、交易、计划、导出和 Markdown 报告。
- 学习进度仪表盘：近 30 天趋势、目标达成、复盘评分、任务完成。
- 项目进展看板：项目投入、活跃度、占比和趋势。
- 学习报告增强：当前/上一周期生成、Markdown 下载、AI 总结提示词。
- 深色模式：全局主题切换与本地持久化。
- 访问统计：`visit_events` 表与 `/api/visits/summary`。
- 备份管理与日志摘要：`/operations` 页面。

## 不做或暂缓

按当前需求，本轮不做：

- 资料库增强。
- 对外个人主页入口。
- 笔记/知识库系统。
- RSS/公开输出。
- 多语言。
- 多用户功能。

## 下一阶段低风险

- 把 `server/auth-static-server.mjs` 按领域拆分为 `server/modules/*`。
- 给关键 API 加集成测试。
- 将 `LearningProgressPage`、`ProjectProgressPage` 的统计口径写入页面帮助或文档。
- 增加备份保留策略配置。
- 给 Finance 页面继续拆组件，降低单文件体积。

## 中高风险

- 将后端迁移到 Fastify 或 Express。
- 引入真正的数据库迁移工具，而不是在单文件中维护结构版本。
- 为高风险操作增加审计表。
- 将 systemd 服务切换到非 root 用户。
- HTTPS Cookie `Secure` 与 CORS 精准化。
