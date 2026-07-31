# 项目架构说明

## 项目定位

Exam Planner 是一个小型多用户学习与任务管理 Web App。当前架构是 React/Vite 前端加轻量 Node.js HTTP 服务，生产数据落在 SQLite 中。正式账户分为 owner 和 member，功能授权由持久化 capability 决定；visitor 是 owner 数据的只读访问身份。

## 目录概览

- `src/`：前端源码。
- `src/pages/`：页面级模块，每个路由对应一个页面。
- `src/components/`：通用 UI 与图表组件。
- `src/hooks/`：前端数据读取与页面状态 Hook。
- `src/api/`：前端请求封装、TanStack Query 缓存键。
- `src/features/`：领域功能模块，目前保留易混词等仍在使用的能力。
- `src/db/`：历史本地 IndexedDB/Dexie 结构与迁移能力。
- `server/auth-static-server.mjs`：生产 Node 组合入口，创建应用上下文并装配静态文件、登录、API、SQLite、备份、简报和报告领域。
- `server/app/application-context.mjs`：每个进程独立创建应用上下文，并为每个领域生成只包含声明能力的受限代理。
- `server/app/domains/`：按 brief、learning、notifications、operations、persistence、reports 等细粒度模块组织；单个实现文件限制在 500 行内。
- `server/repositories/`：业务查询和持久化边界，路由、服务及非 schema 领域不得直接写 SQL。
- `shared/api-contracts.js`：前后端共享的路径、方法、能力和基础请求字段契约。
- `server/auth/`：账户、凭据、能力、持久化会话和登录保护。
- `server/domains/brief/settings-service.mjs`：简报与英语计划设置、密文迁移和规范化。
- `server/domains/tasks/task-runner.mjs`：后台任务互斥、超时、资源预算和运行记录。
- `server/infrastructure/resource-budget.mjs`：后台重任务的内存、负载和并发闸门。
- `server/modules/notification-channel-health.mjs`：通知通道健康与熔断。
- `server/modules/migration-runner.mjs`：基于文件名和校验和的统一迁移账本。
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

路由使用 `react-router-dom` 的 `createBrowserRouter`。首页直接加载，其余页面通过 `React.lazy` 和 `routeLoaders` 懒加载，只在用户悬停或聚焦导航入口时预取。首页图表通过 IntersectionObserver 延迟到接近视口时加载。

## 后端入口与数据流

生产后端入口是 `server/auth-static-server.mjs`。它在 `127.0.0.1:8080` 提供服务，由 Nginx 反向代理到公网 HTTPS。

主要数据流：

1. 浏览器访问页面，Nginx 转发到 Node。
2. Node 校验签名 Cookie，再用哈希 Token 查找持久化会话、账户状态、会话版本和能力。
3. API 入口根据共享契约与 capability 校验路径、方法和请求字段。
4. 路由把 `userId` 显式传给服务与仓储；所有个人数据查询按账户隔离。
5. Node 使用仓储层读写 `data/exam-planner.sqlite`；ECDICT 查询走独立 `data/dictionary.sqlite`。
6. 保存成功后 TanStack Query 精确失效相关 query key。
7. TanStack Query 重新拉取页面级数据；不再叠加自定义短缓存。

## 多用户边界

- `user_accounts` 保存公开身份、角色、状态与会话版本。
- `user_credentials` 只保存 scrypt 密码哈希。
- `user_capabilities` 决定页面、导航和 API 权限。
- `user_sessions` 只保存 Token 哈希，可按用户即时撤销。
- `user_invites` 是有时效、一次性、可撤销的注册入口。
- 学习、任务、复盘、科目、模考、单词、报告和网页专注计时均按 `user_id` 隔离。
- `/api/study-comparison` 只返回可比较的聚合学习时长。

## 当前新增结构

- `src/pages/LearningProgressPage.tsx`：学习进度仪表盘。
- `src/pages/OperationsPage.tsx`：统一的运维与健康中心，只呈现可执行结论、备份和日志摘要。
- `src/utils/theme.ts`：浅色/深色模式持久化。
- `.env.example`：环境变量模板。

## 维护边界

生产服务按 `SERVICE_ROLE=web|worker` 分为 Web 请求进程和后台任务进程。每个领域只获得自身声明的上下文能力，动态访问未声明能力会立即失败。HTTP 层不含 SQL，schema 引导之外的业务 SQL 收口在仓储层；结构变化统一进入迁移账本。
