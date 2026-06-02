@echo off
chcp 65001 >nul
title 丛雨桌面版 - 启动器

echo ========================================
echo    丛雨桌面版启动器 v2.0
echo ========================================
echo.

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装
    pause
    exit /b 1
)

REM 获取脚本所在目录
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

REM 清理旧进程
echo [1/4] 清理旧进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8888.*LISTENING"') do taskkill /F /PID %%a 2>nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9880.*LISTENING"') do taskkill /F /PID %%a 2>nul

REM 启动 TTS 服务 (GPT-SoVITS)
echo [2/4] 检查 TTS 服务 (GPT-SoVITS)...
netstat -ano | findstr ":9880.*LISTENING" >nul
if %errorlevel% neq 0 (
    echo     TTS 服务未运行，请手动启动 GPT-SoVITS
    echo     提示：在 "E:\gpt sovlts\GPT-SoVITS-v2pro-20250604-nvidia50" 目录运行
) else (
    echo     TTS 服务已就绪
)

REM 启动丛雨服务器
echo [3/4] 启动丛雨服务器...
start "丛雨服务器" cmd /c "cd /d "%SCRIPT_DIR%" ^&^& node server.js"
timeout /t 2 /nobreak >nul

REM 检查服务器是否启动成功
netstat -ano | findstr ":8888.*LISTENING" >nul
if %errorlevel% neq 0 (
    echo [错误] 丛雨服务器启动失败
    pause
    exit /b 1
)
echo     服务器启动成功

REM 打开浏览器
echo [4/4] 打开浏览器...
start http://localhost:8888

echo.
echo ========================================
echo    启动完成！
echo ========================================
echo.
echo 提示：
echo   - 打开浏览器访问 http://localhost:8888
echo   - TTS 声音需要在 GPT-SoVITS 中启用
echo   - 按任意键关闭此窗口（服务继续运行）
echo   - 双击 "停止服务.bat" 可停止所有服务
echo.
pause >nul
