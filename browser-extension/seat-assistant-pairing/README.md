# ExamPlanner 只读座位提醒配对扩展

这是一个 Manifest V3 本地扩展。它不会自动登录、读取登录表单、处理验证码、读取页面脚本或 LocalStorage，也不会提交预约、取消或锁座请求。扩展只在用户点击后调用 `chrome.cookies.getAll({ url })`，第一步展示 Cookie 名称/属性/到期时间，第二步明确确认后才把目标域 Cookie 交给 ExamPlanner。

## 安装与使用

1. 在 ExamPlanner 的 `/seat-assistant` 页面创建一次性配对码（有效期 10 分钟）。
2. 生产 origin 固定为 `https://8.130.68.9`；本机开发可使用 `http://127.0.0.1:<port>`。
3. 在 `chrome://extensions` 启用开发者模式，加载本目录。
4. 在官方图书馆页面正常登录并完成人工验证码，不要在扩展中填写密码或验证码。
5. 将扩展的 32 位 ID 配置为 `SEAT_ASSISTANT_EXTENSION_ORIGIN=chrome-extension://该ID`；服务端只接受这一来源。
6. 填写 origin、图书馆 URL、配对 ID 和一次性配对码，先检查 Cookie 清单，再核对后确认配对。

Cookie bundle 在服务端使用 `COOKIE_SECRET` 派生的 AES-256-GCM 密钥加密保存，最长 8 小时或到 Cookie 最早到期时间；只读查询遇到登录失效、验证码、403/429 或风控会立即停止。
