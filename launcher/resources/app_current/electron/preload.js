/**
 * Electron 预加载脚本
 * 提供安全的IPC通信桥接
 */

const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 获取配置
  getConfig: () => ipcRenderer.invoke('get-config'),
  
  // 获取版本
  getVersion: () => ipcRenderer.invoke('get-version'),
  
  // 平台信息
  platform: process.platform,
  
  // 是否是Electron环境
  isElectron: true
});

console.log('✓ Preload script loaded');
