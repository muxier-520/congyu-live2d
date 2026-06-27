'use strict';

/**
 * 模型/API 提供商管理模块
 *
 * 管理 config.json 中的 models 数组：增删改查 + 连接测试 + 切换
 */
function createModelManager(config, state, { log, utils }) {
  const { httpReq, HTTP_STATUS } = utils;

  // ===== CRUD =====

  function listModels() {
    return (config.models || []).map(m => ({
      ...m,
      api_key: m.api_key ? '***' : undefined,
      token: m.token ? '***' : undefined,
      is_default: m.id === config.default_model
    }));
  }

  function getModel(id) {
    const models = config.models || [];
    const idx = models.findIndex(m => m.id === id);
    if (idx === -1) return null;
    const m = { ...models[idx] };
    if (m.api_key) m.api_key = '***';
    if (m.token) m.token = '***';
    m.is_default = m.id === config.default_model;
    return m;
  }

  function addModel(data) {
    const models = config.models || [];
    if (!data.id) return { error: 'id is required' };
    if (models.find(m => m.id === data.id)) return { error: `id "${data.id}" already exists` };
    if (!data.type) return { error: 'type is required (gateway, ollama, openai)' };

    const model = {
      id: data.id,
      name: data.name || data.id,
      type: data.type,
      url: data.url || '',
      token: data.token || '',
      api_key: data.api_key || '',
      model: data.model || '',
      enabled: data.enabled !== false
    };
    models.push(model);
    saveConfigToDisk();
    log('INFO', `Model added: ${model.id} (${model.type})`);
    return { success: true, model: { ...model, api_key: model.api_key ? '***' : undefined, token: model.token ? '***' : undefined } };
  }

  function updateModel(id, data) {
    const models = config.models || [];
    const idx = models.findIndex(m => m.id === id);
    if (idx === -1) return { error: `model "${id}" not found` };

    const allowed = ['name', 'type', 'url', 'token', 'api_key', 'model', 'enabled'];
    for (const key of allowed) {
      if (data[key] !== undefined) models[idx][key] = data[key];
    }
    if (data.id && data.id !== id) {
      if (models.find(m => m.id === data.id && m !== models[idx])) {
        return { error: `id "${data.id}" already exists` };
      }
      models[idx].id = data.id;
    }
    saveConfigToDisk();
    log('INFO', `Model updated: ${id} → ${models[idx].id}`);
    const m = { ...models[idx] };
    if (m.api_key) m.api_key = '***';
    if (m.token) m.token = '***';
    return { success: true, model: m };
  }

  function removeModel(id) {
    const models = config.models || [];
    const idx = models.findIndex(m => m.id === id);
    if (idx === -1) return { error: `model "${id}" not found` };

    models.splice(idx, 1);
    if (config.default_model === id) config.default_model = models[0]?.id || '';
    saveConfigToDisk();
    log('INFO', `Model removed: ${id}`);
    return { success: true };
  }

  function setDefaultModel(id) {
    const models = config.models || [];
    if (!models.find(m => m.id === id)) return { error: `model "${id}" not found` };
    config.default_model = id;
    saveConfigToDisk();
    log('INFO', `Default model set: ${id}`);
    return { success: true, default_model: id };
  }

  // ===== 连接测试 =====

  async function testModel(id) {
    const models = config.models || [];
    const model = models.find(m => m.id === id);
    if (!model) return { error: `model "${id}" not found` };

    const result = { id: model.id, type: model.type, url: model.url, reachable: false, latency_ms: 0, error: null };

    try {
      const start = Date.now();
      let resp;

      switch (model.type) {
        case 'gateway': {
          const u = new URL(model.url || config.gateway.url);
          resp = await httpReq({
            hostname: u.hostname, port: u.port, path: '/v1/models',
            method: 'GET', timeout: 5000,
            headers: { 'Authorization': `Bearer ${model.token || config.gateway.token}` }
          });
          break;
        }
        case 'ollama': {
          const u = new URL(model.url || `http://127.0.0.1:${config.ollama.port}`);
          resp = await httpReq({
            hostname: u.hostname, port: u.port, path: '/api/tags',
            method: 'GET', timeout: 5000
          });
          break;
        }
        case 'openai': {
          const u = new URL(model.url);
          const basePath = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '/v1';
          resp = await httpReq({
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: `${basePath}/models`,
            method: 'GET', timeout: 5000,
            headers: model.api_key ? { 'Authorization': `Bearer ${model.api_key}` } : {}
          });
          break;
        }
        default:
          return { error: `unsupported type: ${model.type}` };
      }

      result.latency_ms = Date.now() - start;
      result.reachable = resp.status >= 200 && resp.status < 400;
      if (!result.reachable) {
        result.error = `HTTP ${resp.status}`;
      }
    } catch (e) {
      result.error = e.message;
    }

    return result;
  }

  // ===== 切换模型（更新 state） =====

  function switchModel(id) {
    const models = config.models || [];
    const model = models.find(m => m.id === id);
    if (!model) return { error: `model "${id}" not found` };

    config.default_model = id;
    saveConfigToDisk();

    // 同步到 state
    state.activeModel = id;
    state.activeModelConfig = model;

    log('INFO', `Model switched: ${id}`);
    return { success: true, model: summarize(model) };
  }

  // ===== 工具 =====

  function saveConfigToDisk() {
    try {
      const { saveConfig } = require('../lib/config');
      saveConfig(config);
    } catch (e) {
      log('ERROR', 'Failed to save config:', e.message);
    }
  }

  function summarize(m) {
    const s = { id: m.id, name: m.name, type: m.type, url: m.url, model: m.model, enabled: m.enabled };
    if (m.api_key) s.api_key = '***';
    if (m.token) s.token = '***';
    s.is_default = m.id === config.default_model;
    return s;
  }

  return { listModels, getModel, addModel, updateModel, removeModel, setDefaultModel, testModel, switchModel };
}

module.exports = { createModelManager };
