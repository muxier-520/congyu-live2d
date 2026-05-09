# -*- coding: utf-8 -*-
"""丛雨 Live2D v2.0 启动器 — 优化版"""
import subprocess, time, socket, sys, os, shutil, json

APP_DIR = os.path.dirname(os.path.abspath(__file__))

# ==================== 加载配置 ====================

def load_config():
    """从 config.json 读取 ollama 配置"""
    config_path = os.path.join(APP_DIR, "config.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

CFG = load_config()
OLLAMA_CFG = CFG.get("ollama", {})

# ==================== Ollama 配置（兼容旧版 config.json）= ====================

OLLAMA_PORT = OLLAMA_CFG.get("port", 11434)
OLLAMA_MODEL = OLLAMA_CFG.get("model", "qwen2.5:latest")
OLLAMA_CUDA = OLLAMA_CFG.get("cuda_enabled", True)
OLLAMA_FLASH = OLLAMA_CFG.get("flash_attention", True)
OLLAMA_MODELS_DIR = OLLAMA_CFG.get("models_dir", "")
OLLAMA_AUTO_START = OLLAMA_CFG.get("auto_start", True)

OLLAMA_SEARCH_PATHS = OLLAMA_CFG.get("search_paths", [
    r"E:\ollma\ollama.exe",
    r"C:\Users\muxier\AppData\Local\Programs\Ollama\ollama.exe",
    r"C:\Program Files\Ollama\ollama.exe",
    r"D:\ollama\ollama.exe",
])

# ==================== 工具函数 ====================

def port_open(port, host='127.0.0.1'):
    with socket.socket() as s:
        s.settimeout(1)
        return s.connect_ex((host, port)) == 0

def wait_port(port, timeout=120):
    for i in range(timeout):
        if port_open(port):
            return True
        time.sleep(1)
    return False

def kill_port(port):
    if not port_open(port):
        return
    try:
        out = subprocess.check_output(['netstat', '-ano'], text=True)
        for line in out.splitlines():
            if f':{port}' in line and 'LISTENING' in line:
                pid = line.split()[-1]
                subprocess.run(['taskkill', '/F', '/PID', pid],
                              capture_output=True, timeout=5)
        time.sleep(2)
    except Exception:
        pass

def find_exe(name):
    return shutil.which(name)

def start_bg(cmd, cwd=None, env=None):
    return subprocess.Popen(
        cmd, cwd=cwd, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=0x00000008 if sys.platform == 'win32' else 0
    )

# ==================== 配置 ====================

GPT_SOVITS_DIRS = [
    r"E:\gpt sovlts\GPT-SoVITS-v2pro-20250604-nvidia50",
    r"E:\gpt-sovit\GPT-SoVITS-v2pro-20250604-nvidia50",
]

REF_AUDIO = os.path.join(APP_DIR, "src", "models", "sounds", "congyu_ref.wav")
PROMPT_TEXT = "我輩の名前は村雨。村雨丸の管理者。"
PROMPT_LANG = "ja"

GPT_MODEL = os.path.join(APP_DIR, "model", "congyu-e15.ckpt")
SOVITS_MODEL = os.path.join(APP_DIR, "model", "congyu_e8_s200.pth")

SERVER_DIR = os.path.join(APP_DIR, "src")
SERVER_PORT = 8888
GPT_PORT = 9880

# ==================== 启动 ====================

def main():
    print("=" * 44)
    print("    Congyu Live2D v2.0 Launcher")
    print("=" * 44)

    # --- 预检查 ---
    if not os.path.exists(REF_AUDIO):
        print(f"[WARN] Reference audio not found: {REF_AUDIO}")

    node = find_exe("node")
    if not node:
        print("[ERROR] Node.js not found in PATH!")
        print("  Please install Node.js or add it to PATH.")
        sys.exit(1)

    # --- 1/4 Ollama ---
    print("\n[1/4] Ollama...")
    if not OLLAMA_AUTO_START:
        print("  Ollama auto_start=false, skipping")
    elif port_open(OLLAMA_PORT):
        print(f"  Port {OLLAMA_PORT} already in use [OK]")
    else:
        ollama_exe = None
        for path in OLLAMA_SEARCH_PATHS:
            if os.path.exists(path):
                ollama_exe = path
                break
        if not ollama_exe:
            # 再用 which 找一次
            ollama_exe = shutil.which("ollama")
        if not ollama_exe:
            print("  [WARN] Ollama not found, Ollama mode will fail.")
        else:
            print(f"  Starting: {ollama_exe}")
            env = os.environ.copy()
            if OLLAMA_MODELS_DIR:
                env["OLLAMA_MODELS"] = OLLAMA_MODELS_DIR
            # 启动 ollama serve（后台）
            serve_exe = os.path.join(os.path.dirname(ollama_exe), "ollama.exe")
            start_bg(
                [serve_exe, "serve"] if os.path.exists(serve_exe) else [ollama_exe, "serve"],
                cwd=os.path.dirname(ollama_exe),
                env=env,
            )
            if wait_port(OLLAMA_PORT, 60):
                print(f"  Ollama ready on port {OLLAMA_PORT} [OK]")
                # 预热模型
                print(f"  Pulling model: {OLLAMA_MODEL} ...")
                try:
                    subprocess.run(
                        [ollama_exe, "pull", OLLAMA_MODEL],
                        capture_output=True, timeout=120, env=env
                    )
                    print(f"  Model {OLLAMA_MODEL} ready [OK]")
                except subprocess.TimeoutExpired:
                    print(f"  Model pull timed out (background OK)")
                except Exception as e:
                    print(f"  Model pull warning: {e}")
            else:
                print(f"  [ERROR] Ollama failed (port {OLLAMA_PORT})")

    # --- 2/4 GPT-SoVITS ---
    print("\n[2/4] GPT-SoVITS...")
    if port_open(GPT_PORT):
        print(f"  Port {GPT_PORT} already in use [OK]")
    else:
        started = False
        for base in GPT_SOVITS_DIRS:
            python_exe = os.path.join(base, "runtime", "python.exe")
            api_py = os.path.join(base, "api.py")
            if os.path.exists(python_exe) and os.path.exists(api_py):
                print(f"  Starting from: {base}")
                start_bg([
                    python_exe, api_py,
                    "-a", "127.0.0.1", "-p", str(GPT_PORT),
                    "-dr", REF_AUDIO, "-dt", PROMPT_TEXT, "-dl", PROMPT_LANG,
                    "-g", GPT_MODEL, "-s", SOVITS_MODEL,
                ], cwd=base)
                started = True
                break
        if not started:
            print("  [WARN] GPT-SoVITS not found, TTS will be disabled.")
        elif wait_port(GPT_PORT, 120):
            print(f"  Port {GPT_PORT} ready [OK]")
        else:
            print(f"  [ERROR] GPT-SoVITS failed (port {GPT_PORT})")

    # --- 3/4 Node Server ---
    print(f"\n[3/4] Node Server (port {SERVER_PORT})...")
    kill_port(SERVER_PORT)

    server_js = os.path.join(SERVER_DIR, "server.js")
    if not os.path.exists(server_js):
        print(f"  [ERROR] server.js not found: {server_js}")
    else:
        start_bg([node, "server.js"], cwd=SERVER_DIR)
        if wait_port(SERVER_PORT, 30):
            print(f"  Port {SERVER_PORT} ready [OK]")
        else:
            print(f"  [ERROR] Server failed (port {SERVER_PORT})")

    # --- 4/4 Done ---
    print("\n" + "=" * 44)
    print("  All services ready!")
    print(f"  http://localhost:{SERVER_PORT}/")
    print("=" * 44)
    print("\nPress Enter to exit...")
    input()

if __name__ == "__main__":
    main()
