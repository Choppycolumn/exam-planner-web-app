# Break Guard

Windows 休息提醒程序。运行状态、待同步事件和日志保存在 `%LOCALAPPDATA%\ExamPlanner\BreakGuard`，网站令牌使用 Windows DPAPI 加密。

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
