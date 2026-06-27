/**
 * 丛雨 Live2D Electron 主进程 v2.2
 *
 * v2.2 优化:
 * - 修复 serverProcess 未声明 (隐式全局)
 * - 删除死代码 (GPT-SoVITS/Ollama 启动由 start.py 负责)
 * - 统一使用 app.getAppPath() 替代 __dirname (asar 兼容)
 * - 修复 updateLoading XSS 注入 (textContent 替代 innerHTML)
 * - 统一图标路径常量
 */

const { app, BrowserWindow, Menu, Tray, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ==================== 全局状态 ====================

let mainWindow = null;
let serverProcess = null;  // FIX: 显式声明，之前是隐式全局变量
let tray = null;

const CONFIG = {
  port: 8888,
  gateway: 'http://127.0.0.1:28789',
  tts: 'http://127.0.0.1:9880'
};

// 统一图标路径 (FIX: 用 app.getAppPath() 兼容 asar 打包)
const ICONS = {
  get ico()  { return path.join(app.getAppPath(), 'murasame_icon.ico'); },
  get png()  { return path.join(app.getAppPath(), 'murasame_icon.png'); }
};

// ==================== 工具函数 ====================

function waitForPort(port, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      const req = http.get(`http://127.0.0.1:${port}/`, { timeout: 2000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => setTimeout(check, 2000));
      req.on('timeout', () => { req.destroy(); setTimeout(check, 2000); });
    };
    check();
  });
}

// ==================== 内嵌服务器 ====================

function createServer() {
  const serverPath = path.join(app.getAppPath(), 'server.js');
  if (!fs.existsSync(serverPath)) {
    console.error('[Server] server.js not found:', serverPath);
    return;
  }
  const { fork } = require('child_process');
  try {
    serverProcess = fork(serverPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: { ...process.env, ELECTRON_MODE: '1' }
    });
    serverProcess.stdout.on('data', d => console.log('[Server]', d.toString().trim()));
    serverProcess.stderr.on('data', d => console.error('[Server]', d.toString().trim()));
    serverProcess.on('exit', (code, sig) => {
      console.log('[Server] exited:', code, sig);
      serverProcess = null;
    });
  } catch (err) {
    console.error('[Server] fork failed:', err.message);
  }
}

// ==================== 加载页面 ====================

