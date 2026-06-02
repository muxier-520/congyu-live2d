@echo off
chcp 65001 >nul
title 丛雨Live2D 桌面版

echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║      🌸 丛雨 Live2D 桌面版启动器 🌸      ║
echo  ╚═══════════════════════════════════════════╝
echo.

cd /d "%~dp0"

REM 检查Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装
    pause
    exit /b 1
)

REM 启动服务器
echo [1/3] 启动丛雨服务器...
start "丛雨服务器" cmd /k "node server.js && pause"

REM 等待服务器启动
echo 等待服务器启动...
timeout /t 3 /nobreak >nul

REM 检查服务器
curl -s http://localhost:8888/ >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 服务器启动失败
    pause
    exit /b 1
)

REM 启动浏览器
echo [2/3] 服务器就绪
echo [3/3] 打开丛雨界面...
start http://localhost:8888/

echo.
echo  ════════════════════════════════════════════
echo  ✅ 丛雨已启动！
echo  ════════════════════════════════════════════
echo.
echo  功能说明：
echo  • 点击右上角 💻/☁️ 切换语音模式
echo  • 💻 本地 = GPT-SoVITS 语音
echo  • ☁️ 云端 = Edge TTS 语音
echo.
echo  按任意键打开浏览器...
pause >nul

start http://localhost:8888/
