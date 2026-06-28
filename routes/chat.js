/**
 * 对话代理 API 路由
 * - Gateway 聊天代理
 * - Ollama 聊天代理
 * - Ollama 模型列表
 */
'use strict';

const http = require('http');

const PROXY_HOST = process.env.HTTP_PROXY_HOST || '127.0.0.1';
const PROXY_PORT = parseInt(process.env.HTTP_PROXY_PORT || '7897', 10);

function createChatRoutes(ai, config, state, { log, utils }) {
  const { HTTP_STATUS, sendJSON, sendError, collectBody, httpReq } = utils;

  // 通过代理发送 HTTPS 请求
  function proxyHttpReq(targetUrl, options, body) {
    return new Promise((resolve, reject) => {
      const u = new URL(targetUrl);
      const reqPath = `${u.protocol}//${u.host}${options.path || ''}`;
      const req = http.request({
        hostname: PROXY_HOST,
        port: PROXY_PORT,
        method: options.method || 'GET',
        path: reqPath,
        headers: { ...options.headers, host: u.host },
        timeout: options.timeout || 30000
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      if (body) req.write(body);
      req.end();
    });
  }

  const CLOUD_PRESETS = {
    openai: { base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    deepseek: { base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    zhipu: { base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    moonshot: { base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    siliconflow: { base_url: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
    custom: { base_url: '', model: '' }
  };

  function normalizeBaseUrl(value) {
    let base = String(value || '').trim();
    if (!base) return '';
    if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
    return base.replace(/\/+$/, '');
  }

  function publicCloudConfig() {
    const cfg = config.cloud_api || {};
    const provider = cfg.provider || 'openai';
    const preset = CLOUD_PRESETS[provider] || CLOUD_PRESETS.openai;
    return {
      enabled: !!cfg.enabled,
      provider,
      base_url: preset.base_url || cfg.base_url,
      model: cfg.model || preset.model,
      has_key: !!cfg.api_key
    };
  }

  function applyCloudConfigUpdate(data) {
    const d = data || {};
    if (!config.cloud_api) config.cloud_api = {};
    const provider = String(d.provider || config.cloud_api.provider || 'openai').trim();
    const preset = CLOUD_PRESETS[provider] || CLOUD_PRESETS.custom;

    config.cloud_api.provider = provider;
    config.cloud_api.base_url = normalizeBaseUrl(preset.base_url || d.base_url || config.cloud_api.base_url);
    config.cloud_api.model = String(d.model !== undefined ? d.model : (config.cloud_api.model || preset.model)).trim();

    if (d.clear_key === true) {
      config.cloud_api.api_key = '';
    } else if (typeof d.api_key === 'string' && d.api_key.trim()) {
      config.cloud_api.api_key = d.api_key.trim();
    }

    if (d.enabled !== undefined) {
      config.cloud_api.enabled = !!d.enabled;
    } else if (config.cloud_api.api_key) {
      config.cloud_api.enabled = true;
    }
  }

  async function testCloudConfig(data = {}) {
    const provider = String(data.provider || config.cloud_api?.provider || 'openai').trim();
    const preset = CLOUD_PRESETS[provider] || CLOUD_PRESETS.custom;
    const baseUrl = normalizeBaseUrl(data.base_url || config.cloud_api?.base_url || preset.base_url);
    const model = String(data.model || config.cloud_api?.model || preset.model || '').trim();
    const apiKey = String(data.api_key || config.cloud_api?.api_key || '').trim();

    if (!baseUrl) return { success: false, error: 'API 基础地址为空' };
    if (!model) return { success: false, error: '模型名称为空' };
    if (!apiKey) return { success: false, error: 'API Key 未配置' };

    try {
      const u = new URL(baseUrl);
      const basePath = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '';
      const body = JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
        max_tokens: 8,
        temperature: 0
      });
      const start = Date.now();
      const resp = await proxyHttpReq(baseUrl, {
        method: 'POST',
        timeout: 20000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Authorization': `Bearer ${apiKey}`
        },
        path: `${basePath}/chat/completions`
      }, body);
      const text = resp.body.toString('utf8');
      if (resp.status >= 200 && resp.status < 300) {
        return { success: true, latency_ms: Date.now() - start, provider, base_url: baseUrl, model };
      }
      let message = `HTTP ${resp.status}`;
      try {
        const err = JSON.parse(text);
        message = err.error?.message || err.message || message;
      } catch {}
      return { success: false, status: resp.status, error: message };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function register(handlers) {

    // POST /api/gateway/v1/chat/completions — 代理到 OpenClaw Gateway
    handlers['POST /api/gateway/v1/chat/completions'] = (req, res) =>
      collectBody(req, body => ai.proxyToGateway(req, res, body));

    // POST /api/ollama/v1/chat/completions — 代理到本地 Ollama
    handlers['POST /api/ollama/v1/chat/completions'] = (req, res) =>
      collectBody(req, body => ai.proxyToOllama(req, res, body));

    // GET /api/ollama/models — Ollama 模型列表
    handlers['GET /api/ollama/models'] = (req, res) => ai.getOllamaModels(req, res);

    // ==================== Cloud API (OpenAI 兼容) 代理 ====================

    // POST /api/cloud/v1/chat/completions — 代理到外部 OpenAI 兼容 API
    handlers['POST /api/cloud/v1/chat/completions'] = (req, res) =>
      collectBody(req, body => ai.proxyToCloud(req, res, body));

    // GET /api/cloud/config — 获取 Cloud API 配置 (不暴露完整 API Key)
    handlers['GET /api/cloud/config'] = (req, res) => {
      sendJSON(res, { config: publicCloudConfig() });
    };

    // POST /api/cloud/config — 保存 Cloud API 配置
    handlers['POST /api/cloud/config'] = (req, res) => collectBody(req, body => {
      try {
        const d = JSON.parse(body);
        applyCloudConfigUpdate(d);
        const { saveConfig } = require('../lib/config');
        saveConfig(config);
        log('INFO', `Cloud config saved (provider=${config.cloud_api.provider}, has_key=${!!config.cloud_api.api_key})`);
        sendJSON(res, {
          success: true,
          config: publicCloudConfig()
        });
      } catch (e) {
        log('ERROR', 'Cloud config save error:', e.message);
        sendError(res, HTTP_STATUS.BAD_REQUEST, e.message);
      }
    });

    // POST /api/cloud/test — 测试当前或临时 Cloud API 配置
    handlers['POST /api/cloud/test'] = async (req, res) => {
      const body = await collectBody(req);
      try {
        const d = body ? JSON.parse(body) : {};
        const result = await testCloudConfig(d);
        sendJSON(res, result, result.success ? HTTP_STATUS.OK : HTTP_STATUS.BAD_REQUEST);
      } catch (e) {
        sendError(res, HTTP_STATUS.BAD_REQUEST, e.message);
      }
    };

    // GET /api/cloud/config/status — 快速查看 Cloud API 状态
    handlers['GET /api/cloud/config/status'] = (req, res) => {
      const cfg = config.cloud_api || {};
      sendJSON(res, {
        enabled: cfg.enabled || false,
        provider: cfg.provider || '',
        base_url: cfg.base_url || '',
        model: cfg.model || '',
        has_key: !!cfg.api_key,
        key_preview: cfg.api_key ? cfg.api_key.substring(0, 6) + '...' + cfg.api_key.slice(-4) : null
      });
    };

    // POST /api/cloud/models — 获取供应商模型列表
    handlers['POST /api/cloud/models'] = async (req, res) => {
      const body = await collectBody(req);
      try {
        const d = body ? JSON.parse(body) : {};
        const provider = String(d.provider || config.cloud_api?.provider || 'openai').trim();
        const preset = CLOUD_PRESETS[provider] || CLOUD_PRESETS.custom;
        const baseUrl = normalizeBaseUrl(d.base_url || config.cloud_api?.base_url || preset.base_url);
        const apiKey = String(d.api_key || config.cloud_api?.api_key || '').trim();
        if (!baseUrl) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'API 基础地址为空');
        if (!apiKey) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'API Key 未配置');
        const u = new URL(baseUrl);
        const basePath = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '';
        const resp = await proxyHttpReq(baseUrl, {
          method: 'GET',
          timeout: 15000,
          headers: { 'Authorization': `Bearer ${apiKey}` },
          path: `${basePath}/models`
        });
        const text = resp.body.toString('utf8');
        if (resp.status >= 200 && resp.status < 300) {
          const data = JSON.parse(text);
          const models = (data.data || data.models || []).map(m => ({
            id: m.id || m.name || '', name: m.name || m.id || ''
          })).filter(m => m.id);
          sendJSON(res, { success: true, models, total: models.length });
        } else {
          let message = `HTTP ${resp.status}`;
          try { const err = JSON.parse(text); message = err.error?.message || message; } catch {}
          sendJSON(res, { success: false, status: resp.status, error: message });
        }
      } catch (e) {
        sendJSON(res, { success: false, error: e.message });
      }
    };
  }

  return { register };
}

module.exports = { createChatRoutes };
