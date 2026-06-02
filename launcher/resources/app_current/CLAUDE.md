# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

**丛雨 Murasame** — Desktop AI companion with Live2D avatar, GPT-SoVITS voice, and multi-backend AI chat.

```
Electron Shell → BrowserWindow (localhost:8888) → Node.js server.js (fork子进程)
                                                    ├── routes/    (TTS, 聊天代理, 管理)
                                                    ├── services/  (TTS引擎, AI代理, Ollama进程管理)
                                                    └── lib/       (config, logger, utils)
```

### Key directories

- `launcher/resources/app_current/` — **主要开发目录**，服务端 + 前端全在此
  - `server.js` — Node.js 原生 http 后端入口，无框架
  - `index.html` — 主前端页面 (Pixi.js Live2D + Chat UI)
  - `js/app.js` — 前端主逻辑 (~7000行)
  - `electron/main.js` — Electron 主进程
  - `lib/` — 基础库 (config 加载/合并/保存, 日志环形缓冲区, HTTP 工具/端口管理/限流)
  - `services/` — 业务服务层 (tts.js: GPT-SoVITS 客户端+进程管理+GPU缓存; ai.js: Ollama/Gateway/Cloud API 代理)
  - `routes/` — HTTP 路由层 (tts.js, chat.js, admin.js, files.js, ai-extras.js, models.js)
- `launcher/resources/app.asar` — Electron 打包，从 app_current 用 asar 工具构建
- `model/` — GPT-SoVITS 语音模型权重 (congyu-e15.ckpt, congyu_e8_s200.pth, s2Dv2ProPlus.pth)

### Config system

两个 config.json（注意区分）:
1. `launcher/resources/app_current/config.json` — **运行配置**，后端实际使用
2. `E:\openclaw\murasame\config.json` — 根配置，仅含 models 数组供前端模型切换面板
后端配置加载流程: `lib/config.js` DEFAULTS deepMerge 磁盘配置 → 运行时修改 → `saveConfig()` 写回

## Development

### Run server (browser mode, no Electron)

```bash
cd launcher/resources/app_current && node server.js
# 访问 http://localhost:8888/
```

### Rebuild app.asar (for Electron)

```bash
cd launcher/resources && npx asar pack app_current app.asar
```

### Config edits

修改运行配置后可通过 `GET /api/config-reload` 热重载。前端 JS 修改需刷新浏览器（或重建 asar）。

### Dependencies

后端纯 Node.js 原生 http 模块，无外部 npm 依赖。`node_modules/` 仅用于 Electron 打包 (electron-builder, asar 等)。

### Route registration pattern

每个路由模块遵循同一模式:
```js
function createXxxRoutes(service, config, state, { log, utils }) {
  function register(handlers) {
    handlers['METHOD /path'] = (req, res) => { ... };
  }
  return { register };
}
```
在 `server.js` 中: `xxxRoutes.register(handlers);`

### Key technical details

- **TTS**: 调用 GPT-SoVITS v2pro API (`/tts`), 支持 3 次 fallback 参数尝试 (standard → zh → auto), GPU 缓存管理跟踪生成次数
- **AI 代理**: 支持 4 种模式 — Gateway (OpenClaw 网关), Ollama (本地), Cloud API (OpenAI 兼容, Key 服务端存储), Local API (自定义)
- **前端 chatType**: 5 种模式 — `openclaw`, `gateway`, `cloud-api`, `local-api`, `ollama`
- **GPT-SoVITS 源码位置**: `E:\gpt sovlts\GPT-SoVITS-v2pro-20250604-nvidia50\` (此路径已在搜索路径中配置)
