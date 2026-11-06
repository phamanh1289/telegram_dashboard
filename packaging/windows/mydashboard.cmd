@echo off
rem `mydashboard start` from any cmd/PowerShell (Setup.exe puts this folder on the user PATH).
if "%~1"=="" goto start
if /i "%~1"=="start" goto start
echo Dung: mydashboard start
exit /b 2
:start
call "%~dp0Start Dashboard Telegram.bat"
