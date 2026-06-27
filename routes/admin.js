/**
 * 管理 API 路由
 * - 健康检查、配置热重载
 * - Bug 报告系统
 * - 内存管理、音频 GC
 * - 文件上传
 */
'use strict';

const fs = require('fs');
const path = require('path');

function createAdminRoutes(tts, config, state, { log, logger, utils, appRoot, dataDir, audioDir }) {
  const { HTTP_STATUS, sendJSON, sendError, collectBody, ensureDir, safeJSON } = utils;

  const BUG_REPORTS_DIR = path.join(dataDir || appRoot, 'bug_reports');

  // ==================== Bug 报告系统 ====================
  function generateBugReport(error, context = '') {
    try {
      ensureDir(BUG_REPORTS_DIR);
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const mem = process.memoryUsage();
      const filename = `bug_${ts}_${Date.now()}.json`;
      const filepath = path.join(BUG_REPORTS_DIR, filename);

      const recent = logger.recentLogs.slice(-50).map(l =>
        `${l.icon} [${l.ts}] [${l.level}] ${l.msg}${l.formatted ? ' ' + l.formatted : ''}`
      );

      const report = {
        timestamp: new Date().toISOString(),
        context: context || 'unknown',
        error: {
          message: error?.message || String(error),
          stack: error?.stack || null,
          code: error?.code || null
        },
        server: {
          uptime_ms: Date.now() - state.startTime,
          request_count: state.requestCount,
          tts_ready: state.ttsReady,
          tts_generation_count: state.ttsGenerationCount,
          tts_queue_length: state.ttsQueue.length,
          last_error: state.lastError
        },
        memory: {
          rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
          heap_total: Math.round(mem.heapTotal / 1024 / 1024) + 'MB',
          heap_used: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
          external: Math.round(mem.external / 1024 / 1024) + 'MB',
          array_buffers: Math.round((mem.arrayBuffers || 0) / 1024 / 1024) + 'MB'
        },
        config: {
          tts_mode: config.tts.mode,
          tts_ref_audio: config.tts.ref_audio_path,
          gpt_sovits: `${config.gpt_sovits.hostname}:${config.gpt_sovits.port}`,
          gpu_cache_enabled: config.gpu_cache?.enabled
        },
        recent_logs: recent
      };

      fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf-8');

      // 自动清理旧报告
      try {
        const files = fs.readdirSync(BUG_REPORTS_DIR)
          .filter(f => f.startsWith('bug_') && f.endsWith('.json'))
          .map(f => ({ name: f, path: path.join(BUG_REPORTS_DIR, f), mtime: fs.statSync(path.join(BUG_REPORTS_DIR, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        for (let i = 50; i < files.length; i++) {
          try { fs.unlinkSync(files[i].path); } catch {}
        }
      } catch {}

      log('INFO', `🐛 Bug report saved: ${filename}`);
      return filename;
    } catch (e) {
      log('ERROR', 'Failed to generate bug report:', e.message);
      return null;
    }
  }

  // ==================== 内存管理 ====================
  function cleanMemory() {
    let freed = 0;
    while (state.ttsQueue.length > 10) {
      const dropped = state.ttsQueue.shift();
      if (dropped?.reject) dropped.reject(new Error('Queue overflow'));
      freed++;
    }
    if (freed) log('INFO', `🧹 Cleaned ${freed} stale TTS queue items`);

    const now = Date.now();
    let rateFreed = 0;
    for (const [ip, r] of state.rateLimits) {
      if (now > r.resetAt + 60000) { state.rateLimits.delete(ip); rateFreed++; }
    }
    if (rateFreed) log('DEBUG', `🧹 Cleaned ${rateFreed} stale rate limit entries`);

    if (global.gc) {
      global.gc();
      const after = process.memoryUsage();
      log('INFO', '🧹 V8 GC completed');
    }

    return { queue_freed: freed, rate_freed: rateFreed };
  }

  // ==================== 音频 GC ====================
  function gcAudio() {
    if (!fs.existsSync(audioDir)) return;
    const now = Date.now();
    const files = fs.readdirSync(audioDir)
      .filter(f => f.startsWith('tts_'))
      .map(f => ({ n: f, p: path.join(audioDir, f), t: fs.statSync(path.join(audioDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    let del = 0;
    const maxFiles = config.audio?.max_files || 50;
    const maxAge = config.audio?.max_age_ms || 3600000;
    for (let i = 0; i < files.length; i++) {
      if (i >= maxFiles || now - files[i].t > maxAge) {
        try { fs.unlinkSync(files[i].p); del++; } catch {}
      }
    }
    if (del) log('DEBUG', `GC ${del} audio files`);
  }

  // ==================== 路由注册 ====================
  function register(handlers) {

    // GET /api/health
    handlers['GET /api/health'] = async (req, res) => {
      const gpu = await tts.getGPUInfo();
      sendJSON(res, {
        status: state.shuttingDown ? 'stopping' : 'ok',
        uptime_ms: Date.now() - state.startTime,
        tts: { mode: config.tts.mode, ready: state.ttsReady, generation_count: state.ttsGenerationCount },
        tts_breaker: {
          tripped: !!state.ttsBreakerTripped,
          crashes_in_window: state.ttsCrashHistory?.length || 0,
          crashes_total: state.ttsCrashesTotal || 0,
          reset_in_ms: state.ttsBreakerResetAt ? Math.max(0, state.ttsBreakerResetAt - Date.now()) : 0
        },
        gpt_sovits: config.gpt_sovits,
        gpu_cache: {
          enabled: config.gpu_cache?.enabled || false,
          generation_count: state.ttsGenerationCount,
          max_generations: config.gpu_cache?.max_generations || 8,
          last_gc_ms_ago: state.lastGpuGcTime ? Date.now() - state.lastGpuGcTime : -1
        },
        ollama: { ready: state.ollamaReady, model: config.ollama.model, cuda: config.ollama.cuda_enabled },
        gpu,
        requests: state.requestCount,
        version: '3.4'
      });
    };

    // GET /api/chat-mode
    handlers['GET /api/chat-mode'] = (req, res) => sendJSON(res, { mode: 'qclaw' });

    // POST /api/chat-mode
    handlers['POST /api/chat-mode'] = (req, res) => collectBody(req, body => {
      try {
        const { mode } = JSON.parse(body);
        sendJSON(res, { success: true, mode: mode || 'qclaw' });
      } catch (e) { sendError(res, HTTP_STATUS.BAD_REQUEST, e.message); }
    });

    // GET /api/config-reload
    handlers['GET /api/config-reload'] = (req, res) => {
      try {
        const { loadConfig } = require('../lib/config');
        Object.assign(config, loadConfig());
        log('INFO', 'Config reloaded from disk');
        sendJSON(res, { success: true });
      } catch (e) {
        log('ERROR', 'Config reload failed', e);
        sendError(res, HTTP_STATUS.SERVER_ERROR, 'config reload failed');
      }
    };

    // POST /api/upload-file, /api/upload-audio
    handlers['POST /api/upload-file'] = handleUpload;
    handlers['POST /api/upload-audio'] = handleUpload;

    function handleUpload(req, res) {
      const chunks = [];
      let size = 0;
      const MAX = 50 * 1024 * 1024;
      req.on('data', c => {
        size += c.length;
        if (size > MAX) { req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const ct = req.headers['content-type'] || '';
          const extMap = {
            'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
            'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
            'text/plain': 'txt', 'application/pdf': 'pdf',
            'application/zip': 'zip', 'application/x-rar-compressed': 'rar'
          };
          const ext = extMap[ct] || 'bin';
          const uploadDir = path.join(dataDir || appRoot, 'uploads');
          ensureDir(uploadDir);
          const filename = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const filepath = path.join(uploadDir, filename);
          fs.writeFileSync(filepath, Buffer.concat(chunks));
          log('INFO', `File uploaded: ${filepath} (${size}B)`);
          sendJSON(res, { success: true, path: filepath, filename, url: `/uploads/${filename}`, size });
        } catch (e) {
          log('ERROR', 'upload failed:', e.message);
          sendError(res, HTTP_STATUS.SERVER_ERROR, 'upload failed');
        }
      });
    }

    // GET /api/bug-reports
    handlers['GET /api/bug-reports'] = (req, res) => {
      try {
        if (!fs.existsSync(BUG_REPORTS_DIR)) {
          return sendJSON(res, { reports: [], count: 0 });
        }
        const files = fs.readdirSync(BUG_REPORTS_DIR)
          .filter(f => f.startsWith('bug_') && f.endsWith('.json'))
          .map(f => {
            const fp = path.join(BUG_REPORTS_DIR, f);
            const stat = fs.statSync(fp);
            try {
              const content = JSON.parse(fs.readFileSync(fp, 'utf-8'));
              return {
                filename: f, timestamp: content.timestamp, context: content.context,
                error_message: content.error?.message, error_code: content.error?.code,
                size: stat.size, mtime: stat.mtimeMs
              };
            } catch {
              return { filename: f, size: stat.size, mtime: stat.mtimeMs };
            }
          })
          .sort((a, b) => b.mtime - a.mtime);
        sendJSON(res, { reports: files, count: files.length });
      } catch (e) {
        log('ERROR', 'Bug reports list error:', e.message);
        sendError(res, HTTP_STATUS.SERVER_ERROR, e.message);
      }
    };

    // GET /api/bug-report?file=xxx
    handlers['GET /api/bug-report'] = (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const file = url.searchParams.get('file');
        if (!file || file.includes('..')) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid file');
        const fp = path.join(BUG_REPORTS_DIR, path.basename(file));
        if (!fs.existsSync(fp)) return sendError(res, HTTP_STATUS.NOT_FOUND, 'not found');
        const content = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        sendJSON(res, content);
      } catch (e) {
        log('ERROR', 'Bug report read error:', e.message);
        sendError(res, HTTP_STATUS.SERVER_ERROR, e.message);
      }
    };

    // POST /api/clean-memory
    handlers['POST /api/clean-memory'] = (req, res) => {
      const result = cleanMemory();
      sendJSON(res, { success: true, ...result });
    };

    // POST /api/tts-reset-breaker — 手动重置熔断器
    handlers['POST /api/tts-reset-breaker'] = (req, res) => {
      tts.resetBreaker();
      sendJSON(res, { success: true, message: 'TTS circuit breaker reset' });
    };

    // ===== 表情控制 API =====

    // POST /api/expression — 设置表情
    // body: { emotion: 'happy'|'sad'|'angry'|'surprise'|'playful'|'sleepy'|'shy'|'neutral' }
    // 或:   { expression: 'exp1.exp3' }  (兼容旧格式)
    // 或:   { text: '...' }  (自动检测情绪)
    handlers['POST /api/expression'] = (req, res) => {
      collectBody(req, body => {
        try {
          const data = JSON.parse(body);
          let emotion = data.emotion;
          // 兼容旧格式
          if (!emotion && data.expression) {
            const map = { 'exp1.exp3':'happy','exp2.exp3':'sad','exp3.exp3':'angry','exp4.exp3':'surprise','exp5.exp3':'playful','exp6.exp3':'sleepy','exp7.exp3':'shy' };
            emotion = map[data.expression] || 'neutral';
          }
          // 文本情绪检测
          if (!emotion && data.text) {
            state.pendingExpressionText = data.text;
            return sendJSON(res, { success: true, mode: 'text', text: data.text });
          }
          if (!emotion) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'missing emotion or expression or text');
          state.pendingExpression = emotion;
          log('INFO', 'Expression API: ' + emotion);
          sendJSON(res, { success: true, emotion });
        } catch (e) {
          sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid json');
        }
      });
    };

    // GET /api/expression — 获取待执行的表情命令（前端轮询用）
    handlers['GET /api/expression'] = (req, res) => {
      const result = {
        emotion: state.pendingExpression || null,
        text: state.pendingExpressionText || null
      };
      // 读取后清除
      state.pendingExpression = null;
      state.pendingExpressionText = null;
      sendJSON(res, result);
    };

    // GET /api/expression/current — 获取当前表情状态
    handlers['GET /api/expression/current'] = (req, res) => {
      sendJSON(res, { emotion: state.currentExpression || 'neutral' });
    };
  }

  return { register, generateBugReport, gcAudio, cleanMemory };
}

module.exports = { createAdminRoutes };
