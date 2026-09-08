@echo off
REM Seatbot one-click launcher (ASCII only)
setlocal EnableExtensions
title Seatbot
cd /d "%~dp0"

echo ========================================
echo   Seatbot launcher
echo   Dir: %CD%
echo ========================================
echo.

set "CMD=%~1"

where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Install Python 3.10+ and check Add to PATH.
  echo.
  pause
  exit /b 1
)

python --version
echo.

if not exist ".venv\Scripts\python.exe" (
  echo [Seatbot] Creating venv .venv ...
  python -m venv .venv
  if errorlevel 1 (
    echo [ERROR] Failed to create venv.
    pause
    exit /b 1
  )
)

call ".venv\Scripts\activate.bat"
if errorlevel 1 (
  echo [ERROR] Failed to activate venv.
  pause
  exit /b 1
)

echo [Seatbot] Installing dependencies (first run may be slow)...
echo [Seatbot] Using Tsinghua PyPI mirror (China-friendly)
set "PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple"
set "PIP_HOST=pypi.tuna.tsinghua.edu.cn"
python -m pip install -q --upgrade pip -i %PIP_INDEX% --trusted-host %PIP_HOST%
if errorlevel 1 (
  echo [WARN] pip upgrade failed, continue...
)
python -m pip install -q -r requirements.txt -i %PIP_INDEX% --trusted-host %PIP_HOST%
if errorlevel 1 (
  echo [WARN] Tsinghua mirror failed, try Aliyun...
  python -m pip install -q -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
)
if errorlevel 1 (
  echo [ERROR] pip install failed on all mirrors. Check network / VPN.
  pause
  exit /b 1
)
echo [Seatbot] Dependencies OK.
echo.

if not exist "config.yaml" (
  copy /Y "config.example.yaml" "config.yaml" >nul
  echo [Seatbot] Created config.yaml
  echo   Edit: username, password, area_id, seat_nos
  echo   Example: area_id 101 = East Library 4F center hall
  echo.
  if /I not "%CMD%"=="web" if /I not "%CMD%"=="login" (
    echo Press any key to open config.yaml in Notepad...
    pause >nul
    notepad "config.yaml"
    echo.
    echo Save config.yaml, then run: start.bat login
    pause
    exit /b 2
  )
)

if not exist "logs" mkdir logs

if "%CMD%"=="" (
  echo [Seatbot] Mode: keepalive until grab_at, then book
  echo.
  python main.py
  goto finish
)
if /I "%CMD%"=="login" (
  echo [Seatbot] Mode: local login (CAS)
  echo.
  python main.py --login
  goto finish
)
if /I "%CMD%"=="now" (
  echo [Seatbot] Mode: book now
  echo.
  python main.py --now
  goto finish
)
if /I "%CMD%"=="dry" (
  echo [Seatbot] Mode: dry-run
  echo.
  python main.py --dry-run --now
  goto finish
)
if /I "%CMD%"=="keepalive" (
  echo [Seatbot] Mode: keepalive only
  echo.
  python main.py --keepalive-only
  goto finish
)
if /I "%CMD%"=="web" (
  echo [Seatbot] Opening web panel...
  start "" "%~dp0web\index.html"
  echo Preview: http://127.0.0.1:8765/
  echo Close this window to stop the preview server.
  echo.
  cd web
  python -m http.server 8765 --bind 127.0.0.1
  goto finish
)

echo [ERROR] Unknown arg: %CMD%
echo Usage: start.bat [login^|now^|dry^|keepalive^|web]
echo.

:finish
echo.
echo ----------------------------------------
echo Exit code: %ERRORLEVEL%
echo If there was an error, screenshot the text above.
echo ----------------------------------------
pause
endlocal
