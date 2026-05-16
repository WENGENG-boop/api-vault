@echo off
setlocal
cd /d "%~dp0"
set "APP_URL=http://127.0.0.1:3210"

where docker >nul 2>nul
if errorlevel 1 (
  echo Docker was not found.
  echo.
  echo Please install Docker Desktop from:
  echo https://www.docker.com/products/docker-desktop/
  echo.
  echo After Docker Desktop is installed and running, double-click this file again.
  pause
  exit /b 1
)

echo Starting API Vault with Docker...
docker compose up -d --build
if errorlevel 1 (
  echo Docker failed to start API Vault.
  echo Make sure Docker Desktop is running, then try again.
  pause
  exit /b 1
)

timeout /t 3 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%APP_URL%'"
echo API Vault is running at %APP_URL%
pause
