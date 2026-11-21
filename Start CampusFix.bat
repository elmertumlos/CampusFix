@echo off
setlocal
title CampusFix - Local server
pushd "%~dp0" || exit /b 1

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo Node.js and npm are required. See README.md for setup.
    pause
    popd
    exit /b 1
)

if not exist "node_modules\wrangler\bin\wrangler.js" (
    echo Dependencies are missing. Run npm.cmd ci and npm.cmd run setup.
    pause
    popd
    exit /b 1
)

if not exist ".dev.vars" (
    echo CampusFix is not set up. Run npm.cmd run setup.
    pause
    popd
    exit /b 1
)

echo Starting CampusFix. Press Ctrl+C to stop the local server.
call npm.cmd run dev
set "serverExitCode=%errorlevel%"
if not "%serverExitCode%"=="0" pause
popd
exit /b %serverExitCode%
