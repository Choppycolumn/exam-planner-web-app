# Break Guard

Windows 每日课表与休息提醒程序。运行状态、课程记录、待同步事件和日志保存在 `%LOCALAPPDATA%\ExamPlanner\BreakGuard`，网站令牌使用 Windows DPAPI 加密。

## 日常使用

- 在“课表设置”中设置每天课程数、单节时长、课间休息、首节开始时间和进度宽限时间。
- 点击“开始第 N 节课”进入课程倒计时；到时会自动记录课程并开始课间休息。
- 休息结束后仍保留原有全屏提醒、1 分钟网站通知和 5 分钟不专注记录。
- 当下一节课超过计划结束时间与宽限时间仍未完成时，程序会全屏提醒，并通过网站通知系统发送课表落后提醒。
- 午饭和晚饭为不计时暂停；开始下一节课后自动恢复进度监测。

## 开发运行

```powershell
python -m pip install -r requirements.txt
python break_guard.py
```

## 测试与打包

```powershell
python -m unittest discover -s tests -v
.\build.ps1
```

打包结果为 `dist\BreakGuard.exe`。程序使用 Windows Named Mutex 保证单实例，第二次启动只会显示已有窗口。
