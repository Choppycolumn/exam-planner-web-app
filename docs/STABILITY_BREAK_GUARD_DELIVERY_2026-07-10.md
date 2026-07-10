# 稳定性重构与 Break Guard 交付报告（2026-07-10）

## 网站

- 生产进程已拆分为 Web 与后台 Worker 两个 systemd 服务。请求进程不再执行简报、备份、维护、提醒和通知队列任务。
- 新增 `/ready`、后台 Worker 心跳和统一健康状态；健康中心可以区分正常、降级、故障。
- 学习读写路由已从生产入口拆到独立模块；认证、HTTP、静态资源、备份、通知、运维和 Break Guard 也具有独立边界。
- 理财情报台与资料库运行时代码已移除，旧 API 固定返回 `410 Gone`，历史数据库表和资料文件只进入备份。
- 前端只保留 TanStack Query 一层服务端缓存；路由按需预加载，PWA 安装事件只保留一个处理器。
- 主动通知统一进入持久化队列；微信在北京时间 03:00-06:59 自动延后到 07:00，期间 Bark、Telegram 和站内通知仍可工作。
- 每日/每周 SQLite 备份按到期时间调度，完整性校验结果跨进程持久化；部署前额外创建并校验数据库快照。
- 生产密钥已从 systemd 内联配置迁移到 `/etc/exam-planner/runtime.env`，权限为 `0600 root:root`。
- 部署采用候选实例、认证 CRUD、Break Guard 幂等、PWA/就绪检查、代码备份、数据库备份和失败回滚。

## Break Guard

- 单文件程序已拆为配置、DPAPI 密钥、本地 SQLite、状态机、同步 Worker、单实例、托盘和 UI 模块。
- 休息计时和 1/5 分钟阈值会落盘，应用或系统重启后可以恢复。
- 网站事件使用稳定 `eventId`，桌面端与服务端双重幂等，避免重复“不专注”记录和重复通知。
- 网络失败进入持久化指数退避队列；401/403 等永久配置错误会停止无意义重试并显示可理解提示。
- 托盘、关闭隐藏、双击切换、重置窗口、真正退出、单实例和全屏提醒均保留。
- Token 使用 Windows DPAPI 保存，日志轮转，窗口状态与事件队列保存在用户 LocalAppData。
- 已生成独立 `BreakGuard.exe`，桌面和开机启动快捷方式直接指向 EXE，不依赖脚本窗口。

## 验证结果

- Web 单元测试：36 项通过，本地仅跳过依赖 Linux sqlite3 CLI 的生产集成套件。
- Git 交付工作区：额外保留 4 项历史 Study Pet 模块测试，共 40 项通过。
- Playwright：桌面和移动端 6 项通过。
- Break Guard：6 项核心测试通过。
- 前端：ESLint、TypeScript、Vite 构建通过。
- 候选服务器：健康、就绪、登录边界、空密码拒绝、任务写入回读、Break Guard 幂等、退役路由边界全部通过。
- 生产服务器：Nginx、Web、Worker、Mihomo、OpenClaw 均为 active；外部 `/health`、`/ready`、PWA manifest 和 service worker 返回 200。
- SQLite：部署前快照与最新日备份完整性检查均为 `ok`。
- 部署后日志：未发现 500、502、崩溃、OOM 或迁移错误。

## 运维入口

- 线上地址：`https://8.130.68.9/`
- 健康检查：`/health`
- 就绪检查：`/ready`
- 桌面程序：`desktop-break-guard/dist/BreakGuard.exe`
- 数据库：`/opt/exam-planner/data/exam-planner.sqlite`
- 数据备份：`/opt/exam-planner/data/backups/`
- 代码回滚包：`/opt/exam-planner-deploy-backups/`

## 已知边界

- 登录仍使用现有用户密码并有失败锁定保护；本次没有静默更换密码，避免把用户锁在站外。建议之后由用户安排一次凭据轮换。
- 服务器内存约 882 MB；Web/Worker 分离后当前总 RSS 可控，但 OpenClaw 仍是最大常驻进程。系统已有 8 GB swap、夜间停机和 watchdog。
- 历史 Study Pet 源码保留在 Git 基线中但不进入当前网站路由；没有覆盖另一工作区中尚未提交的用户修改。

## Break Guard 视觉重构

- 主面板重构为 428 x 424 的 Liquid Glass 小组件：统一浅色/深色 token、柔和渐变、玻璃层级、大圆角、状态点、计时器槽和胶囊按钮。
- 移除会透出桌面文字的网点透明效果与突兀大圆环，改用高对比、低噪声的半透明观感；主操作会随计时状态在“学习结束”和“我回来了”之间切换强调层级。
- 全屏提醒改为深色系统级警示面板，保留强制置顶、超时计时和“不专注”记录提示；按钮 hover、pressed 与点击逻辑均保持可用。
- 保留系统托盘、隐藏任务栏、关闭即隐藏、双击切换、重置位置、开机自启和真正退出行为。
