# Murasame Live2D Launcher v2.6
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Murasame Live2D Launcher v2.6" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$GPT_DIR = "E:\gpt sovlts\GPT-SoVITS-v2pro-20250604-nvidia50"
$GPT_PY = "E:\gpt sovlts\GPT-SoVITS-v2pro-20250604-nvidia50\runtime\python.exe"
$REF_AUDIO = "E:\openclaw\murasame\src\models\sounds\congyu_ref.wav"
# === 请把下面这段覆盖你原来的对应部分 ===

$GPT_MODEL = "E:\openclaw\murasame\model\congyu-e15.ckpt"
$SOVITS_MODEL = "E:\openclaw\murasame\model\congyu_e8_s200.pth"
$APP_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$EXE = Join-Path $APP_DIR "launcher\丛雨Live2D.exe"

# Verify paths
if (-not (Test-Path $GPT_DIR)) {
    Write-Host "[ERROR] GPT-SoVITS not found: $GPT_DIR" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[OK] GPT-SoVITS: $GPT_DIR" -ForegroundColor Green

if (-not (Test-Path $REF_AUDIO)) {
    Write-Host "[ERROR] Reference audio NOT found: $REF_AUDIO" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[OK] Reference audio: $REF_AUDIO" -ForegroundColor Green

# Check if GPT-SoVITS already listening on port 9880
$port_ready = $false
try {
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    $tcpClient.Connect("127.0.0.1", 9880)
    $tcpClient.Close()
    $port_ready = $true
} catch {}

if ($port_ready) {
    Write-Host "[OK] GPT-SoVITS already listening on port 9880" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "[START] Launching GPT-SoVITS..." -ForegroundColor Cyan
    Write-Host "[INFO] First startup takes 10-40 seconds for GPU model loading" -ForegroundColor Gray

    $env:CUDA_VISIBLE_DEVICES = "0"

    # 【关键修改】改回 api.py 并把模型参数全带上！
    $apiArgs = @(
        "api.py",
        "-dr", $REF_AUDIO,
        "-dt", "我輩の名前は村雨。村雨丸の管理者。",  # 这里的预设不重要，因为我们 server.js 会发真正的文本覆盖它
        "-dl", "ja",
        "-a", "127.0.0.1",
        "-p", "9880",
        "-g", $GPT_MODEL,
        "-s", $SOVITS_MODEL
    )

    Write-Host "  Command: $GPT_PY" -ForegroundColor Gray
    Write-Host "  WorkingDir: $GPT_DIR" -ForegroundColor Gray
    
    # 【小修改】我去掉了重定向日志的代码，这样黑框就能正常显示滚动的加载日志了，不会再是全黑的
    Start-Process -FilePath $GPT_PY -ArgumentList $apiArgs -WorkingDirectory $GPT_DIR -WindowStyle Normal

# === 覆盖到这里结束，下面保留你原来的等待 60s 代码 ===
    # Wait up to 60s for port to start listening
    $waited = 0
    while ($waited -lt 60) {
        Start-Sleep -Seconds 5
        $waited += 5
        Write-Host "  ... ($waited s)" -ForegroundColor Gray

        try {
            $tcpClient = New-Object System.Net.Sockets.TcpClient
            $tcpClient.Connect("127.0.0.1", 9880)
            $tcpClient.Close()
            Write-Host "[OK] GPT-SoVITS listening on port 9880 after $waited seconds" -ForegroundColor Green
            $port_ready = $true
            break
        } catch {
            # Not ready yet
        }
    }

    if (-not $port_ready) {
        Write-Host "[WARN] GPT-SoVITS not listening after 60s" -ForegroundColor Yellow
        Write-Host "[INFO] Server may still be starting - continuing anyway..." -ForegroundColor Yellow
    }
}


# === 3/4 Ollama ===
Write-Host ""
Write-Host "[3/4] Ollama..." -ForegroundColor Cyan

$OLLAMA_PORT = 11434
$OLLAMA_MODEL = "qwen2.5:latest"
$OLLAMA_SEARCH_PATHS = @(
    "E:\ollma\ollama.exe",
    "C:\Users\muxier\AppData\Local\Programs\Ollama\ollama.exe",
    "C:\Program Files\Ollama\ollama.exe",
    "D:\ollama\ollama.exe"
)

$ollama_ready = $false
try {
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    $tcpClient.Connect("127.0.0.1", $OLLAMA_PORT)
    $tcpClient.Close()
    $ollama_ready = $true
    Write-Host "  [OK] Ollama already listening on port $OLLAMA_PORT" -ForegroundColor Green
} catch {}

if (-not $ollama_ready) {
    $ollama_exe = $null
    foreach ($p in $OLLAMA_SEARCH_PATHS) {
        if (Test-Path $p) { $ollama_exe = $p; break }
    }
    if (-not $ollama_exe) {
        $ollama_exe = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    }

    if (-not $ollama_exe) {
        Write-Host "  [WARN] Ollama not found, Ollama mode will fail" -ForegroundColor Yellow
    } else {
        Write-Host "  [START] Launching Ollama: $ollama_exe" -ForegroundColor Cyan
        Start-Process -FilePath $ollama_exe -ArgumentList "serve" -WindowStyle Hidden
        $waited = 0
        while ($waited -lt 60) {
            Start-Sleep -Seconds 5
            $waited += 5
            try {
                $tcpClient = New-Object System.Net.Sockets.TcpClient
                $tcpClient.Connect("127.0.0.1", $OLLAMA_PORT)
                $tcpClient.Close()
                Write-Host "  [OK] Ollama ready on port $OLLAMA_PORT after $waited s" -ForegroundColor Green
                $ollama_ready = $true
                break
            } catch {}
        }
        if (-not $ollama_ready) {
            Write-Host "  [WARN] Ollama not ready after $waited s" -ForegroundColor Yellow
        }
    }
}

# Launch Electron

Write-Host ""
Write-Host "[START] Launching Murasame..." -ForegroundColor Cyan
if (Test-Path $EXE) {
    Start-Process $EXE
    Write-Host "[OK] Murasame Live2D started!" -ForegroundColor Green
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Done! Enjoy Murasame!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
} else {
    Write-Host "[ERROR] EXE not found: $EXE" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Start-Sleep -Seconds 2
