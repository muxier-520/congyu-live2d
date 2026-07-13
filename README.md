# 丛雨 Live2D

> 本地运行的桌面 AI 助手角色——**丛雨**。Live2D 角色渲染 + 长期记忆 + 多 LLM 后端 + 多 TTS 引擎。
>
> 运行在 Windows 上。丛雨的语音是用 GPT-SoVITS 训练并克隆出来的, 对话由本地大语言模型 (Ollama) 或任意兼容 OpenAI 接口的云端 API 驱动。

![status](https://img.shields.io/badge/status-active-brightgreen)
![version](https://img.shields.io/badge/version-1.0.0-blue)
![node](https://img.shields.io/badge/node-18%2B-green)
![platform](https://img.shields.io/badge/platform-windows-blue)
![license](https://img.shields.io/badge/license-MIT-blue)

<p align="center">
  <img src="docs/screenshots/main-window.png" alt="主窗口" width="720"/>
</p>

## 特性

- **Live2D 角色**: 完整的村雨模型, 物理摆锤驱动头发服饰摆动
- **多后端对话**: 本地 Ollama、OpenAI 兼容网关, 或云端 API (DeepSeek / OpenAI 等)
- **本地 TTS**: GPT-SoVITS v2pro (使用自训村雨音色)
- **云端 TTS 降级**: GPT-SoVITS 不可用时自动降级到 Edge TTS (Microsoft 云端)
- **长期记忆**: 文件存储, 自动注入到对话上下文
- **知识库**: 上传文档 + 关键词搜索
- **Agent 工具调用**: 文件 / shell / 网页搜索
- **VN 风格对话**: Galgame 风格 UI, 快捷短句、语音输入、表情同步

## 快速开始

你需要 **Windows 10/11**, 约 **5 GB 可用磁盘空间**。本地村雨音色需要 **NVIDIA 显卡**; 没有的话 TTS 会自动降级到 Edge TTS。

### 1. 克隆仓库

```powershell
git clone https://github.com/muxier-520/congyu-live2d.git
cd congyu-live2d
```

### 2. 安装依赖

```powershell
npm install
```

外部依赖 (按需):
- [Ollama](https://ollama.com/) — 本地 LLM (`winget install Ollama.Ollama` + `ollama pull qwen2.5:3b`)
- [Python 3.10+](https://www.python.org/) + [edge-tts](https://github.com/rany2/edge-tts) — TTS 降级 (`pip install edge-tts`)
- [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) — 本地高质量 TTS (可选, 需 NVIDIA 显卡)

### 3. 启动

双击 `murasame-live2d.exe`, 或者:

```powershell
npm start
```

后端监听 `http://127.0.0.1:8888`。

## 项目结构

```
congyu-live2d/
├── electron/                 Electron 主进程
├── routes/                   HTTP 路由 (9 个)
├── services/                 业务模块 (7 个)
├── lib/                      基础设施 (config/logger/utils)
├── js/                       前端 JS
├── css/                      样式表
├── models/                   Live2D + TTS 角色模型
├── index.html                主窗口 UI
├── server.js                 Node.js HTTP 服务入口
├── config.json               运行配置
├── murasame-live2d.exe       Electron 桌面端可执行文件
├── start.ps1 / stop.ps1      启动 / 停止脚本
└── 用浏览器打开.bat           一键启动 + 默认浏览器打开
```

## API 概览

主要 HTTP 路由 (端口 8888):

| Method | Path | 用途 |
|--------|------|------|
| POST | /api/agent/chat | Agent 主聊天 |
| POST | /api/tts | TTS 生成 |
| GET | /api/tts-config | 读 TTS 配置 |
| POST | /api/tts-config | 写 TTS 配置 |
| GET | /api/models | 列出 LLM 模型 |
| GET | /api/memory | 读记忆库 |
| POST | /api/memory | 写记忆 |
| POST | /api/knowledge | 知识库检索 |
| GET | /api/admin/health | 健康检查 |

## 贡献

提交 PR 前请看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)
