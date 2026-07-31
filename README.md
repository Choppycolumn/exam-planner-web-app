# Exam Planner Web App

一个面向考研复习的小型多用户学习管理 Web App。项目从个人学习计划工具起步，现已支持独立学习空间、跨用户学习时长对比、多端同步、每日复盘、专注计时、模考成绩和英文易混单词整理。

管理员通过一次性邀请码添加成员；每个成员拥有独立的课程、学习时间、任务、复盘、模考、单词和番茄钟数据，只有学习时长对比是共享视图。运维、通知、简报、备份和用户管理仅对具备对应能力的账户开放。

## 交接文档

- `docs/ARCHITECTURE.md`：项目结构、入口、数据流和维护边界。
- `docs/API.md`：主要 API 路由与约定。
- `docs/DATABASE.md`：SQLite 表结构、结构版本和备份策略。
- `docs/DEPLOYMENT.md`：本地开发、构建、生产部署流程。
- `docs/OPERATIONS.md`：巡检、日志、备份和安全基线。
- `docs/ROADMAP.md`：已完成扩展、暂缓范围和后续路线。

## 核心功能

- 长期目标管理：首页显示当前目标倒计时
- 学习总时长目标：设置页配置目标小时数，首页展示累计学习、差额和每日建议时长
- 短期目标清单：支持截止日期、紧急程度排序、每日完成状态
- 每日复盘：1-10 分评分，支持查看昨日文字记录进行对比
- 学习时间记录：按学习项目填写每日用时，支持空输入和备注
- 数据统计：今日分布、最近 7 天趋势、最近 30 天项目累计
- 模考成绩：科目管理、成绩录入、历史表格、趋势图和统计值
- 复盘趋势：按时间跨度查看复盘状态变化
- 易混单词卡：输入一组英文易混词，自动查询并生成英文-中文释义卡片
- 打印默写版：为易混单词生成适合打印的复习页面
- 设置页：数据导出、易混单词导入导出、服务器备份设置、一键清空
- 服务器备份：结构化 SQLite 主库、每日/每周自动快照、分类保留、手动备份与恢复
- 自动学习报告：服务器生成周报、月报，汇总学习时间、复盘、任务、喝水和模考
- 学习进度仪表盘：近 30 天趋势、目标达成、复盘评分与任务完成
- 项目进展看板：按项目查看投入、占比、最近活跃和短期趋势
- 网页专注计时：每个用户独立计时，断网操作可补传并幂等去重
- 多用户学习空间：邀请码注册、账户停用、密码重置、会话撤销和数据隔离
- 学习时长对比：只共享聚合时长，不共享个人任务、复盘或课程明细
- 运维与健康中心：备份、访问统计、日志摘要、通知健康和磁盘 I/O 压力
- 深色模式：支持全局浅色/深色切换并保存到本机

## 技术栈

- React + TypeScript + Vite
- Tailwind CSS
- Recharts
- Dexie.js + IndexedDB
- React Router
- TanStack Query
- Node.js 静态服务与轻量 API
- SQLite
- Nginx 反向代理

## 性能优化

- 首页优先加载：路由按页面懒加载，只在悬停或聚焦导航时预取目标页面。
- 图表按需加载：首页图表进入视口后才加载，Recharts 单独分包，不进入首屏预加载链。
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

- 每个正式账户的数据由服务器结构化 SQLite 保存，并以 `user_id` 强制隔离。
- 密码使用带独立盐值的 scrypt 哈希；会话只在服务器保存哈希后的不透明 Token。
- 旧版浏览器 IndexedDB 数据可通过迁移页导入服务器。
- 易混单词仍支持浏览器本地使用，同时按账户备份到服务器并保留历史版本。
- 服务器每日和每周自动创建 SQLite 快照，并按 daily、weekly、deploy、manual、migration 分类保留；设置页可手动备份和恢复。
- 服务器端 ECDICT 英汉词典保存在独立的 `data/dictionary.sqlite`，查词不依赖外部 API，也不再拖大主业务库和每次业务备份。
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
- `backup_log`
- `learning_reports`
- `user_accounts`
- `user_credentials`
- `user_capabilities`
- `user_sessions`
- `user_invites`
- `focus_timer_sessions`

ECDICT 的 `dictionary_entries` 与导入元数据位于独立的 `data/dictionary.sqlite`。

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
- 账户卡片加独立密码登录；成员由管理员生成的一次性邀请码注册
- 权限使用持久化 capability 控制，不依赖固定用户编号
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
npm test
npm run build
npm run check:bundle
```

Break Guard 桌面端测试：

```bash
cd desktop-break-guard
python -m unittest discover -s tests -v
```
