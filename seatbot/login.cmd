@echo off
REM Double-click to login (no need to type start.bat login)
setlocal EnableExtensions
title Seatbot Login
cd /d "%~dp0"
echo ========================================
echo   Seatbot - Login
echo ========================================
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Install Python 3.10+ with PATH.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [Seatbot] Creating venv...
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] venv failed
    pause
    exit /b 1
  )
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
  echo [Seatbot] Created config.yaml - please fill username/password if needed.
  notepad "config.yaml"
)

echo [Seatbot] Opening browser for CAS login...
echo Complete the captcha, wait until seat page appears.
echo.
python main.py --login
echo.
echo ----------------------------------------
echo If success: upload session.json to server:
echo   scp session.json seatbot@your-server:/opt/seatbot/
echo ----------------------------------------
pause
endlocal
