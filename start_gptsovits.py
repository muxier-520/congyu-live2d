#!/usr/bin/env python3
"""Start GPT-SoVITS with correct parameters"""
import subprocess, sys, os, time

gpt_dir = r"E:\gpt sovlts\GPT-SoVITS-v2pro-20250604-nvidia50"
python_exe = os.path.join(gpt_dir, "runtime", "python.exe")
ref_audio = r"E:\openclaw\murasame\src\models\sounds\congyu_ref.wav"

cmd = [
    python_exe, "api.py",
    "-dr", ref_audio,
    "-dt", "我輩の名前は村雨。村雨丸の管理者。",
    "-dl", "ja",
    "-a", "127.0.0.1",
    "-p", "9880",
    "-g", r"E:\openclaw\murasame\model\congyu-e15.ckpt",
    "-s", r"E:\openclaw\murasame\model\congyu_e8_s200.pth",
]

env = os.environ.copy()
env["PYTHONIOENCODING"] = "utf-8"
env["PYTHONUTF8"] = "1"

print(f"Starting GPT-SoVITS from {gpt_dir}")
proc = subprocess.Popen(cmd, cwd=gpt_dir, env=env)
print(f"PID: {proc.pid}")

# Wait for it to start
for i in range(60):
    time.sleep(1)
    try:
        import urllib.request
        r = urllib.request.urlopen("http://127.0.0.1:9880/", timeout=2)
        print(f"GPT-SoVITS ready after {i+1}s")
        break
    except:
        if proc.poll() is not None:
            print(f"GPT-SoVITS exited with code {proc.returncode}")
            break
else:
    print("Timeout waiting for GPT-SoVITS")
