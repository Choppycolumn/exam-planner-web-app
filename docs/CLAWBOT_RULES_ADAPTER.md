# ClawBot 规则适配器

本项目已预留一个不接模型 API 的 ClawBot/微信消息适配层。它只做规则解析和本地数据读写，适合用来做每日提醒推送、微信里新增待办、完成待办和查询待办。

## 环境变量

- `CLAWBOT_SECRET`：ClawBot 调用后端时使用的共享密钥。必须设置，否则 `/api/clawbot/*` 会返回 disabled。
- `CLAWBOT_WEBHOOK_URL`：可选。用于服务端主动把每日简报推送给 ClawBot 或中转服务。

密钥可以放在请求头 `x-clawbot-secret`，也可以用 `Authorization: Bearer <secret>`，或放在 query/body 的 `secret` 字段。

## 接口

- `GET /api/clawbot/status`：检查适配器是否启用、Webhook 是否配置。
- `GET|POST /api/clawbot/help`：返回规则命令帮助。
- `POST /api/clawbot/message`：接收微信文本消息并执行规则命令。
- `GET|POST /api/clawbot/daily-digest`：生成每日提醒文本，不主动外发。
- `POST /api/clawbot/push-daily`：生成每日提醒并通过 `CLAWBOT_WEBHOOK_URL` 推送。

`POST /api/clawbot/message` 支持这些 JSON 字段名：`text`、`content`、`message`、`msg`、`rawMessage`，也兼容 `data`、`event`、`payload` 下的同名字段。

## 当前规则命令

- `待办 明天 高 背单词 50 个`
- `待办 2026-06-03 中 整理错题`
- `待办 下周一 p1 做周计划`
- `完成 背单词`
- `删除待办 背单词`
- `今日待办`
- `本周待办`
- `每日简报`
- `帮助`

日期识别支持：今天、明天、后天、大后天、`YYYY-MM-DD`、`M-D`、`M/D`、`M月D日`、周一到周日、下周一到下周日。

优先级识别支持：

- 高：高、紧急、重要、P0、P1、urgent、high
- 中：中、普通、一般、P2、medium、normal
- 低：低、不急、P3、low

## ClawBot 配置建议

如果 ClawBot 支持“收到文本后请求 HTTP Webhook”，把微信消息原文转发到：

```text
POST https://你的域名/api/clawbot/message
Header: x-clawbot-secret: <CLAWBOT_SECRET>
Body: { "text": "{{微信消息文本}}" }
```

如果 ClawBot 支持定时任务拉取内容，可每天请求：

```text
GET https://你的域名/api/clawbot/daily-digest
Header: x-clawbot-secret: <CLAWBOT_SECRET>
```

如果 ClawBot 或中转服务提供接收推送的 Webhook，把地址填入 `CLAWBOT_WEBHOOK_URL`，再由系统定时或手动调用 `/api/clawbot/push-daily`。

## 边界

- 当前不接入模型 API，不做自然语言自由对话，只识别固定命令。
- 完成/删除待办按标题关键词匹配；如果命中多个，会要求使用更具体关键词或 `#ID`。
- `/api/clawbot/*` 不依赖网页登录态，但必须带 `CLAWBOT_SECRET`。
- 当前只操作短期待办和每日提醒文本，不触碰理财、资料库、设置中心等敏感模块。
