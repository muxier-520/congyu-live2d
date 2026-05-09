@echo off
chcp 65001 >nul 2>&1
set PYTHONIOENCODING=utf-8
cd /d "E:\gpt sovlts\GPT-SoVITS-v2pro-20250604-nvidia50"
runtime\python.exe api.py -g GPT_SoVITS/pretrained_models/s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt -s GPT_SoVITS/pretrained_models/s2G488k.pth -dr "E:\openclaw\murasame\src\models\sounds\congyu_ref.wav" -dt "我輩の名前は村雨。村雨丸の管理者。" -dl ja -a 127.0.0.1 -p 9880 -g "E:\openclaw\murasame\model\congyu-e15.ckpt" -s "E:\openclaw\murasame\model\congyu_e8_s200.pth"