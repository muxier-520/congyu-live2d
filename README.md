# 丛雨 Live2D (Murasame)

AI 聊天伴侣应用 — Live2D 虚拟形象 + 多后端 AI 对话 + GPT-SoVITS 语音合成。

## 功能

- **Live2D 虚拟形象** — Pixi.js 渲染，鼠标追踪视线，7 种表情 + 12 组动作
- **AI 多后端对话** — OpenClaw Gateway / Ollama / Cloud API (OpenAI 兼容)
- **GPT-SoVITS 语音合成** — 本地推理，自定义音色，熔断器 + fallback 机制
- **多对话管理** — 每对话独立系统提示词，支持切换/重命名/删除
- **知识库** — 倒排索引全文搜索，中文 bigram 分词
- **流式输出** — SSE 实时显示，预生成 TTS
- **GalGame 模式** — 视觉小说风格 UI

## 快速开始

### 前置依赖

- Node.js (后端运行)
- GPT-SoVITS v2 Pro (语音合成，可选)
- Ollama (本地 LLM，可选)

### 启动

```bash
# 推荐：自动管理所有服务
python start.py

# 开发模式：仅启动后端
cd launcher/resources/app_current
node server.js
# 浏览器访问 http://localhost:8888
```

### Electron 桌面版

直接运行 `丛雨Live2D.exe`，或自行打包：

```bash
cd launcher/resources/app_current
npx asar pack . ../app.asar
```

## 项目结构

```
murasame/
├── README.md
├── launcher/
│   └── resources/app_current/     # 主应用源码
│       ├── server.js              # 后端入口 (Node.js http, 无框架)
│       ├── lib/                   # 基础库 (配置/日志/工具)
│       ├── services/              # 业务逻辑 (TTS/AI/知识库/模型管理)
│       ├── routes/                # HTTP 路由 (7 个模块)
│       ├── js/                    # 前端脚本
│       ├── css/                   # 样式
│       ├── models/                # Live2D Cubism 3 模型
│       └── index.html             # 单页应用
└── model/                         # AI 语音模型权重 (不入 git)
```

## 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Node.js `http` 模块 (零 npm 运行时依赖) |
| 前端 | 原生 HTML/CSS/JS + Pixi.js 7 + Live2D Cubism Core |
| AI | OpenClaw Gateway / Ollama / OpenAI 兼容 API |
| TTS | GPT-SoVITS v2 Pro |
| 桌面 | Electron 28 (可选) |

## API

后端提供 REST API，详见 `launcher/项目大纲.md`。

核心端点：

- `POST /api/tts` — 语音合成
- `POST /api/gateway/v1/chat/completions` — AI 对话
- `GET /api/knowledge/list` — 知识库
- `GET /api/models` — 模型管理
- `GET /api/health` — 健康检查

## 许可

私有项目
