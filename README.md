# Exam Planner Web App

一个面向考研复习的个人学习管理 Web App，也是我的 Codex 初尝试作品。项目从本地学习计划工具起步，逐步加入了服务器部署、多端同步、每日复盘、学习时间统计、模考成绩管理，以及英文易混单词整理功能。

当前版本适合个人在电脑浏览器中长期使用：考研计划数据可部署到自己的服务器统一保存，易混单词模块保持本地优先，并支持定时备份到服务器。

## 核心功能

- 长期目标管理：首页显示当前目标倒计时
- 短期目标清单：支持截止日期、紧急程度排序、每日完成状态
- 每日复盘：1-10 分评分，支持查看昨日文字记录进行对比
- 学习时间记录：按学习项目填写每日用时，支持空输入和备注
- 数据统计：今日分布、最近 7 天趋势、最近 30 天项目累计
- 模考成绩：科目管理、成绩录入、历史表格、趋势图和统计值
- 复盘趋势：按时间跨度查看复盘状态变化
- 易混单词卡：输入一组英文易混词，自动查询并生成英文-中文释义卡片
- 打印默写版：为易混单词生成适合打印的复习页面
- 设置页：数据导出、易混单词导入导出、服务器备份设置、一键清空
- 服务器备份：结构化 SQLite 主库、每周自动快照、手动备份与恢复
- 自动学习报告：服务器生成周报、月报，汇总学习时间、复盘、任务、喝水和模考

## 技术栈

- React + TypeScript + Vite
- Tailwind CSS
- Framer Motion
- Recharts
- Dexie.js + IndexedDB
- React Router
- TanStack Query
- Node.js 静态服务与轻量 API
- SQLite
- Nginx 反向代理

## 性能优化

- 首页优先加载：路由按页面懒加载，进入首页后再后台预加载其他页面。
- 图表按需加载：Recharts 被拆到独立 `Charts` chunk，只有首页图表、统计页和报告页需要时才加载。
- 首屏轻量接口：首页使用 `/api/dashboard`，不再依赖全量 `/api/state`。
- 统计服务端聚合：最近 7 天趋势、今日分布、最近 30 天项目累计由 SQLite 聚合后返回。
- 历史数据分页：模考记录和完整复盘报告支持按页加载。
- 写入单表化：复盘、学习时间、任务、喝水、模考等保存接口直接更新对应 SQLite 表。
- 兼容迁移隔离：Dexie/IndexedDB 迁移逻辑只在迁移页加载，不进入主应用首屏包。
- 前端缓存：使用 TanStack Query 管理页面级缓存，保存后统一失效相关服务器数据。
- 服务端缓存：常用首页摘要和统计摘要会在 SQLite 写入后失效并重新计算。
- 数据库索引：为日期、科目、项目、任务状态等高频查询建立复合索引。

## 数据策略

项目当前采用混合数据策略：

- 考研计划主数据由部署版服务器结构化 SQLite 保存，方便多端同步。
- 旧版浏览器 IndexedDB 数据可通过迁移页导入服务器。
- 易混单词模块本地优先，保存在当前浏览器 `localStorage`。
- 易混单词支持每小时向服务器上传备份快照，也支持手动导入导出 JSON。
- 服务器每周自动创建一次 SQLite 快照，并保留最近 12 个周备份；设置页可手动备份和恢复。
- 服务器端 ECDICT 英汉词典已导入 SQLite 索引，查词不依赖外部 API。
- 删除学习项目或科目不会破坏历史记录，历史数据保留名称快照。

服务器 SQLite 拆分为以下核心表：

- `goals`
- `daily_reviews`
- `study_projects`
- `study_time_records`
- `subjects`
- `mock_exam_records`
- `short_term_tasks`
- `water_intake_records`
- `confusing_words_backup`
- `dictionary_entries`
- `backup_log`
- `learning_reports`

浏览器本地仍保留 Dexie/IndexedDB 结构和迁移能力，便于后续扩展。

## 本地开发

```bash
npm install
npm run dev
```

打开浏览器访问：

```text
http://127.0.0.1:5173/
```

## 生产构建

```bash
npm run build
```

构建产物位于：

```text
dist/
```

## 桌面快捷启动

Windows 下可以双击：

```text
scripts/start-exam-planner.bat
```

脚本会启动本地 Vite 服务并打开网页。如果 `node_modules` 不存在，会先运行 `npm install`。

## 服务器部署概览

当前部署版使用：

- Ubuntu 24.04
- Node.js 服务：`server/auth-static-server.mjs`
- Nginx 反向代理
- systemd 服务：`exam-planner`
- 简单密码登录，无用户名
- 登录防护：同一 IP 连续输错 3 次锁定 30 分钟，失败响应随机延迟 1-2 秒
- Nginx 限流：`/login` 每 IP 约 6 次/分钟，超出返回 429

生产服务主要接口：

- `/login`
- `/health`
- `/api/dashboard`
- `/api/goals`
- `/api/projects`
- `/api/subjects`
- `/api/reviews?from=&to=`
- `/api/study-records?date=`
- `/api/mock-exams?subjectId=&limit=&offset=`
- `/api/statistics/summary`
- `/api/state`
- `/api/*/save`
- `/api/backups/status`
- `/api/backups/run`
- `/api/backups/restore`
- `/api/reports`
- `/api/reports/generate`
- `/api/dictionary/lookup`
- `/api/confusing-words/backup`

## 验证命令

```bash
npm run lint
npm run build
```

## 后续计划

- 番茄钟
- AI 学习计划建议
- 自动调整短期任务
- 数据导出报告
- 学习报告 PDF/Markdown 导出
- SQLite FTS 全文搜索
