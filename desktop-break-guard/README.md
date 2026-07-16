# Break Guard

Windows 学习计时与休息提醒程序。运行状态、课程记录、待同步事件和日志保存在 `%LOCALAPPDATA%\ExamPlanner\BreakGuard`，网站令牌使用 Windows DPAPI 加密。

## 日常使用

- 课程直接来自网站学习项目，不再设置固定节数；点击科目后开始记录实际学习时长。
- 在“学习设置”中设置每日目标时长、课间休息和进度提醒宽限。
- 休息结束后仍保留原有全屏提醒、1 分钟网站通知和 5 分钟不专注记录。
- 当每日已学时长未达目标且休息超过宽限时间时，程序会全屏提醒，并通过网站通知系统发送进度提醒。
- 午饭和晚饭为不计时暂停；开始下一次学习后自动恢复进度监测。

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

桌面和开机启动快捷方式统一调用无控制台启动器。系统允许本地未签名程序时优先运行打包版；Windows Smart App Control 拦截未签名 EXE 时自动改用已签名的 `pythonw.exe` 运行同一份源码，不关闭或绕过系统安全策略。
