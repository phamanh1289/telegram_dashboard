@echo off
rem Double-click to start the dashboard on Windows. Close this window to stop it.
setlocal
cd /d "%~dp0"
title Telegram Dashboard

for %%c in (uv node npm git) do (
  where %%c >nul 2>nul || (echo [X] Thieu %%c - xem docs\SETUP.md & pause & exit /b 1)
)

if not exist .venv (echo Cai Python dependencies... & uv sync --locked || (pause & exit /b 1))
if not exist node_modules (echo Cai Node dependencies... & call npm ci || (pause & exit /b 1))

rem Telegram API ID/Hash and login are set in the dashboard (Cai dat Telegram); .env is optional.

rem Rebuild the UI when the code changed since the last build (git HEAD differs).
set HEAD=none
for /f %%h in ('git rev-parse HEAD 2^>nul') do set HEAD=%%h
set BUILT=
if exist web\out\.built set /p BUILT=<web\out\.built
if not exist web\out\index.html set BUILT=
if not "%HEAD%"=="%BUILT%" (
  echo Dang build giao dien...
  call npm run build || (echo [X] Build loi & pause & exit /b 1)
  >web\out\.built echo %HEAD%
)

rem All AI uses the claude CLI's own claude.ai login: don't leak a gateway from the shell.
set ANTHROPIC_BASE_URL=
set ANTHROPIC_API_KEY=
set ANTHROPIC_AUTH_TOKEN=
set ANTHROPIC_MODEL=

start "" cmd /c "timeout /t 5 >nul & start http://127.0.0.1:8765"
echo.
echo  Dashboard: http://127.0.0.1:8765   (Ctrl+C hoac dong cua so de dung)
echo.
uv run --no-sync python -m telegram_dashboard serve
pause
