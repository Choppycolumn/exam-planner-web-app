# 考研学习计划管理 Web App

一个本地运行的考研学习管理工具，用于长期目标、短期任务、每日复盘、学习时间统计和模考成绩记录。项目基于浏览器 IndexedDB 保存数据，不需要登录、后端服务或云数据库。

## 功能简介

- 长期目标管理与首页倒计时
- 首页短期目标清单，支持截止日期、紧急程度排序和当天完成状态
- 每日复盘，支持昨日文字记录与评分对比
- 学习项目管理与每日学习用时记录
- 今日时间分布、最近 7 天趋势、最近 30 天项目累计统计
- 模考科目管理、成绩记录、表格筛选和趋势图
- 复盘趋势页，查看时间跨度上的状态变化
- 易混英文单词组整理，支持自动查词、标签筛选、熟练度、默写版打印
- 易混单词数据本地优先保存，并支持 JSON 导入导出与服务器定时备份
- 设置页支持本地数据 JSON 导出

## 技术栈

- React + TypeScript + Vite
- Tailwind CSS
- Framer Motion
- Recharts
- Dexie.js + IndexedDB
- React Router

## 本地运行

```bash
npm install
npm run dev
```

打开浏览器访问：

```text
http://127.0.0.1:5173/
```

## 桌面快捷启动

Windows 下可以双击：

```text
scripts/start-exam-planner.bat
```

脚本会自动启动本地 Vite 服务并打开网页。如果 `node_modules` 不存在，会先运行 `npm install`。

## 数据存储

考研计划主数据可由部署版服务器统一保存，旧本地 IndexedDB 数据可通过迁移页导入服务器。易混单词模块采用本地优先策略，保存在当前浏览器 `localStorage` 中，每小时向部署服务器上传一次备份快照，并支持手动导入导出 JSON。

IndexedDB 数据库由 Dexie.js 管理，并保留版本迁移机制，方便后续扩展 AI 学习计划、番茄钟、数据导出等模块。

当前数据库包含：

- `goals`
- `dailyReviews`
- `studyProjects`
- `studyTimeRecords`
- `subjects`
- `mockExamRecords`
- `shortTermTasks`
- `appSettings`

服务器备份额外包含：

- `confusingWordsBackup`

## 验证命令

```bash
npm run lint
npm run build
```
