@echo off
rem Double-click to start LinksDocs: runs the local server and opens the app in your browser.
chcp 65001 >nul
title LinksDocs server
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org and run start.bat again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node server.js --open
pause
