@echo off
chcp 65001 >nul
title 丛雨 Live2D - 浏览器版

:: Kill existing server
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8888.*LISTENING" 2^>nul') do (
    taskkill /F /PID %%a >nul 2>nul
)

:: Start server
cd /d "%~dp0"
echo 正在启动服务器...
start /b "" node server.js

:: Wait for server
echo 等待服务器就绪...
:wait_loop
timeout /t 1 /nobreak >nul
curl -s http://127.0.0.1:8888/api/health >nul 2>nul
if errorlevel 1 goto wait_loop

echo 服务器就绪！正在打开浏览器...
start http://127.0.0.1:8888

echo.
echo ═════════════════════════════════════════
echo   丛雨 Live2D 已启动
echo   浏览器: http://127.0.0.1:8888
echo   关闭此窗口将停止服务器
echo ═══════════════════════════════════════
echo.

:: Keep running (Ctrl+C to stop)
cmd /k
