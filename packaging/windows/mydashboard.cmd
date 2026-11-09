@echo off
rem `mydashboard start` from any cmd/PowerShell (Setup.exe puts this folder on the user PATH).
if "%~1"=="" goto start
if /i "%~1"=="start" goto start
if /i "%~1"=="open" goto open
echo Dung: mydashboard start ^| open
exit /b 2
:open
rem The running dashboard in the browser, signed in with its API token.
setlocal
set /p V=<"%~dp0current"
pushd "%~dp0versions\%V%\app"
"..\python\python.exe" -m telegram_dashboard open
popd
exit /b
:start
call "%~dp0Start Dashboard Telegram.bat"
