# 丛雨Live2D 桌面应用打包说明

## 当前状态

项目文件已准备好，但Electron打包需要下载二进制文件（~108MB），由于网络原因导致下载缓慢。

## 快速打包方案（推荐）

### 方法一：使用国内镜像加速打包

1. **设置npm镜像**
```powershell
npm config set electron_mirror https://npmmirror.com/mirrors/electron/
npm config set electron_builder_binaries_mirror https://npmmirror.com/mirrors/electron-builder-binaries/
```

2. **重新打包**
```powershell
cd E:\openclaw\live2d-front
npm run build:portable
```

### 方法二：手动打包（离线）

1. **先在其他有网络的环境下载Electron**
```powershell
# 使用代理或VPN连接后执行
cd E:\openclaw\live2d-front
npm run build:portable
```

2. **或者使用淘宝镜像**
```powershell
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run build:portable
```

### 方法三：使用VSCode等工具的Electron扩展

1. 安装 VSCode Electron 扩展
2. 使用扩展自带的打包功能

## 预计输出

打包成功后会生成以下文件：
- `dist/丛雨Live2D.exe` - 便携版主程序
- `dist/丛雨Live2D-win32-x64/` - 完整应用目录

## 临时替代方案

如果急需一个可运行版本，可以：

1. **直接运行源码版**
```powershell
cd E:\openclaw\live2d-front
node server.js
```
然后浏览器访问 http://localhost:8888/

2. **使用浏览器创建桌面快捷方式**
- 打开Chrome
- 访问 http://localhost:8888/
- 点击菜单 → 更多工具 → 创建快捷方式
- 勾选"在窗口中打开"

## 技术支持

如果打包遇到问题，请提供：
1. 错误信息截图
2. npm 版本：`npm -v`
3. Node 版本：`node -v`

## 项目文件清单

```
E:\openclaw\live2d-front\
├── package.json          # 项目配置
├── electron/
│   ├── main.js          # Electron主进程
│   └── preload.js        # 预加载脚本
├── electron-builder.yml  # 打包配置
├── build.bat            # 打包脚本
├── SKILL.md             # 完整技能文档
├── BUILD.md             # 构建说明
└── murasame_icon.ico    # 应用图标
```
