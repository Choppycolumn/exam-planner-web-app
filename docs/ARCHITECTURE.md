# 项目架构说明

## 项目定位

Exam Planner 是一个个人学习与任务管理 Web App。当前架构是 React/Vite 前端加一个轻量 Node.js HTTP 服务，生产数据落在 SQLite 中。项目不是多用户系统，登录只区分写入会话和只读会话。

## 目录概览

- `src/`：前端源码。
- `src/pages/`：页面级模块，每个路由对应一个页面。
- `src/components/`：通用 UI 与图表组件。
- `src/hooks/`：前端数据读取与页面状态 Hook。
- `src/api/`：前端请求封装、TanStack Query 缓存键。
- `src/features/`：领域功能模块，目前保留易混词等仍在使用的能力。
- `src/db/`：历史本地 IndexedDB/Dexie 结构与迁移能力。
- `server/auth-static-server.mjs`：生产 Node 服务，负责静态文件、登录、API、SQLite、备份、简报和报告。
- `server/embedding_worker.py`：错因主题向量提取的 Python Worker。
- `public/`：PWA manifest、图标、service worker。
- `scripts/`：本地启动和部署辅助脚本。
- `docs/`：交接、部署、API、数据库与运维文档。
- `remote-audit/`：服务器审计下载目录，已加入 `.gitignore`，不参与构建。

## 前端入口与路由

- 入口：`src/main.tsx`
- 根组件：`src/App.tsx`
- 布局：`src/app/Layout.tsx`
- 路由：`src/router/AppRouter.tsx`
- 懒加载：`src/router/preload.ts`

路由使用 `react-router-dom` 的 `createBrowserRouter`。首页直接加载，其余页面通过 `React.lazy` 和 `routeLoaders` 懒加载。`Layout` 会在浏览器空闲时预加载二级页面。

## 后端入口与数据流

生产后端入口是 `server/auth-static-server.mjs`。它在 `127.0.0.1:8080` 提供服务，由 Nginx 反向代理到公网 HTTPS。

主要数据流：

1. 浏览器访问页面，Nginx 转发到 Node。
2. Node 校验登录 Cookie。
3. 前端通过 `/api/*` 请求数据。
4. Node 使用 `sqlite3` CLI 读写 `data/exam-planner.sqlite`。
5. 保存成功后 TanStack Query 精确失效相关 query key。
6. TanStack Query 重新拉取页面级数据；不再叠加自定义短缓存。

## 当前新增结构

- `src/pages/LearningProgressPage.tsx`：学习进度仪表盘。
- `src/pages/OperationsPage.tsx`：统一的运维与健康中心，只呈现可执行结论、备份和日志摘要。
- `src/utils/theme.ts`：浅色/深色模式持久化。
- `.env.example`：环境变量模板。

## 维护边界

生产服务按 `SERVICE_ROLE=web|worker` 分为 Web 请求进程和后台任务进程。路由、认证、HTTP、备份、通知与 Break Guard 领域边界已经拆出；历史 schema 和复杂数据计算仍由兼容入口编排。后续应继续抽 repository/service，不需要为拆分而迁移到另一套 Web 框架。
