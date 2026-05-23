@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title API Vault Starter
set "PORT=3210"
set "APP_URL=http://127.0.0.1:3210"

call :refreshPath
call :ensureNodeAndNpm
if errorlevel 1 exit /b 1

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing '%APP_URL%/api/state' -TimeoutSec 1 | Out-Null; Start-Process '%APP_URL%'; exit 0 } catch { exit 1 }"
if "%ERRORLEVEL%"=="0" exit /b 0

if not exist "node_modules" (
  echo.
  echo Installing project dependencies with npm...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed. Check your network connection and try again.
    pause
    exit /b 1
  )
)

echo.
echo Building API Vault...
call npm run build
if errorlevel 1 (
  echo.
  echo Build failed. Please copy the error above when asking for help.
  pause
  exit /b 1
)

echo.
echo Starting API Vault at %APP_URL% ...
start "API Vault Server" /min cmd /c "cd /d ""%~dp0"" && npm run serve"
timeout /t 3 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%APP_URL%'"
echo.
echo API Vault is running at %APP_URL%
echo Close the server window or stop node.exe when you want to shut it down.
pause
exit /b 0

:refreshPath
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
exit /b 0

:ensureNodeAndNpm
where node >nul 2>nul
set "HAS_NODE=%ERRORLEVEL%"
where npm >nul 2>nul
set "HAS_NPM=%ERRORLEVEL%"
if "%HAS_NODE%"=="0" if "%HAS_NPM%"=="0" exit /b 0

echo.
echo Node.js/npm is missing or incomplete.
echo API Vault needs the official Node.js LTS runtime with npm.
echo.
echo This starter will download Node.js LTS from the official nodejs.org site
echo and launch the official Windows installer. Windows may ask for permission.
echo.
echo Installing official Node.js LTS now...
call :installOfficialNode
if errorlevel 1 (
  echo.
  echo Automatic Node.js installation failed.
  echo Please install the official Node.js LTS manually from:
  echo https://nodejs.org/en/download/
  pause
  exit /b 1
)

call :refreshPath
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js still cannot be found. Close this window and double-click again.
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo npm still cannot be found. Close this window and double-click again.
  echo If it still fails, reinstall Node.js LTS from https://nodejs.org/en/download/
  pause
  exit /b 1
)
exit /b 0

:installOfficialNode
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $versions=Invoke-RestMethod 'https://nodejs.org/dist/index.json'; $lts=$versions | Where-Object { $_.lts -ne $false } | Select-Object -First 1; if (-not $lts) { throw 'Could not find Node.js LTS version.' }; $v=$lts.version; $arch= if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }; $url='https://nodejs.org/dist/' + $v + '/node-' + $v + '-' + $arch + '.msi'; $out=Join-Path $env:TEMP ('node-' + $v + '-' + $arch + '.msi'); Write-Host ('Downloading official Node.js installer: ' + $url); Invoke-WebRequest -UseBasicParsing $url -OutFile $out; Write-Host ('Installing Node.js ' + $v + '...'); $p=Start-Process msiexec.exe -ArgumentList @('/i', $out, '/passive', '/norestart') -Wait -PassThru -Verb RunAs; exit $p.ExitCode"
exit /b %ERRORLEVEL%

