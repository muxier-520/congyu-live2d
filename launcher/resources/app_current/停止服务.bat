@echo off
chcp 65001 >nul
title 停止丛雨服务

echo ========================================
echo    停止丛雨服务
echo ========================================
echo.

echo 正在停止服务...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8888.*LISTENING"') do (
    echo 停止丛雨服务器 (PID: %%a)...
    taskkill /F /PID %%a 2>nul
)

echo.
echo 所有服务已停止。
pause
