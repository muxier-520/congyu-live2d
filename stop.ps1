# Stop Murasame
$ErrorActionPreference = "Continue"

Write-Host "Stopping Murasame and GPT-SoVITS..." -ForegroundColor Yellow

# Kill Electron app
Get-Process -Name "丛雨Live2D","*Live2D*" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "  Electron stopped" -ForegroundColor Gray

# Kill GPT-SoVITS Python processes on port 9880
Get-NetTCPConnection -LocalPort 9880 -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Write-Host "  GPT-SoVITS stopped" -ForegroundColor Gray

# Kill node processes (server.js)
Get-Process -Name "node" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "  Node server stopped" -ForegroundColor Gray

Write-Host "[OK] All stopped" -ForegroundColor Green
