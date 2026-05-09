# 丛雨 Live2D 桌面应用

## 快速启动

**方式一（推荐）：** 双击 `start.py`

**方式二：** 直接双击 `丛雨Live2D.exe`（需提前运行 GPT-SoVITS + Ollama）

## 目录结构

```
E:\openclaw\murasame\          ← 项目根目录
├── 丛雨Live2D.exe                # Electron 主程序
├── start.py                      # 推荐启动脚本（自动管理服务）
├── app.asar                     # 打包后的应用代码
├── README.md                    # 本文件
│
├── launcher/                    # Electron 运行时（无需修改）
│   ├── 丛雨Live2D.exe          # 应用入口
│   ├── resources/              # 资源目录
│   │   └── app.asar            # 源码包（每次打包后更新）
│   └── *.dll                  # Chromium 运行时库
│
└── src/                        # 源码（用于二次开发）
    ├── index.html              # 主页面
    ├── server.js               # Node.js 后端
    ├── config.json             # 配置文件
    ├── package.json           # Node 包配置
    ├── murasame_icon.ico/png  # 应用图标
    ├── electron/               # Electron 主进程
    │   ├── main.js            # 主进程脚本
    │   └── preload.js         # 预加载脚本
    ├── js/                    # 前端脚本
    │   ├── app.js             # 主前端逻辑
    │   ├── chat-config.js
    │   ├── galgame.js
    │   └── openclaw-features.js
    ├── css/                   # 样式
    ├── models/                # Live2D 模型
    │   ├── Murasame.model3.json
    │   ├── Murasame.moc3
    │   ├── Murasame.4096/    # 纹理图集
    │   ├── exp/               # 表情文件
    │   ├── motion/            # 动作文件
    │   └── sounds/            # 参考音频
    ├── audio/                 # TTS 输出目录
    └── node_modules/          # Node 依赖（用于 asar 打包）
```

## 二次开发

修改 `src/` 中的文件后，重新打包：

```cmd
cd E:\openclaw\murasame\src
asar pack . ..\app.asar
```

或双击 `src\重新打包.bat`

## 依赖路径

GPT-SoVITS: `E:\gpt sovlts\GPT-SoVITS-v2pro-20250604-nvidia50`
Ollama: `E:\ollma\ollama.exe`

如需修改，编辑 `start.py` 中的 `GPT_SOVITS_DIRS` 和 `start.py` 中的 `node` 路径。
