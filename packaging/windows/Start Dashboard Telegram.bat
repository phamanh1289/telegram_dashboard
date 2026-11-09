@echo off
rem Radar (installed build). Close this window to stop the server.
rem Keep this file tiny and stable: in-app updates swap versions\<ver> + "current", never this file.
setlocal
cd /d "%~dp0"
title Radar
set "TD_HOME=%~dp0"
rem All AI uses the CLIs' own logins: don't leak a gateway from the environment.
rem Python defaults to cp1252 for files on Windows; Vietnamese text needs UTF-8.
set PYTHONUTF8=1
set ANTHROPIC_BASE_URL=
set ANTHROPIC_API_KEY=
set ANTHROPIC_AUTH_TOKEN=
set ANTHROPIC_MODEL=

rem The server opens the browser itself (on 8765, or the next free port when it is taken).
set TD_OPEN=1
echo.
echo  Radar - dong cua so nay de tat.
echo.
:run
set /p V=<current
pushd "versions\%V%\app"
"..\python\python.exe" -m telegram_dashboard serve
set CODE=%errorlevel%
set TD_OPEN=
popd
rem 75 = updated from Settings: start the new version.
if "%CODE%"=="75" goto run
if not "%CODE%"=="0" pause
