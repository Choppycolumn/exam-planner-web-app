# 数据库说明

生产数据库是 SQLite，默认路径：

```text
data/exam-planner.sqlite
```

ECDICT 词典使用独立 SQLite：

```text
data/dictionary.sqlite
```

业务数据库通过内置 SQLite 适配层访问，ECDICT CSV 的一次性大批量导入仍使用系统 `sqlite3`。

## 核心表

- `app_metadata`：结构版本、维护时间、简报计划、预计算时间等键值配置。
- `app_state`：兼容旧版整体 JSON 状态。
- `goals`：长期目标。
- `study_projects`：学习项目。
- `study_time_records`：每日学习时间明细。
- `study_daily_summaries`：每日学习时间物化汇总。
- `study_project_daily_summaries`：按项目和日期汇总的物化表。
- `daily_reviews`：每日复盘。
- `subjects`：模考科目。
- `mock_exam_records`：模考记录。
- `short_term_tasks`：短期任务。
- `water_intake_records`：饮水记录。
- `learning_reports`：自动生成的周报/月报。
- `daily_briefs`：每日简报。
- `problem_inbox_items`：问题收集箱。
- `precomputed_cache`：趋势、错因等预计算缓存。
- `confusing_words_backup`：易混词浏览器备份。
- `finance_vaults`：已停用的历史理财密文表，仅保留旧数据，不再由当前代码创建或使用。
- `backup_log`：备份/恢复日志。
- `library_books`、`library_text_chunks`、`library_notes`、`library_bookmarks`、`library_reading_progress`：资料库。
- `error_theme_batches`、`error_themes`、`error_theme_occurrences`、`review_sentence_embeddings`、`error_theme_corrections`：错因主题分析。
- `visit_events`：访问统计事件，仅保存路径、角色、脱敏访客哈希、浏览器摘要和时间。

`dictionary.sqlite` 单独包含：

- `dictionary_entries`：ECDICT 英汉词典索引。
- `dictionary_metadata`：来源签名、导入时间和主库迁移时间。

## 结构版本

`app_metadata.structured_schema_version` 当前推进到 `13`：

- 1：结构化学习表。
- 2：学习报告。
- 3：错因主题库。
- 4：句向量缓存。
- 5：错因纠错样本。
- 6：学习时间物化汇总。
- 7：每日简报。
- 8：问题收集箱。
- 9：预计算缓存。
- 10：资料库。
- 11：资料库书签。
- 12：访问统计。
- 13：后台任务运行记录、审计事件、慢接口/错误接口日志。

## 迁移账本

所有 SQL 迁移由 `server/modules/migration-runner.mjs` 统一执行，并记录到 `schema_migrations`：

- 以完整文件名为主键，因此允许历史上相同数字前缀的迁移共存。
- 保存 SHA-256 校验和，已执行迁移被修改时拒绝启动。
- 记录 applied、baseline、skipped 状态和执行时长。
- `/ready` 会检查待执行迁移和校验和不一致。
- 已停用的历史理财迁移按文件名明确标记为 skipped，不再依赖模糊的版本号跳过。

## 备份策略

- 手动备份：`POST /api/backups/run`
- 每日自动备份：默认保留最近 7 个。
- 每周自动备份：默认保留最近 4 个。
- 部署、手动、迁移及其他安全备份分别保留，数量由 `BACKUP_KEEP_*` 环境变量控制。
- 删除旧备份前至少验证一个同类保留备份通过 `PRAGMA integrity_check`。
- 恢复备份：恢复前自动生成 `pre-restore` 安全备份。
- 代码部署回滚包默认保留最近 5 组代码包和 systemd 单元备份。

## 大文件说明

`data/ecdict.csv` 和 `data/dictionary.sqlite` 体积大，不应放入 Git。词典库可由 ECDICT CSV 重建；主业务库恢复不会覆盖独立词典库。
