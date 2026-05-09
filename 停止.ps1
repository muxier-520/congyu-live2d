# 丛雨 Live2D 停止脚本
Write-Host "========================================" -ForegroundColor Red
Write-Host "     停止丛雨 Live2D" -ForegroundColor Red
Write-Host "========================================" -ForegroundColor Red
Write-Host ""

$processes = @("丛雨Live2D", "node", "python")
$killed = 0

foreach ($proc in $processes) {
    $p = Get-Process -Name $proc -ErrorAction SilentlyContinue
    if ($p) {
        $p | Stop-Process -Force
        Write-Host "✓ 已停止: $proc" -ForegroundColor Green
        $killed++
    }
}

if ($killed -eq 0) {
    Write-Host "没有运行中的进程" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "✅ 已清理 $killed 个进程" -ForegroundColor Green
}

Start-Sleep -Seconds 2
