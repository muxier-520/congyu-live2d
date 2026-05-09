@echo off
chcp 65001 >nul 2>&1
title 丛雨 Live2D 启动器

:: 检查 PowerShell 脚本是否存在
if not exist "%~dp0启动.ps1" (
    echo [错误] 启动.ps1 未找到！
    pause
    exit /b 1
)

echo ========================================
echo      丛雨 Live2D 启动器
echo ========================================
echo.

:: 运行 PowerShell 脚本（绕过执行策略）
powershell -ExecutionPolicy Bypass -File "%~dp0启动.ps1"

if %errorlevel% neq 0 (
    echo.
    echo [错误] 启动失败
    pause
)
