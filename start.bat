@echo off
title Murasame Launcher
echo.
echo Murasame Live2D Launcher
echo.

if not exist "%~dp0start.ps1" (
    echo ERROR: start.ps1 not found!
    pause
    exit /b 1
)

echo Starting services...
powershell -ExecutionPolicy Bypass -File "%~dp0start.ps1"

echo.
echo Done!
pause
