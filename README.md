# 丛雨 Live2D (Murasame)

开源 AI 聊天伴侣应用 — Live2D 虚拟形象 + 多后端 AI 对话 + GPT-SoVITS 语音合成。

## ✨ 功能

- 🎭 **Live2D 虚拟形象** — Pixi.js 渲染，鼠标追踪，7 种表情 + 12 组动作
- 🤖 **AI 多后端对话** — OpenClaw Gateway / Ollama / Cloud API (DeepSeek 等)
- 🗣️ **GPT-SoVITS 语音合成** — 本地推理，熔断器保护，3 级 fallback
- 💬 **多对话管理** — 每对话独立系统提示词
- 📚 **知识库** — 倒排索引全文搜索，中文 bigram 分词
- 🎮 **GalGame 模式** — 视觉小说风格 UI
- 🔍 **网页搜索** — DuckDuckGo 集成
- 🖼️ **视觉分析** — 上传图片让 AI 描述

## 🚀 快速开始

### 环境要求

- Node.js ≥ 16
- Ollama（可选，本地 AI）
- GPT-SoVITS v2 Pro（可选，语音合成）

### 安装

```bash
git clone https://github.com/muxier-520/congyu-live2d.git
cd congyu-live2d/launcher/resources/app_current
cp config.example.json config.json
# 编辑 config.json 填入你的配置
node server.js
```

浏览器打开 http://localhost:8888

### 配置

编辑 `config.json`，关键配置：

```json
{
  "ollama": { "model": "qwen2.5:latest", "port": 11434 },
  "cloud_api": {
    "enabled": true,
    "provider": "deepseek",
    "api_key": "sk-your-key",
    "model": "deepseek-chat"
  },
  "system_prompt": "你是丛雨(Murasame)..."
}
```

详见 [项目大纲.md](launcher/项目大纲.md) 获取完整配置说明。

## 📖 文档

- [项目大纲.md](launcher/项目大纲.md) — 完整的安装、配置、API 文档
- [GPT-SoVITS-API-Guide.md](launcher/GPT-SoVITS-API-Guide.md) — GPT-SoVITS 接口文档
- [GPT-SoVITS-Bugs.md](launcher/GPT-SoVITS-Bugs.md) — 已知问题

## 🏗️ 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js `http` 模块 (零 npm 运行时依赖) |
| 前端 | 原生 HTML/CSS/JS + Pixi.js 7 + Live2D Cubism Core |
| AI | OpenClaw Gateway / Ollama / OpenAI 兼容 API |
| TTS | GPT-SoVITS v2 Pro |
| 桌面 | Electron 28 (可选) |

## 📂 项目结构

```
congyu-live2d/
├── launcher/resources/app_current/  # 主应用源码
│   ├── server.js                    # 后端入口
│   ├── lib/                         # 基础库
│   ├── services/                    # 业务逻辑 (TTS/AI/知识库)
│   ├── routes/                      # HTTP 路由 (7 个模块)
│   ├── js/                          # 前端脚本
│   ├── css/                         # 样式
│   └── models/                      # Live2D 模型
└── model/                           # 语音模型权重 (不入 git)
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request。

## 📄 许可证

私有项目，未经授权禁止商业使用。
