# 桌宠统计接入

本模块用于接收 Windows 桌宠上传的学习/娱乐统计，并在网站中展示“桌宠统计”页面。

## 环境变量

```env
STUDY_PET_API_TOKEN=change-me
```

桌宠端 `desktop-pet/config.json` 的 `apiToken` 必须与该值一致。公网部署时必须使用 HTTPS，不要把真实 Token 提交到 Git。

## 接口

### POST /api/study-pet/report

鉴权：

```http
Authorization: Bearer <STUDY_PET_API_TOKEN>
```

请求体：

```json
{
  "date": "2026-06-17",
  "timezone": "Asia/Shanghai",
  "deviceId": "windows-main",
  "totalComputerSeconds": 18000,
  "studySeconds": 7200,
  "entertainmentSeconds": 3600,
  "toolSeconds": 2400,
  "socialSeconds": 900,
  "unknownSeconds": 3900,
  "sites": [
    {
      "domain": "bilibili.com",
      "category": "entertainment",
      "seconds": 1200,
      "visits": 3
    }
  ],
  "entertainmentOvertimeCount": 2,
  "strongReminderCount": 2,
  "studyGoal": {
    "targetStudySeconds": 10800,
    "completed": false
  }
}
```

成功响应：

```json
{ "ok": true, "date": "2026-06-17", "deviceId": "windows-main" }
```

### GET /api/study-pet/today

需要网站登录 Cookie。支持 `date=YYYY-MM-DD`，默认日期按 `Asia/Shanghai`。

### GET /api/study-pet/stats

需要网站登录 Cookie。支持 `startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`，默认最近 7 天，默认日期按 `Asia/Shanghai`。

返回：

```json
{
  "generatedAt": "2026-06-17T12:00:00.000Z",
  "timezone": "Asia/Shanghai",
  "startDate": "2026-06-11",
  "endDate": "2026-06-17",
  "daily": [],
  "siteUsage": [],
  "readOnly": false
}
```

## curl 示例

```bash
curl -i -X POST http://127.0.0.1:8080/api/study-pet/report \
  -H "Authorization: Bearer change-me" \
  -H "Content-Type: application/json" \
  --data '{"date":"2026-06-17","timezone":"Asia/Shanghai","deviceId":"windows-main","totalComputerSeconds":18000,"studySeconds":7200,"entertainmentSeconds":3600,"toolSeconds":2400,"socialSeconds":900,"unknownSeconds":3900,"sites":[{"domain":"bilibili.com","category":"entertainment","seconds":1200,"visits":3}],"entertainmentOvertimeCount":2,"strongReminderCount":2,"studyGoal":{"targetStudySeconds":10800,"completed":false}}'
```

## 数据表

- `study_pet_daily_reports`
- `study_pet_site_usage`

迁移文件：`server/migrations/019_study_pet.sql`。
