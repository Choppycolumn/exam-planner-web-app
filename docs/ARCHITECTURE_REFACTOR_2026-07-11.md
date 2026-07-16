# 2026-07-11 架构与性能重构

## 运行边界

- `server/web.mjs`：仅启用 HTTP、认证、静态资源和 API。
- `server/worker.mjs`：仅启用简报、通知、任务提醒、备份和维护调度。
- `server/privileged-helper.mjs`：以 root 运行，只通过 `/run/exam-planner/privileged.sock` 提供代理管理和微信发送白名单操作。
- Web 与 Worker 使用 `examplanner` 专用用户；数据目录归该用户所有，运行密钥保持 `root:examplanner 0640`。

## 数据库

- 普通查询使用 Node 22 `DatabaseSync` 持久连接，不再为每次 SQL 启动 `sqlite3` 子进程。
- HTTP 路由与领域服务不再直接包含 SQL；学习、简报、单词备份、Break Guard 和服务器备份分别通过 `server/repositories/` 访问数据库。
- 新仓储使用参数绑定处理用户输入，路由只负责协议解析和响应。
- 写入状态支持参数绑定；事务失败自动回滚。
- 数据库恢复前关闭连接，替换后重新打开，并有自动恢复测试。
- CLI 只保留给一次性 ECDICT CSV 导入；部署前备份继续使用系统 `sqlite3` 校验。
- 健康状态包含数据库调用次数、平均耗时、慢查询次数和连接状态。

## 外部调用

- 行情备用 curl、代理检测和 journalctl 改为异步子进程，不再阻塞 Node 事件循环。
- 所有子进程统一限制超时、输出大小，并在超时时终止进程组。

## 前端

- `src/api/transport.ts` 只负责 HTTP、超时和错误转换，`src/api/contracts.ts` 只保存运行时响应契约，`src/api/client.ts` 是精简 API 门面。
- 设置页的默认值与格式化规则位于 `src/features/settings/settingsModel.ts`，导航和简报设置分别由独立组件负责。
- 删除未使用的 `dexie-react-hooks`。
- Dexie 仅保留在按需加载的旧数据迁移页，业务数据以服务器 SQLite 为唯一真源。
- 删除 Framer Motion，使用轻量 CSS 动画和 `prefers-reduced-motion`，减少约 125 KB 构建产物。

## 服务端模块

- `server/auth-static-server.mjs` 从 7547 行缩减为约 265 行，只负责配置、依赖装配和加载启动模块。
- `server/app/domains/` 按持久化、报告、简报、代理、运维、学习、通知、API 与启动生命周期拆分，不再保留单一巨型入口副本。
- 模块间共享运行状态已进一步替换为 `createApplicationContext()` 创建的进程级显式上下文；各领域通过安装器注入，不再引用模块级全局 `runtime-context.mjs`。

## 调度

- `server/infrastructure/scheduler-registry.mjs` 是后台任务的唯一计时器所有者。
- 简报、夜间错题分析、备份检查、维护、待办提醒、通知队列、Worker 心跳和 Worker 保活统一注册、去重和停止。
- 周期任务采用串行重排，上一轮未完成时不会并发重入；运行状态会展示任务名称、下次运行时间和最近错误。

## 部署与回滚

- 网站固定使用 `/opt/node-v22.22.3-linux-x64/bin/node`，不改变 OpenClaw 服务。
- 候选阶段同时验证 privileged helper、临时数据库、登录边界、任务 CRUD、Break Guard 幂等和退役路由。
- 部署前备份代码、数据库和 systemd 单元；失败时同时恢复三者。
