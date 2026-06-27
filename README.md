# 丛雨 Live2D (Congyu Live2D)

基于 Electron 的 Live2D 桌面虚拟助手，角色为「丛雨」(Murasame)，一个温柔可爱的日式女仆 AI 对话伴侣。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)

## ✨ 功能特性

### 🎭 Live2D 模型交互
- **点击触发表情**：点击丛雨身体不同部位，触发不同表情和动作
  - 头部 → 害羞表情
  - 头发 → 开心表情
  - 胸部 → 生气表情
  - 裙子 → 惊讶表情
- **滚轮缩放**：使用鼠标滚轮缩放模型大小
- **右键拖拽**：按住右键拖拽移动整个窗口位置

### 🤖 AI 对话
- 支持多种 AI 服务提供商：
  - OpenAI (GPT-4, GPT-3.5)
  - DeepSeek
  - 阿里通义千问
  - 智谱AI (GLM)
  - 月之暗面 (Kimi)
  - SiliconFlow
  - 自定义 API
- 本地 Ollama 模型支持
- 流式输出
- 对话历史记录

### 🎵 语音合成 (TTS)
- GPT-SoVITS 本地语音合成
- Edge TTS 云端降级方案
- 自动语言检测（中文/日文）
- 熔断器保护机制

### 📚 知识库
- 全文检索
- 文档管理
- 倒排索引

### 🎨 界面设计
- 暗色极简主题
- 动画效果
- 响应式布局

## 📦 安装

### 前置要求

- Node.js 16+
- npm 或 yarn
- Python 3.8+ (用于 TTS)
- Ollama (可选，用于本地 AI)

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone https://github.com/muxier-520/congyu-live2d.git
   cd congyu-live2d
   ```

2. **安装依赖**
   ```bash
   npm install
   ```

3. **启动应用**
   ```bash
   npm start
   ```

### 打包为可执行文件

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

## 🚀 快速开始

### 1. 配置 AI 服务

启动应用后，点击右上角的 ⚙️ 设置按钮：

1. 选择 **对话程序类型**（推荐使用"大模型 API Key"）
2. 选择 **API 提供商**（如 OpenAI、DeepSeek 等）
3. 填写 **API Key**
4. 点击 **"💾 保存并刷新模型"**
5. 从下拉列表中选择模型
6. 保存设置

### 2. 配置 TTS（可选）

如果需要语音合成功能：

1. 安装 GPT-SoVITS
2. 启动 GPT-SoVITS 服务（端口 9880）
3. 在设置中启用 TTS

### 3. 使用 Ollama（可选）

如果想使用本地 AI 模型：

1. 安装 Ollama：https://ollama.ai
2. 拉取模型：`ollama pull qwen2.5`
3. 在设置中选择 "Ollama 本地模型"

## 📁 项目结构

```
congyu-live2d/
├── electron/           # Electron 主进程
│   ├── main.js        # 主进程入口
│   └── preload.js     # 预加载脚本
├── js/                 # 前端 JavaScript
│   ├── app.js         # 主应用逻辑
│   ├── galgame.js     # VN 风格对话桥接
│   └── openclaw-features.js  # 模型管理功能
├── css/                # 样式文件
│   ├── style.css      # 基础样式
│   ├── galgame.css    # VN 增强样式
│   ├── enhanced.css   # 暗色极简覆盖
│   └── animations.css # 动画效果
├── lib/                # 核心库
│   ├── config.js      # 配置管理
│   ├── logger.js      # 日志系统
│   └── utils.js       # 工具函数
├── services/           # 业务服务
│   ├── ai.js          # AI 服务
│   ├── tts.js         # TTS 引擎
│   └── knowledge.js   # 知识库
├── routes/             # HTTP 路由
├── models/             # Live2D 模型资源
├── index.html          # 主页面
├── server.js           # HTTP 服务器
└── package.json        # 项目配置
```

## 🛠️ 技术栈

- **Electron** - 桌面应用框架
- **PIXI.js** - 2D 渲染引擎
- **Live2D Cubism 4** - Live2D 模型 SDK
- **Node.js** - 后端服务
- **HTML/CSS/JS** - 前端界面

## 📝 配置说明

### config.json

配置文件位于应用目录，包含：

```json
{
  "chatType": "cloud-api",
  "cloud_api": {
    "provider": "openai",
    "api_key": "your-api-key",
    "base_url": "https://api.openai.com/v1",
    "model": "gpt-4o-mini"
  },
  "tts_enabled": false,
  "modelScale": 0.25
}
```

⚠️ **注意**：请勿将 API Key 提交到公开仓库！

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 🙏 致谢

- [Live2D Inc.](https://www.live2d.com/) - Live2D SDK
- [PIXI.js](https://pixijs.com/) - 2D 渲染引擎
- [Electron](https://www.electronjs.org/) - 桌面应用框架
- [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) - 语音合成

## 📧 联系方式

- GitHub: [@muxier-520](https://github.com/muxier-520)
- Issues: https://github.com/muxier-520/congyu-live2d/issues

---

如果觉得有用，请给个 ⭐ Star 支持一下！
