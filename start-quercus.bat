@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js was not found.
  echo Install Node.js 20 or newer, then run this file again.
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo Node.js 20 or newer is required. Current version:
  node --version
  pause
  exit /b 1
)
echo Starting Quercus Local...
node server.mjs
if errorlevel 1 pause
