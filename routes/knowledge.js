/**
 * 知识库 API 路由
 */
'use strict';

function createKnowledgeRoutes(kb, config, state, { log, utils }) {
  const { HTTP_STATUS, sendJSON, sendError, collectBody } = utils;

  const ALLOWED_EXTENSIONS = ['.txt', '.json', '.md', '.js', '.css', '.html', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.xml', '.csv', '.log'];

  function register(handlers) {

    // GET /api/knowledge/list
    handlers['GET /api/knowledge/list'] = (req, res) => {
      const docs = kb.listDocuments();
      sendJSON(res, { success: true, documents: docs, count: docs.length });
    };

    // POST /api/knowledge/upload
    handlers['POST /api/knowledge/upload'] = (req, res) => collectBody(req, body => {
      try {
        const { name, content } = JSON.parse(body);
        if (!name || !content) {
          return sendError(res, HTTP_STATUS.BAD_REQUEST, 'name and content required');
        }
        const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : '';
        if (ext && !ALLOWED_EXTENSIONS.includes(ext)) {
          return sendError(res, HTTP_STATUS.BAD_REQUEST, `extension not allowed: ${ext}`);
        }
        const byteLen = Buffer.byteLength(content, 'utf-8');
        if (byteLen > 1024 * 1024) {
          return sendError(res, HTTP_STATUS.BAD_REQUEST, `content too large: ${byteLen} bytes (max 1MB)`);
        }
        const doc = kb.uploadDocument(name, content);
        sendJSON(res, { success: true, document: { id: doc.id, name: doc.name, size: doc.size } });
      } catch (e) {
        sendError(res, HTTP_STATUS.BAD_REQUEST, e.message);
      }
    });

    // POST /api/knowledge/delete
    handlers['POST /api/knowledge/delete'] = (req, res) => collectBody(req, body => {
      try {
        const { id } = JSON.parse(body);
        if (!id) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'id required');
        const ok = kb.deleteDocument(id);
        sendJSON(res, { success: ok, message: ok ? 'deleted' : 'not found' });
      } catch (e) {
        sendError(res, HTTP_STATUS.BAD_REQUEST, e.message);
      }
    });

    // POST /api/knowledge/search
    handlers['POST /api/knowledge/search'] = (req, res) => collectBody(req, body => {
      try {
        const { query, maxResults, documentIds } = JSON.parse(body);
        if (!query) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'query required');
        const results = kb.search(query, maxResults || 5, documentIds || null);
        sendJSON(res, { success: true, results, count: results.length });
      } catch (e) {
        sendError(res, HTTP_STATUS.BAD_REQUEST, e.message);
      }
    });

    // GET /api/knowledge/get
    handlers['GET /api/knowledge/get'] = (req, res) => {
      const url = require('url');
      const params = url.parse(req.url, true).query;
      const doc = kb.getDocument(params.id);
      if (!doc) return sendError(res, HTTP_STATUS.NOT_FOUND, 'document not found');
      sendJSON(res, { success: true, document: doc });
    };
  }

  return { register };
}

module.exports = { createKnowledgeRoutes };
