@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   丛雨 Live2D - 重新打包 ASAR
echo ========================================
echo.
cd /d "%~dp0"
if not exist "node_modules\\asar\\bin\\asar.cmd" (
  echo ERROR: asar CLI 未找到
  echo 请运行: npm install -g asar
  pause
  exit /b 1
)
echo 正在打包 src\ 到 app.asar...
node_modules\\asar\\bin\\asar.cmd pack . ..\\app.asar
if %errorlevel% equ 0 (
  echo.
  echo SUCCESS: app.asar 已更新
) else (
  echo.
  echo FAILED!
)
pause