const LOADING_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1a1025;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:"Microsoft YaHei",sans-serif;color:#fff;overflow:hidden}
.container{text-align:center}
h1{font-size:28px;margin-bottom:8px;color:#e8b4f8}
.subtitle{color:#a080c0;font-size:14px;margin-bottom:40px}
.status{font-size:16px;color:#c0a0e0;margin-bottom:20px;min-height:24px;transition:opacity 0.3s}
.bar-bg{width:320px;height:6px;background:#2a1a3a;border-radius:3px;overflow:hidden;margin:0 auto}
.bar-fill{width:0%;height:100%;background:linear-gradient(90deg,#e8b4f8,#a080f0);border-radius:3px;transition:width 0.5s ease}
.hint{color:#705080;font-size:12px;margin-top:30px}
</style></head><body>
<div class="container">
<h1>&#x1F338; 丛雨 Live2D</h1>
<div class="subtitle">v2.2 · GPT-SoVITS 语音集成</div>
<div class="status" id="status">正在启动...</div>
<div class="bar-bg"><div class="bar-fill" id="bar"></div></div>
<div class="hint">首次启动语音引擎需要 30-60 秒加载模型</div>
</div>
<script>
window.electronAPI = { getConfig:()=>({}), getVersion:()=>('2.2'), platform:'win32', isElectron:true };
</script>
</body></html>`;

// FIX: 使用 JSON.stringify 转义 msg，防止 XSS 注入
function updateLoading(msg, pct) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const safeMsg = JSON.stringify(String(msg));
  mainWindow.webContents.executeJavaScript(`
    var s = document.getElementById('status');
    var b = document.getElementById('bar');
    if (s) s.textContent = ${safeMsg};
    if (b) b.style.width = '${pct || 0}%';
  `).catch(() => {});
}

// ==================== 窗口 ====================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 900,
    minWidth: 600,
    minHeight: 700,
    icon: ICONS.ico,  // FIX: 统一使用常量
    title: '丛雨 Live2D',
    transparent: true,
    backgroundColor: '#00000001',  // 近乎透明但帮助 GPU 合成
    show: false,
    frame: false,
    resizable: true,
    hasShadow: false,
    alwaysOnTop: false,  // 用户要求不锁死前台
    skipTaskbar: false,  // 显示在任务栏
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      preload: path.join(app.getAppPath(), 'electron', 'preload.js')  // app.getAppPath
    }
  });

  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML));
  mainWindow.show();

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  createMenu();
}

function switchToApp() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.loadURL('http://localhost:' + CONFIG.port + '/');
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });
}

function createMenu() {
  const template = [
    { label: '文件', submenu: [
      { label: '刷新', accelerator: 'F5', click: () => mainWindow && mainWindow.reload() },
      { label: '开发者工具', accelerator: 'F12', click: () => mainWindow && mainWindow.webContents.toggleDevTools() },
      { type: 'separator' },
      { label: '退出', accelerator: 'Alt+F4', click: () => app.quit() }
    ]},
    { label: '视图', submenu: [
      { role: 'reload', label: '重新加载' },
      { role: 'forceReload', label: '强制重新加载' },
      { type: 'separator' },
      { role: 'resetZoom', label: '重置缩放' },
      { role: 'zoomIn', label: '放大' },
      { role: 'zoomOut', label: '缩小' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: '全屏' }
    ]},
    { label: '帮助', submenu: [
      { label: '关于丛雨', click: () => {
        dialog.showMessageBox(mainWindow, {
          type: 'info', title: '关于丛雨 Live2D',
          message: '丛雨 Live2D 桌面应用',
          detail: '版本: 2.2\nGPT-SoVITS 语音集成\n\n© 2026 Murasame Project',
          icon: ICONS.png  // FIX: 统一使用常量
        });
      }}
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  if (!fs.existsSync(ICONS.ico)) return;
  tray = new Tray(ICONS.ico);  // FIX: 统一使用常量
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: '重启应用', click: () => { app.relaunch(); app.exit(0); } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
  tray.setToolTip('丛雨 Live2D');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.focus();
      else mainWindow.show();
    }
  });
}

// ==================== 启动流程 ====================

app.whenReady().then(async () => {
  createWindow();
  createTray();
  updateLoading('正在初始化...', 10);

  // 启动内嵌服务器 (GPT-SoVITS / Ollama 由 start.py 提前启动)
  updateLoading('正在启动服务器...', 20);
  createServer();

  const serverReady = await waitForPort(CONFIG.port, 15000);
  if (!serverReady) {
    updateLoading('服务器启动失败', 100);
    dialog.showErrorBox('启动失败',
      '无法启动内嵌服务器，端口 ' + CONFIG.port + ' 可能被占用。\n' +
      '请确保 start.py 已运行。');
    app.quit();
    return;
  }
  updateLoading('服务器就绪', 70);

  await new Promise(r => setTimeout(r, 500));
  updateLoading('加载丛雨...', 90);
  switchToApp();
});

// ==================== 生命周期 ====================

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  // 清理所有子进程
  [serverProcess].forEach(p => {
    if (p && !p.killed) { try { p.kill(); } catch (e) {} }
  });
  if (tray) tray.destroy();
});

process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error);
});

// ==================== IPC ====================

ipcMain.handle('get-config', () => CONFIG);
ipcMain.handle('close-window', () => { if (mainWindow) mainWindow.close(); });
ipcMain.handle('minimize-window', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('get-version', () => '2.2');
ipcMain.handle('start-drag-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.startDragging();
  }
});
ipcMain.handle('set-window-position', (event, x, y) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setPosition(x, y);
  }
});
ipcMain.handle('get-window-position', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.getPosition();
  }
  return [0, 0];
});
