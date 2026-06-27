<div align="center">

# 🌸 丛雨 Live2D

### 你的专属 AI 女仆桌面伴侣

![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-28-47848F.svg?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg?style=flat-square)

*一个基于 Electron + Live2D 的智能桌面伴侣，让丛雨陪伴你的每一天*

</div>

---

## ✨ 什么是丛雨？

丛雨（Murasame）是一个运行在你桌面上的 Live2D 虚拟助手。她不仅能和你聊天，还能根据对话内容做出各种可爱的表情和动作。

**核心亮点：**
- 🎭 逼真的 Live2D 动画效果
- 🤖 支持多种 AI 大模型
- 🎙️ 语音合成说话
- 🖱️ 丰富的交互方式

---

## 🎮 交互方式

| 操作 | 效果 |
|:---:|:---|
| 🖱️ **左键点击** | 触碰丛雨，她会做出不同表情 |
| 🔄 **滚轮滚动** | 放大或缩小丛雨 |
| 🖱️ **右键拖拽** | 移动整个窗口位置 |

**点击不同部位的反应：**

```
    ┌─────────────┐
    │     头部     │  → 😊 害羞表情 + 摸头动作
    ├─────────────┤
    │     头发     │  → 😄 开心表情 + 撩发动作
    ├─────────────┤
    │     胸部     │  → 😠 生气表情 + 防御动作
    ├─────────────┤
    │     裙子     │  → 😲 惊讶表情 + 整理动作
    └─────────────┘
```

---

## 🚀 快速开始

### 方式一：直接运行（推荐）

1. **下载项目**
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

### 方式二：打包成可执行文件

```bash
# Windows 用户
npm run build:win

# macOS 用户
npm run build:mac

# Linux 用户
npm run build:linux
```

打包完成后，在 `dist` 目录中找到安装包。

---

## ⚙️ 配置 AI 服务

启动应用后，点击右上角的 **⚙️** 按钮进入设置：

### 第一步：选择对话类型

在「对话程序类型」下拉框中选择 **☁️ 大模型 API Key**

### 第二步：配置 API

```
┌─────────────────────────────────────────────┐
│  API 提供商:  [OpenAI          ▼]           │
│                                             │
│  API Key:     [sk-xxxxxxxxxxxxxxx]          │
│                                             │
│  API 地址:    [https://api.openai.com/v1]   │
│                                             │
│  [💾 保存并刷新模型]  ✅ 获取到 50 个模型    │
│                                             │
│  选择模型:    [gpt-4o-mini       ▼]         │
│                                             │
│              [  保存设置  ]                  │
└─────────────────────────────────────────────┘
```

### 支持的 AI 服务商

| 服务商 | 基础地址 | 推荐模型 |
|:---:|:---|:---:|
| OpenAI | api.openai.com | gpt-4o-mini |
| DeepSeek | api.deepseek.com | deepseek-chat |
| 通义千问 | dashscope.aliyuncs.com | qwen-plus |
| 智谱AI | open.bigmodel.cn | glm-4-flash |
| 月之暗面 | api.moonshot.cn | moonshot-v1-8k |
| SiliconFlow | api.siliconflow.cn | Qwen2.5-7B |
| Ollama | localhost:11434 | 自定义 |

---

## 🎵 语音合成（可选）

丛雨支持语音合成，可以用声音回复你。

### 支持的 TTS 引擎

| 引擎 | 特点 | 配置难度 |
|:---:|:---|:---:|
| **GPT-SoVITS** | 高质量中文/日文语音 | ⭐⭐⭐ |
| **Edge TTS** | 免费云端语音 | ⭐ |

### 快速配置 Edge TTS

1. 安装 Python 3.8+
2. 安装 edge-tts：
   ```bash
   pip install edge-tts
   ```
3. 在设置中启用 TTS

### 配置 GPT-SoVITS

1. 下载 [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)
2. 启动服务（默认端口 9880）
3. 在设置中配置参考音频

---

## 📁 项目结构

```
congyu-live2d/
│
├── 📂 electron/              # Electron 主进程
│   ├── main.js              # 应用入口
│   └── preload.js           # 安全桥接
│
├── 📂 js/                    # 前端逻辑
│   ├── app.js               # 核心应用逻辑
│   ├── galgame.js           # VN 对话系统
│   └── openclaw-features.js # AI 功能集成
│
├── 📂 css/                   # 样式文件
│   ├── style.css            # 基础样式
│   ├── galgame.css          # VN 风格样式
│   ├── enhanced.css         # 暗色主题
│   └── animations.css       # 动画效果
│
├── 📂 lib/                   # 核心库
│   ├── config.js            # 配置管理
│   ├── logger.js            # 日志系统
│   └── utils.js             # 工具函数
│
├── 📂 services/              # 后端服务
│   ├── ai.js                # AI 对话服务
│   ├── tts.js               # 语音合成
│   └── knowledge.js         # 知识库
│
├── 📂 routes/                # API 路由
│
├── 📂 models/                # Live2D 模型资源
│   ├── Murasame.model3.json # 模型配置
│   ├── Murasame.moc3        # 模型文件
│   └── ...                  # 表情、动作、音效
│
├── 📄 index.html             # 主页面
├── 📄 server.js              # HTTP 服务器
└── 📄 package.json           # 项目配置
```

---

## 🛠️ 技术栈

| 类别 | 技术 |
|:---:|:---|
| 桌面框架 | Electron |
| 渲染引擎 | PIXI.js 7.x |
| 动画系统 | Live2D Cubism 4 |
| 后端服务 | Node.js |
| 前端技术 | HTML / CSS / JavaScript |

---

## ❓ 常见问题

<details>
<summary><b>Q: 应用启动后白屏？</b></summary>

确保 Node.js 已正确安装，并且在项目目录下执行了 `npm install`。
</details>

<details>
<summary><b>Q: 无法连接 AI 服务？</b></summary>

1. 检查 API Key 是否正确
2. 确认网络可以访问对应服务商
3. 检查 API 地址是否正确
</details>

<details>
<summary><b>Q: 语音合成没有声音？</b></summary>

1. 确认已安装 Python 和对应 TTS 引擎
2. 检查 TTS 服务是否正常运行
3. 查看设置中的 TTS 状态
</details>

<details>
<summary><b>Q: 如何自定义丛雨的表情？</b></summary>

修改 `models/` 目录下的表情配置文件（`.exp3.json`），可以添加自定义表情。
</details>

---

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m 'Add some feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

---

## 📄 许可证

本项目采用 [MIT 许可证](LICENSE) 开源。

---

## 🙏 致谢

- [Live2D Inc.](https://www.live2d.com/) - Live2D SDK
- [PIXI.js](https://pixijs.com/) - 2D 渲染引擎
- [Electron](https://www.electronjs.org/) - 桌面应用框架
- [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) - 语音合成

---

<div align="center">

**如果喜欢这个项目，请给个 ⭐ Star 支持一下！**

Made with ❤️ by [muxier-520](https://github.com/muxier-520)

</div>
