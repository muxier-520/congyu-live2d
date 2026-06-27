/**
 * AI 扩展路由
 * - 网络搜索 (/api/search)
 * - 图像视觉分析 (/api/ollama/vision)
 * - 视觉模型列表 (/api/ollama/vision-models)
 */
'use strict';

function createAIExtrasRoutes(ai, config, { log, utils }) {
  const { HTTP_STATUS, sendJSON, sendError, collectBody } = utils;

  function register(handlers) {

    // POST /api/search — DuckDuckGo 网络搜索
    handlers['POST /api/search'] = async (req, res) => {
      collectBody(req, async body => {
        try {
          const { query, max_results } = JSON.parse(body);
          if (!query || query.trim().length === 0) {
            return sendError(res, HTTP_STATUS.BAD_REQUEST, 'query is empty');
          }
          const results = await ai.searchWeb(query, max_results);
          sendJSON(res, { success: true, query, results, count: results.length });
        } catch (e) {
          log('ERROR', 'Search error:', e.message);
          sendError(res, HTTP_STATUS.SERVER_ERROR, 'search failed');
        }
      });
    };

    // POST /api/ollama/vision — 图像分析
    handlers['POST /api/ollama/vision'] = async (req, res) => {
      collectBody(req, async body => {
        try {
          const { image, prompt } = JSON.parse(body);
          if (!image) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'image data required');
          const result = await ai.visionAnalysis(image, prompt);
          sendJSON(res, { success: true, result });
        } catch (e) {
          log('ERROR', 'Vision error:', e.message);
          sendError(res, HTTP_STATUS.SERVER_ERROR, 'vision analysis failed');
        }
      });
    };

    // GET /api/ollama/vision-models — 列出可用视觉模型
    handlers['GET /api/ollama/vision-models'] = async (req, res) => {
      try {
        const models = await ai.listVisionModels();
        sendJSON(res, { success: true, models, count: models.length });
      } catch (e) {
        sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'cannot fetch vision models');
      }
    };
  }

  return { register };
}

module.exports = { createAIExtrasRoutes };
