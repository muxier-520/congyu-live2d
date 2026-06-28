/**
 * AI 服务模块
 * - Ollama 自动启动/进程管理/健康检测
 * - Gateway 代理
 * - Ollama 代理
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

function createAI(config, state, { log, utils }) {
  const { httpReq, withRetry, checkPort, waitForPort, HTTP_STATUS, sendCORS, sendError, sendJSON, collectBody } = utils;

  // ==================== Ollama 进程管理 ====================
  // Ollama 按需启动 — 只在首次调用 API 时启动，不随服务器启动
  let ollamaStarting = false;        // 防止并发启动

  async function ensureOllamaRunning() {
    if (state.ollamaReady) return true;
    if (!config.ollama.auto_start) return false;
    if (state.shuttingDown) return false;
    if (ollamaStarting) {
      // 另一个请求正在启动中，等待完成
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (state.ollamaReady) return true;
        if (!config.ollama.auto_start) return false;
      }
      return false;
    }

    // 先检查端口是否已被占用（可能之前启动过）
    if (await checkPort(config.ollama.port)) {
      state.ollamaReady = true;
      return true;
    }

    ollamaStarting = true;
    try {
      const searchPaths = config.ollama.search_paths || [];
      for (const exePath of searchPaths) {
        if (!fs.existsSync(exePath)) continue;

        log('INFO', `Starting Ollama from: ${exePath}`);
        const proc = spawn(exePath, ['serve'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          env: {
            ...process.env,
            OLLAMA_NUM_PARALLEL: '1',
            OLLAMA_MAX_LOADED_MODELS: '1',
            OLLAMA_KEEP_ALIVE: '2m0s',
          }
        });

        proc.stdout.on('data', d => {
          const msg = d.toString().trim();
          if (msg) log('INFO', `[Ollama] ${msg}`);
        });
        proc.stderr.on('data', d => {
          const msg = d.toString().trim();
          if (msg) log('INFO', `[Ollama] ${msg}`);
        });
        proc.on('exit', (code, sig) => {
          log('WARN', `Ollama exited (code=${code} signal=${sig})`);
          state.ollamaProcess = null;
          state.ollamaReady = false;
          // 按需重启 — 下次 API 调用时自动拉起来
        });

        state.ollamaProcess = proc;

        const timeout = config.ollama.startup_timeout_ms || 60000;
        const started = await waitForPort(config.ollama.port, timeout);
        if (started) {
          log('INFO', 'Ollama ready');
          state.ollamaReady = true;
          return true;
        }
        log('WARN', `Ollama at ${exePath} failed within ${timeout}ms`);
      }

      log('WARN', 'Ollama not found — AI chat unavailable');
      return false;
    } finally {
      ollamaStarting = false;
    }
  }

  // ==================== Ollama 健康检测 ====================
  async function checkOllama() {
    if (state.shuttingDown) return false;
    try {
      const r = await httpReq({
        hostname: '127.0.0.1', port: config.ollama.port,
        path: '/api/tags', method: 'GET', timeout: 5000
      });
      if (r.status === 200) {
        const { models } = JSON.parse(r.body.toString());
        if (!state.ollamaReady) {
          state.ollamaReady = true;
          log('INFO', 'Ollama: ✅ ready');
          if (models?.length) log('INFO', 'Ollama models:', models.map(m => m.name).join(', '));
        }
        return true;
      }
    } catch {}
    if (state.ollamaReady) {
      state.ollamaReady = false;
      log('WARN', 'Ollama disconnected');
    }
    return false;
  }

  // ==================== 网络搜索 (DuckDuckGo) ====================
  async function searchWeb(query, maxResults) {
    const max = maxResults || config.search?.max_results || 5;
    try {
      const html = await httpsGet(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
      const results = [];
      const blockRe = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = blockRe.exec(html)) !== null && results.length < max) {
        results.push({
          url: m[1],
          title: m[2].replace(/<[^>]+>/g, '').trim(),
          snippet: m[3].replace(/<[^>]+>/g, '').replace(/&lt;|&gt;|&amp;|&quot;|&#39;/g, '').trim()
        });
      }
      return results;
    } catch (e) {
      log('WARN', 'Search failed:', e.message);
      return [];
    }
  }

  function httpsGet(url) {
    return new Promise((resolve, reject) => {
      https.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000
      }, res => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('timeout')); });
    });
  }

  // ==================== 图像识别 (Ollama 视觉模型) ====================
  async function visionAnalysis(imageBase64, prompt) {
    if (!config.vision?.enabled) return '(图像识别未启用)';
    const ready = await ensureOllamaRunning();
    if (!ready) return '(Ollama 未运行)';
    const model = config.vision?.model || 'llama3.2-vision:latest';
    const defaultPrompt = config.vision?.default_prompt || '请描述这张图片';
    try {
      const body = JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt || defaultPrompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
          ]
        }],
        stream: false,
        max_tokens: 2048
      });
      const r = await withRetry(() => httpReq({
        hostname: '127.0.0.1', port: config.ollama.port,
        path: '/v1/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, body, 120000), 2, 1000);
      const data = JSON.parse(r.body.toString());
      return data.choices?.[0]?.message?.content || '(无响应)';
    } catch (e) {
      log('WARN', 'Vision analysis failed:', e.message);
      return `图像分析失败: ${e.message}`;
    }
  }

  // ==================== 列出视觉模型 ====================
  async function listVisionModels() {
    const ready = await ensureOllamaRunning();
    if (!ready) return [];
    try {
      const r = await httpReq({
        hostname: '127.0.0.1', port: config.ollama.port,
        path: '/api/tags', method: 'GET', timeout: 5000
      });
      const data = JSON.parse(r.body.toString());
      return (data.models || []).filter(m => {
        const n = m.name.toLowerCase();
        return n.includes('vision') || n.includes('llava') || n.includes('minicpm') || n.includes('bakllava') || n.includes('gemma3');
      }).map(m => ({ name: m.name, size: m.size }));
    } catch { return []; }
  }

  // ==================== Gateway 健康检测 ====================
  async function checkGateway() {
    try {
      const u = new URL(config.gateway.url);
      const r = await httpReq({
        hostname: u.hostname, port: u.port, path: '/v1/models', method: 'GET', timeout: 3000,
        headers: { 'Authorization': `Bearer ${config.gateway.token}` }
      });
      if (r.status === 200) {
        if (!state.gatewayAvailable) {
          state.gatewayAvailable = true;
          log('INFO', `Gateway: ✅ ready at ${config.gateway.url}`);
        }
        return true;
      }
    } catch {}
    if (state.gatewayAvailable !== false) {
      state.gatewayAvailable = false;
      log('INFO', `Gateway: unavailable at ${config.gateway.url} — proxy skipped`);
    }
    return false;
  }

  // ==================== 通用代理 ====================
  // 代理配置（Clash/V2Ray 等，从环境变量读取）
  const PROXY_HOST = process.env.HTTP_PROXY_HOST || '127.0.0.1';
  const PROXY_PORT = parseInt(process.env.HTTP_PROXY_PORT || '7897', 10);

  function proxyRequest(req, res, targetUrl, path, body, headers = {}) {
    const http = require('http');
    const https = require('https');
    const u = new URL(targetUrl);
    const basePath = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '';
    const requestPath = `${basePath}${path.startsWith('/') ? path : '/' + path}${u.search || ''}`;
    const isHttps = u.protocol === 'https:';
    const proxyHeaders = { ...headers, host: u.host };
    if (body) proxyHeaders['Content-Length'] = Buffer.byteLength(body);

    // 通过本地代理发送请求
    const p = http.request({
      hostname: PROXY_HOST,
      port: PROXY_PORT,
      method: req.method,
      path: `${u.protocol}//${u.host}${requestPath}`,
      headers: proxyHeaders,
      timeout: 120000
    }, pr => {
      sendCORS(res);
      if (pr.headers['content-type']?.includes('text/event-stream')) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
      } else {
        Object.entries(pr.headers).forEach(([k, v]) => res.setHeader(k, v));
      }
      res.writeHead(pr.statusCode);
      pr.pipe(res).on('error', () => { try { res.end(); } catch {} });
    });
    p.on('error', (e) => {
      log('WARN', `Proxy error [${req.method} ${req.url}]: ${e.message}`);
      sendError(res, HTTP_STATUS.BAD_GATEWAY, 'proxy error');
    });
    p.on('timeout', () => {
      log('WARN', `Proxy timeout [${req.method} ${req.url}]`);
      p.destroy();
      sendError(res, HTTP_STATUS.GATEWAY_TIMEOUT, 'proxy timeout');
    });
    if (body) {
      p.end(body);
    } else {
      req.pipe(p);
    }
  }

  // ==================== Gateway 聊天代理 ====================
  function proxyToGateway(req, res, body) {
    if (!state.gatewayAvailable) {
      sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'gateway unavailable');
      return;
    }
    try {
      const d = JSON.parse(body);
      const systemOverride = d.system_prompt_override;
      const systemContent = (systemOverride && systemOverride.trim())
        ? systemOverride
        : config.system_prompt;
      const msgs = [
        { role: 'system', content: systemContent },
        ...(d.messages || []).filter(m => m.role !== 'system')
      ];
      const reqBody = JSON.stringify({ ...d, messages: msgs });
      proxyRequest(req, res, config.gateway.url, '/v1/chat/completions', reqBody, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(reqBody),
        'Authorization': `Bearer ${config.gateway.token}`
      });
    } catch {
      sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid json');
    }
  }

  // ==================== Ollama 聊天代理 ====================
  function proxyToOllama(req, res, body) {
    ensureOllamaRunning().then(ready => {
      if (!ready) {
        sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'ollama not running');
        return;
      }
      try {
        const d = JSON.parse(body);
        if (d.model === 'qwen3.5') d.model = 'qwen2.5:latest';
        if (!d.max_tokens || d.max_tokens > 4096) d.max_tokens = 2048;
        if (d.temperature > 1) d.temperature = 0.8;
        const systemOverride = d.system_prompt_override;
        const systemContent = (systemOverride && systemOverride.trim())
          ? systemOverride
          : config.system_prompt;
        const msgs = [
          { role: 'system', content: systemContent },
          ...(d.messages || []).filter(m => m.role !== 'system')
        ];
        if (msgs.length > 7) msgs.splice(1, msgs.length - 7);
        const reqBody = JSON.stringify({ ...d, messages: msgs });
        proxyRequest(req, res, `http://127.0.0.1:${config.ollama.port}`, '/v1/chat/completions', reqBody, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(reqBody)
        });
      } catch {
        sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid json');
      }
    });
  }

  // ==================== Ollama 模型列表 ====================
  async function getOllamaModels(req, res) {
    const ready = await ensureOllamaRunning();
    if (!ready) {
      sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'ollama not running');
      return;
    }
    try {
      const r = await httpReq({
        hostname: '127.0.0.1', port: config.ollama.port,
        path: '/api/tags', method: 'GET', timeout: 5000
      });
      const data = JSON.parse(r.body.toString());
      sendJSON(res, data, r.status);
    } catch {
      sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'ollama not running');
    }
  }

  // ==================== Gateway 通用代理 ====================
  function proxyToGatewayPath(req, res, urlPath, query) {
    if (!state.gatewayAvailable) {
      sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'gateway unavailable');
      return;
    }
    const qs = query ? '?' + query : '';
    proxyRequest(req, res, config.gateway.url, `${urlPath}${qs}`, null, {
      'Authorization': `Bearer ${config.gateway.token}`
    });
  }

  // ==================== Cloud API 代理 (OpenAI 兼容) ====================
  const CLOUD_PRESETS = {
    openai: { base_url: 'https://api.openai.com/v1' },
    deepseek: { base_url: 'https://api.deepseek.com/v1' },
    qwen: { base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    zhipu: { base_url: 'https://open.bigmodel.cn/api/paas/v4' },
    moonshot: { base_url: 'https://api.moonshot.cn/v1' },
    siliconflow: { base_url: 'https://api.siliconflow.cn/v1' }
  };

  function proxyToCloud(req, res, body) {
    try {
      const d = JSON.parse(body);
      const apiKey = config.cloud_api?.api_key;
      const provider = config.cloud_api?.provider || 'openai';
      // 优先使用供应商预设 URL，再使用用户配置的 URL
      const baseUrl = (CLOUD_PRESETS[provider]?.base_url || config.cloud_api?.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');

      if (!apiKey) {
        sendError(res, HTTP_STATUS.UNAUTHORIZED, 'cloud API key not configured on server');
        return;
      }

      const systemOverride = d.system_prompt_override;
      const systemContent = (systemOverride && systemOverride.trim())
        ? systemOverride
        : config.system_prompt;
      const msgs = [
        { role: 'system', content: systemContent },
        ...(d.messages || []).filter(m => m.role !== 'system')
      ];
      const reqBody = JSON.stringify({
        ...d,
        model: config.cloud_api?.model || d.model || 'gpt-4o-mini',
        messages: msgs
      });

      proxyRequest(req, res, baseUrl, '/chat/completions', reqBody, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(reqBody),
        'Authorization': `Bearer ${apiKey}`
      });
    } catch (e) {
      log('ERROR', 'Cloud proxy error:', e.message);
      sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid json');
    }
  }

  return {
    ensureOllamaRunning,
    checkOllama,
    checkGateway,
    searchWeb,
    visionAnalysis,
    listVisionModels,
    proxyToGateway,
    proxyToOllama,
    proxyToCloud,
    getOllamaModels,
    proxyToGatewayPath
  };
}

module.exports = { createAI };
