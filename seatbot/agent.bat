@echo off
setlocal EnableExtensions
title Seatbot Login Agent
cd /d "%~dp0"
echo ========================================
echo   Seatbot - Resident Login Agent
echo ========================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [Seatbot] Creating venv...
  python -m venv .venv
)

call ".venv\Scripts\activate.bat"
set "PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple"
set "PIP_HOST=pypi.tuna.tsinghua.edu.cn"
python -m pip install -q -r requirements.txt -i %PIP_INDEX% --trusted-host %PIP_HOST%
if errorlevel 1 (
  python -m pip install -q -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
)

if not exist "config.yaml" (
  copy /Y "config.example.yaml" "config.yaml" >nul
  echo [Seatbot] Please fill config.yaml: username, password, server_ssh_password
  notepad "config.yaml"
)

echo [Seatbot] Auto CAS login and upload session.json ...
python main.py --agent
echo.
echo ----------------------------------------
echo Optional resident mode:
echo   python main.py --agent
echo ----------------------------------------
pause
endlocal
