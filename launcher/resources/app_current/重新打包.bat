@echo off
chcp 65001 >nul 2>&1
echo ========================================
echo   丛雨 Live2D - 重新打包 ASAR
echo ========================================
echo.
cd /d "%~dp0"
echo 正在打包 app.asar (从 app_current/)...
node -e "const a=require('asar'),p=require('path');a.createPackageWithOptions('.',p.resolve('..','app.asar'),{unpack:'**/*.node',unpackDir:'{electron,node_modules}'}).then(()=>console.log('SUCCESS: app.asar 已更新')).catch(e=>console.log('FAILED:',e.message))"
echo.
pause
