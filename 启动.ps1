# 丛雨 Live2D 启动脚本 (PowerShell)
# 保存为: 启动.ps1

$ErrorActionPreference = "Stop"

# 颜色定义
$Green = "Green"
$Cyan = "Cyan"
$Yellow = "Yellow"
$Red = "Red"

# 路径配置
$APP_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$SERVER_DIR = Join-Path $APP_DIR "src"
$LAUNCHER_DIR = Join-Path $APP_DIR "launcher"
$REF_AUDIO = Join-Path $APP_DIR "src\models\sounds\bandicam 2021-11-23 02-18-04-516.mp4.wav"

Write-Host "========================================" -ForegroundColor $Cyan
Write-Host "     丛雨 Live2D 启动器" -ForegroundColor $Cyan
Write-Host "========================================" -ForegroundColor $Cyan
Write-Host ""

# 检查参考音频
if (-not (Test-Path $REF_AUDIO)) {
    Write-Host "❌ 参考音频未找到: $REF_AUDIO" -ForegroundColor $Red
    pause
    exit 1
}
Write-Host "✓ 参考音频: $(Split-Path $REF_AUDIO -Leaf)" -ForegroundColor $Green

# 查找 GPT-SoVITS
$gptPaths = @(
    "E:\gpt sovlts\GPT-SoVITS-v2pro-20250604-nvidia50",
    "D:\GPT-SoVITS-v2pro-20250604-nvidia50",
    "C:\GPT-SoVITS-v2pro-20250604-nvidia50"
)
$GPT_DIR = $null
foreach ($p in $gptPaths) {
    if (Test-Path $p) {
        $GPT_DIR = $p
        break
    }
}

if (-not $GPT_DIR) {
    Write-Host "❌ GPT-SoVITS 未找到！请确认已安装到以下位置之一:" -ForegroundColor $Red
    $gptPaths | ForEach-Object { Write-Host "   $_" -ForegroundColor $Yellow }
    pause
    exit 1
}
Write-Host "✓ GPT-SoVITS: $GPT_DIR" -ForegroundColor $Green

# 查找 Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    $nodePaths = @(
        "C:\Program Files\nodejs\node.exe",
        "C:\Program Files (x86)\nodejs\node.exe"
    )
    foreach ($p in $nodePaths) {
        if (Test-Path $p) {
            $node = $p
            break
        }
    }
}
if (-not $node) {
    Write-Host "❌ Node.js 未找到！请安装 Node.js" -ForegroundColor $Red
    pause
    exit 1
}
Write-Host "✓ Node.js: $node" -ForegroundColor $Green

# 检查端口 9880 (GPT-SoVITS)
Write-Host ""
Write-Host "检查 GPT-SoVITS 状态..." -ForegroundColor $Cyan
$gptRunning = $false
try {
    $conn = Get-NetTCPConnection -LocalPort 9880 -ErrorAction SilentlyContinue
    if ($conn) {
        $gptRunning = $true
        Write-Host "✓ GPT-SoVITS 已在运行 (端口 9880)" -ForegroundColor $Green
    }
} catch {}

if (-not $gptRunning) {
    Write-Host "🚀 启动 GPT-SoVITS..." -ForegroundColor $Cyan
    $env:PYTHONIOENCODING = "utf-8"
    $env:CUDA_VISIBLE_DEVICES = "0"
    
    $gptArgs = @(
        "api.py",
        "-dr", $REF_AUDIO,
        "-dt", "こんにちは、丛雨です。何かお話ししましょうか？",
        "-dl", "ja",
        "-a", "127.0.0.1",
        "-p", "9880"
    )
    
    try {
        Start-Process -FilePath "python" -ArgumentList $gptArgs `
            -WorkingDirectory $GPT_DIR -WindowStyle Hidden
        Write-Host "⏳ 等待 GPT-SoVITS 启动..." -ForegroundColor $Yellow
        Start-Sleep -Seconds 8
        
        # 验证启动
        $test = Invoke-RestMethod -Uri "http://127.0.0.1:9880" -Method GET -ErrorAction SilentlyContinue
        Write-Host "✓ GPT-SoVITS 启动成功" -ForegroundColor $Green
    } catch {
        Write-Host "⚠ GPT-SoVITS 启动中，可能需要更长时间..." -ForegroundColor $Yellow
        Start-Sleep -Seconds 5
    }
}

# 检查端口 8888 (Node 服务)
Write-Host ""
Write-Host "检查服务器状态..." -ForegroundColor $Cyan
$serverRunning = $false
try {
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:8888/api/status" -Method GET -TimeoutSec 2 -ErrorAction SilentlyContinue
    if ($resp) {
        $serverRunning = $true
        Write-Host "✓ 服务器已在运行 (端口 8888)" -ForegroundColor $Green
    }
} catch {}

if (-not $serverRunning) {
    Write-Host "🚀 启动 Node 服务器..." -ForegroundColor $Cyan
    try {
        Start-Process -FilePath $node -ArgumentList "server.js" `
            -WorkingDirectory $SERVER_DIR -WindowStyle Hidden
        Write-Host "⏳ 等待服务器启动..." -ForegroundColor $Yellow
        Start-Sleep -Seconds 3
        Write-Host "✓ 服务器启动成功" -ForegroundColor $Green
    } catch {
        Write-Host "❌ 服务器启动失败: $_" -ForegroundColor $Red
        pause
        exit 1
    }
}

# 启动 Electron
Write-Host ""
Write-Host "🚀 启动丛雨 Live2D..." -ForegroundColor $Cyan
$exePath = Join-Path $LAUNCHER_DIR "丛雨Live2D.exe"
if (-not (Test-Path $exePath)) {
    $exePath = Join-Path $APP_DIR "丛雨Live2D.exe"
}

if (Test-Path $exePath) {
    Start-Process -FilePath $exePath
    Write-Host ""
    Write-Host "========================================" -ForegroundColor $Green
    Write-Host "     ✅ 丛雨已启动！" -ForegroundColor $Green
    Write-Host "========================================" -ForegroundColor $Green
    Start-Sleep -Seconds 2
} else {
    Write-Host "❌ 未找到 丛雨Live2D.exe" -ForegroundColor $Red
    pause
    exit 1
}
