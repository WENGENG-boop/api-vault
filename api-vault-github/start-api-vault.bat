@echo off
setlocal
cd /d "%~dp0"
set "PORT=3210"
set "APP_URL=http://127.0.0.1:3210"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Please install the official Node.js LTS from:
  echo https://nodejs.org/en/download/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please reinstall the official Node.js LTS from:
  echo https://nodejs.org/en/download/
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%APP_URL%/api/state' -TimeoutSec 1 | Out-Null; Start-Process '%APP_URL%'; exit 0 } catch { exit 1 }"
if "%ERRORLEVEL%"=="0" exit /b 0

if not exist "node_modules" (
  echo Installing dependencies with npm...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Building API Vault...
call npm run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo Starting API Vault at %APP_URL% ...
start "API Vault Server" /min cmd /c "cd /d ""%~dp0"" && npm run serve"
timeout /t 2 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%APP_URL%'"
echo API Vault is running at %APP_URL%
echo Close the server window or stop node.exe when you want to shut it down.
pause
