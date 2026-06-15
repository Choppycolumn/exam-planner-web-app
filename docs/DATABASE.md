# 数据库说明

生产数据库是 SQLite，默认路径：

```text
data/exam-planner.sqlite
```

服务端通过 `sqlite3` CLI 执行 SQL。结构创建集中在 `server/auth-static-server.mjs` 的 `ensureSqliteStore()` 和 `createStructuredTables()`。

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
- `dictionary_entries`：ECDICT 词典索引。
- `confusing_words_backup`：易混词浏览器备份。
- `finance_vaults`：已停用的历史理财密文表，仅保留旧数据，不再由当前代码创建或使用。
- `backup_log`：备份/恢复日志。
- `library_books`、`library_text_chunks`、`library_notes`、`library_bookmarks`、`library_reading_progress`：资料库。
- `error_theme_batches`、`error_themes`、`error_theme_occurrences`、`review_sentence_embeddings`、`error_theme_corrections`：错因主题分析。
- `visit_events`：访问统计事件，仅保存路径、角色、脱敏访客哈希、浏览器摘要和时间。

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

## 备份策略

- 手动备份：`POST /api/backups/run`
- 每周自动备份：保留最近 12 个 weekly SQLite 快照。
- 恢复备份：恢复前自动生成 `pre-restore` 安全备份。
- 资料库文件：如果 `data/library/files` 存在，会同步创建 tar.gz 归档。

## 大文件说明

`data/ecdict.csv` 和 `dictionary_entries` 体积大，不应放入 Git。词典属于数据资产，不属于代码交接必须展开的内容。
