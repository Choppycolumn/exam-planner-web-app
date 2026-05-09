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

## 技术栈

- React + TypeScript + Vite
- Tailwind CSS
- Framer Motion
- Recharts
- Dexie.js + IndexedDB
- React Router
- Node.js 静态服务与轻量 API
- SQLite
- Nginx 反向代理

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

生产服务主要接口：

- `/login`
- `/health`
- `/api/state`
- `/api/*/save`
- `/api/backups/status`
- `/api/backups/run`
- `/api/backups/restore`
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
- 学习报告生成
- SQLite FTS 全文搜索
