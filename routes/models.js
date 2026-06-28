'use strict';

/**
 * 模型/API 提供商管理路由
 *
 * REST API 端点用于 CRUD、连接测试、切换模型提供商
 */
function createModelRoutes(modelManager, config, state, { log, utils }) {
  const { HTTP_STATUS, sendJSON, sendError, collectBody } = utils;

  function register(handlers) {

    // GET /api/models — 列出全部模型
    handlers['GET /api/models'] = (req, res) => {
      const models = modelManager.listModels();
      sendJSON(res, {
        models,
        default_model: config.default_model || '',
        total: models.length
      });
    };

    // GET /api/models/detail — 获取单个模型详情 (?id=xxx)
    handlers['GET /api/models/detail'] = (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const id = url.searchParams.get('id');
      if (!id) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'query param "id" required');
      const model = modelManager.getModel(id);
      if (!model) return sendError(res, HTTP_STATUS.NOT_FOUND, `model "${id}" not found`);
      sendJSON(res, model);
    };

    // POST /api/models — 添加新模型
    handlers['POST /api/models'] = (req, res) =>
      collectBody(req, body => {
        try {
          const data = JSON.parse(body);
          const result = modelManager.addModel(data);
          if (result.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, result.error);
          sendJSON(res, result, HTTP_STATUS.CREATED);
        } catch (e) {
          sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid json');
        }
      });

    // PUT /api/models — 更新模型 (?id=xxx)
    handlers['PUT /api/models'] = (req, res) =>
      collectBody(req, body => {
        try {
          const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          const id = url.searchParams.get('id');
          if (!id) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'query param "id" required');
          const data = JSON.parse(body);
          const result = modelManager.updateModel(id, data);
          if (result.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, result.error);
          sendJSON(res, result);
        } catch (e) {
          sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid json');
        }
      });

    // DELETE /api/models — 删除模型 (?id=xxx)
    handlers['DELETE /api/models'] = (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const id = url.searchParams.get('id');
      if (!id) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'query param "id" required');
      const result = modelManager.removeModel(id);
      if (result.error) return sendError(res, HTTP_STATUS.NOT_FOUND, result.error);
      sendJSON(res, result);
    };

    // POST /api/models/test — 测试模型连接
    handlers['POST /api/models/test'] = (req, res) =>
      collectBody(req, async body => {
        try {
          const { id } = JSON.parse(body);
          if (!id) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'body "id" required');
          const result = await modelManager.testModel(id);
          sendJSON(res, result);
        } catch (e) {
          sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid json');
        }
      });

    // POST /api/models/default — 设置默认模型
    handlers['POST /api/models/default'] = (req, res) =>
      collectBody(req, body => {
        try {
          const { id } = JSON.parse(body);
          if (!id) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'body "id" required');
          const result = modelManager.setDefaultModel(id);
          if (result.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, result.error);
          sendJSON(res, result);
        } catch (e) {
          sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid json');
        }
      });

    // POST /api/models/switch — 切换模型
    handlers['POST /api/models/switch'] = (req, res) =>
      collectBody(req, body => {
        try {
          const { id } = JSON.parse(body);
          if (!id) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'body "id" required');
          const result = modelManager.switchModel(id);
          if (result.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, result.error);
          sendJSON(res, result);
        } catch (e) {
          sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid json');
        }
      });
  }

  return { register };
}

module.exports = { createModelRoutes };
