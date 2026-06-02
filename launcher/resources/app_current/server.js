/**
 * 丛雨 Live2D 后端服务器 v4.0
 *
 * v4.0 — 模块化重构:
 * - 拆分 lib/ services/ routes/ 模块
 * - 增加 Ollama 自动启动进程管理
 * - 清理冗余代码，提升可维护性
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { tmpdir } = require('os');

// ==================== 模块引入 ====================
const { APP_ROOT } = require('./lib/config');
const { loadConfig, saveConfig } = require('./lib/config');
const { log, logReq, recentLogs } = require('./lib/logger');
const utils = require('./lib/utils');
const { createTTS } = require('./services/tts');
const { createAI } = require('./services/ai');
const { createTTSRoutes } = require('./routes/tts');
const { createChatRoutes } = require('./routes/chat');
const { createAdminRoutes } = require('./routes/admin');
const { createAIExtrasRoutes } = require('./routes/ai-extras');
const { createFilesRoutes } = require('./routes/files');
const { createModelManager } = require('./services/model-manager');
const { createModelRoutes } = require('./routes/models');
const { createKnowledgeBase } = require('./services/knowledge');
const { createKnowledgeRoutes } = require('./routes/knowledge');

const {
  HTTP_STATUS, MIME_TYPES, CORS_HEADERS, sendCORS, sendJSON, sendError,
  collectBody, isPortFree, killPort, checkPort, waitForPort, ensureDir,
  createRateChecker, startRateLimitCleanup
} = utils;

// ==================== 运行时状态 ====================
const state = {
  ttsReady: false, ttsWarmupOk: false, ollamaReady: false, shuttingDown: false,
  startTime: Date.now(), requestCount: 0, lastError: null,
  gptProcess: null, ollamaProcess: null,
  rateLimits: new Map(),
  ttsLock: false, ttsQueue: [],
  ttsGenerationCount: 0, lastGpuGcTime: 0, ttsRestarting: false,
  // 熔断器状态
  ttsCrashHistory: [], ttsCrashesTotal: 0,
  ttsBreakerTripped: false, ttsBreakerTrippedAt: 0, ttsBreakerResetAt: 0,
  gatewayAvailable: null
};

let config = loadConfig();

// Audio output — asar 只读时使用 tmpdir
const AUDIO_DIR = APP_ROOT.includes('.asar')
  ? path.join(tmpdir(), 'murasame-audio')
  : path.join(APP_ROOT, 'audio');

ensureDir(AUDIO_DIR);

// ==================== 服务初始化 ====================
const tts = createTTS(config, state, { appRoot: APP_ROOT, audioDir: AUDIO_DIR, log, utils });
const ai = createAI(config, state, { log, utils });

// ==================== 路由初始化 ====================
const handlers = {};

// 注册路由
const ttsRoutes = createTTSRoutes(tts, config, state, { log, utils, audioDir: AUDIO_DIR, appRoot: APP_ROOT });
const chatRoutes = createChatRoutes(ai, config, state, { log, utils });
const adminRoutes = createAdminRoutes(tts, config, state, { log, logger: { recentLogs }, utils, appRoot: APP_ROOT, audioDir: AUDIO_DIR });
const aiExtrasRoutes = createAIExtrasRoutes(ai, config, { log, utils });
const filesRoutes = createFilesRoutes(APP_ROOT, { log, utils });

// 模型管理 API
const modelManager = createModelManager(config, state, { log, utils });
const modelRoutes = createModelRoutes(modelManager, config, state, { log, utils });

ttsRoutes.register(handlers);
chatRoutes.register(handlers);
adminRoutes.register(handlers);
aiExtrasRoutes.register(handlers);
filesRoutes.register(handlers);
modelRoutes.register(handlers);

// 知识库
const kb = createKnowledgeBase(config, state, { log, utils });
kb.init();
const knowledgeRoutes = createKnowledgeRoutes(kb, config, state, { log, utils });
knowledgeRoutes.register(handlers);

const { generateBugReport, gcAudio, cleanMemory } = adminRoutes;

// ==================== 限流 ====================
const checkRate = createRateChecker(state.rateLimits, config.security.rate_limit_per_min);
const rateCleanupTimer = startRateLimitCleanup(state.rateLimits, 60000);

// ==================== 主服务器 ====================
const server = http.createServer(async (req, res) => {
  const startTime = Date.now();

  if (state.shuttingDown) {
    res.writeHead(HTTP_STATUS.SERVICE_UNAVAILABLE);
    res.end('shutting down');
    logReq(req, HTTP_STATUS.SERVICE_UNAVAILABLE, Date.now() - startTime);
    return;
  }

  const url = req.url.split('?')[0];
  state.requestCount++;

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(HTTP_STATUS.NO_CONTENT, CORS_HEADERS);
    res.end();
    return;
  }

  // 限流（跳过 /api/tts-latest 轮询）
  if (url !== '/api/tts-latest') {
    const ip = req.connection?.remoteAddress || 'unknown';
    if (!checkRate(ip)) {
      sendError(res, HTTP_STATUS.RATE_LIMIT, 'rate limit exceeded');
      logReq(req, HTTP_STATUS.RATE_LIMIT, Date.now() - startTime);
      return;
    }
  }

  const key = `${req.method} ${url}`;
  const handler = handlers[key];
  if (handler) {
    let status = HTTP_STATUS.OK;
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = function (code, ...args) { status = code; return origWriteHead(code, ...args); };
    try {
      await handler(req, res);
    } catch (e) {
      log('ERROR', `Handler error: ${req.method} ${url}`, e);
      generateBugReport(e, `handler:${req.method}:${url}`);
      sendError(res, HTTP_STATUS.SERVER_ERROR, 'handler error');
      status = HTTP_STATUS.SERVER_ERROR;
    }
    if (!url.startsWith('/') || url === '/' || url.startsWith('/api/')) {
      logReq(req, status, Date.now() - startTime);
    }
    return;
  }

  // 特殊路由
  if (url.startsWith('/audio/') && req.method === 'GET') {
    const filename = url.replace('/audio/', '').split('?')[0];
    if (filename.includes('..')) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid');
    const fp = path.join(AUDIO_DIR, filename);
    if (!fs.existsSync(fp)) return sendError(res, HTTP_STATUS.NOT_FOUND, 'audio not found');
    const buf = fs.readFileSync(fp);
    res.writeHead(HTTP_STATUS.OK, { 'Content-Type': 'audio/wav', 'Content-Length': buf.length });
    return res.end(buf);
  }

  if (url.startsWith('/api/gateway/') && req.method === 'GET') {
    const tp = url.replace('/api/gateway', '');
    const q = req.url.includes('?') ? req.url.split('?')[1] : '';
    const u = new URL(config.gateway.url);
    return ai.proxyToGatewayPath(req, res, tp, q);
  }

  // 静态文件
  serveStatic(req, res);
});

// ==================== 静态文件服务 ====================
function serveStatic(req, res) {
  let fp = req.url.split('?')[0];
  if (fp === '/') fp = '/index.html';
  const full = path.resolve(APP_ROOT, '.' + fp);
  if (!full.startsWith(path.resolve(APP_ROOT))) {
    return sendError(res, HTTP_STATUS.FORBIDDEN, 'forbidden');
  }
  const ct = MIME_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream';
  const ext = path.extname(full).toLowerCase();
  const isWebFile = ['.html', '.js', '.css'].includes(ext);
  fs.stat(full, (err, st) => {
    if (err) return sendError(res, HTTP_STATUS.NOT_FOUND, 'not found');
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : st.size - 1;
      res.writeHead(HTTP_STATUS.PARTIAL_CONTENT, {
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': ct,
        ...(isWebFile ? { 'Cache-Control': 'no-cache, must-revalidate' } : {})
      });
      fs.createReadStream(full, { start, end }).pipe(res)
        .on('error', () => { try { res.end(); } catch {} });
    } else {
      const headers = { 'Content-Length': st.size, 'Content-Type': ct };
      if (isWebFile) headers['Cache-Control'] = 'no-cache, must-revalidate';
      res.writeHead(HTTP_STATUS.OK, headers);
      fs.createReadStream(full).pipe(res)
        .on('error', () => { try { res.end(); } catch {} });
    }
  });
}

// ==================== 优雅关闭 ====================
async function shutdown(sig) {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  log('INFO', `Shutting down (${sig})...`);
  server.close(() => log('INFO', 'Server closed'));
  if (healthTimer) clearInterval(healthTimer);
  if (rateCleanupTimer) clearInterval(rateCleanupTimer);
  [state.gptProcess, state.ollamaProcess].forEach(p => {
    if (p && !p.killed) { try { p.kill(); } catch {} }
  });
  await new Promise(r => setTimeout(r, 2000));
  log('INFO', 'Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', e => {
  log('ERROR', 'Uncaught exception', e);
  state.lastError = { message: e.message, code: e.code, time: new Date().toISOString() };
  generateBugReport(e, 'uncaughtException');
  if (['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'EADDRINUSE', 'EACCES'].includes(e.code)) {
    log('WARN', `Network error (${e.code}) — ignored`);
    return;
  }
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  log('ERROR', 'Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
  generateBugReport(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection');
});

// ==================== 端口绑定（自动重试 + 杀旧进程）====================
async function listenWithRetry() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.server.port, config.server.host, () => {
          server.removeAllListeners('error');
          log('INFO', '🌸 丛雨 Live2D v4.0');
          log('INFO', `   http://${config.server.host}:${config.server.port}/`);
          resolve();
        });
      });
      return; // 绑定成功
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        log('WARN', `Port ${config.server.port} in use — killing old process (attempt ${attempt + 1})`);
        server.removeAllListeners('error');
        await killPort(config.server.port);
        await new Promise(r => setTimeout(r, 500)); // 等待端口释放
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Failed to bind port ${config.server.port} after 2 attempts`);
}

// ==================== 启动 ====================
let healthTimer = null;

async function start() {
  // ==================== 绑定端口（先于一切服务启动）====================
  await listenWithRetry();

  // 端口确认绑定成功 — 再启动后台服务
  log('INFO', `TTS: ${config.tts.mode} | GPT-SoVITS: ${config.gpt_sovits.hostname}:${config.gpt_sovits.port}`);
  await Promise.all([
    tts.autoStartGPT().then(() => tts.checkTTS()),
    ai.checkGateway()
  ]);
  // Ollama 按需启动 — 首次调用 Ollama API 时自动拉起，不占用开机内存

  // 健康检查定时器
  healthTimer = setInterval(() => {
    tts.checkTTS();
    ai.checkOllama();
    ai.checkGateway();
  }, 10000);

  // 定时音频 GC（每 5 分钟）
  setInterval(gcAudio, 300000);
  gcAudio();

  // 定时内存管理（每 5 分钟）
  setInterval(() => {
    try { cleanMemory(); } catch (e) { log('WARN', 'Memory cleanup error:', e.message); }
  }, 300000);

  // 内存告警（每 60 秒）
  setInterval(() => {
    const mem = process.memoryUsage();
    if (mem.heapUsed > 200 * 1024 * 1024) {
      log('WARN', `📊 Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB (>200MB)`);
    }
  }, 60000);

  log('INFO', '✅ Server ready');
}

start().catch(e => {
  log('ERROR', 'Start failed:', e.message);
  process.exit(1);
});
