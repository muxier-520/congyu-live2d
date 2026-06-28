/**
 * 记忆系统 API 路由
 */
'use strict';

function createMemoryRoutes(memory, config, state, { log, utils }) {
  const { HTTP_STATUS, sendJSON, sendError, collectBody } = utils;

  function register(handlers) {
    handlers['GET /api/memory'] = (req, res) => {
      sendJSON(res, { content: memory.getMemoryContent(), success: true });
    };

    handlers['POST /api/memory'] = (req, res) =>
      collectBody(req, body => {
        try {
          const { category, content } = JSON.parse(body);
          if (!content) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'content required');
          memory.addMemory(category || '📚 重要事实', content);
          sendJSON(res, { success: true });
        } catch (e) { sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid JSON'); }
      });

    handlers['GET /api/memory/stats'] = (req, res) => {
      sendJSON(res, memory.getMemoryStats());
    };

    handlers['POST /api/chat/memory-context'] = (req, res) => collectBody(req, body => {
      try {
        const ctx = memory.generateMemoryContext();
        sendJSON(res, { context: ctx });
      } catch (e) { sendJSON(res, { context: '' }); }
    });

    handlers['POST /api/chat/extract-memory'] = (req, res) => collectBody(req, body => {
      try {
        const { userMessage } = JSON.parse(body);
        const extracted = memory.extractMemoriesFromMessage(userMessage || '');
        sendJSON(res, { success: true, extracted, count: extracted.length });
      } catch (e) { sendJSON(res, { success: true, count: 0 }); }
    });
  }

  return { register };
}

module.exports = { createMemoryRoutes };
