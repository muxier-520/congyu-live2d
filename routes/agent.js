/**
 * Agent API 路由
 */
'use strict';

function createAgentRoutes(agent, config, state, { log, utils }) {
  const { HTTP_STATUS, sendJSON, sendError, collectBody } = utils;

  function register(handlers) {
    // POST /api/agent/chat — Agent 对话（自动工具调用）
    handlers['POST /api/agent/chat'] = (req, res) =>
      collectBody(req, async body => {
        try {
          const { message, history } = JSON.parse(body);
          if (!message) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'message required');
          const result = await agent.processMessage(message, history || []);
          sendJSON(res, result);
        } catch (e) {
          log('ERROR', 'Agent error:', e.message);
          sendError(res, HTTP_STATUS.SERVER_ERROR, e.message);
        }
      });

    // GET /api/agent/tools — 获取工具列表
    handlers['GET /api/agent/tools'] = (req, res) => {
      const tools = agent.getToolList();
      sendJSON(res, { tools, total: tools.length });
    };

    // POST /api/agent/tool/execute — 直接执行工具
    handlers['POST /api/agent/tool/execute'] = (req, res) =>
      collectBody(req, async body => {
        try {
          const { tool, input } = JSON.parse(body);
          const result = await agent.execute(tool, input || {});
          sendJSON(res, result);
        } catch (e) {
          sendError(res, HTTP_STATUS.SERVER_ERROR, e.message);
        }
      });
  }

  return { register };
}

module.exports = { createAgentRoutes };
