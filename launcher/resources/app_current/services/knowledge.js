/**
 * 知识库服务 — 全文检索 + 倒排索引
 */
'use strict';

const fs = require('fs');
const path = require('path');

function createKnowledgeBase(config, state, { log, utils }) {
  const { ensureDir, safeJSON } = utils;

  const documents = new Map();       // docId -> { id, name, content, size, ext, uploadedAt }
  const invertedIndex = new Map();   // token -> Set<docId>
  const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge_base');

  // ==================== 分词 ====================
  function tokenize(text) {
    const tokens = new Set();
    if (!text) return tokens;

    // 中文：按字符二元组 (bigram)
    const cjkRe = /[一-鿿㐀-䶿＀-￯]/;
    let cjkBlock = '';
    for (const ch of text) {
      if (cjkRe.test(ch)) {
        cjkBlock += ch;
      } else {
        if (cjkBlock) {
          for (let i = 0; i < cjkBlock.length - 1; i++) {
            tokens.add(cjkBlock.slice(i, i + 2));
          }
          if (cjkBlock.length === 1) tokens.add(cjkBlock);
          cjkBlock = '';
        }
      }
    }
    if (cjkBlock) {
      for (let i = 0; i < cjkBlock.length - 1; i++) {
        tokens.add(cjkBlock.slice(i, i + 2));
      }
      if (cjkBlock.length === 1) tokens.add(cjkBlock);
    }

    // 英文/数字：按非字母数字分割，小写化
    const asciiTokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 2);
    for (const t of asciiTokens) tokens.add(t);

    return tokens;
  }

  // ==================== 索引管理 ====================
  function indexDocument(doc) {
    const tokens = tokenize(doc.content);
    for (const token of tokens) {
      if (!invertedIndex.has(token)) {
        invertedIndex.set(token, new Set());
      }
      invertedIndex.get(token).add(doc.id);
    }
  }

  function unindexDocument(docId) {
    for (const [token, docSet] of invertedIndex) {
      docSet.delete(docId);
      if (docSet.size === 0) invertedIndex.delete(token);
    }
  }

  function rebuildIndex() {
    invertedIndex.clear();
    documents.clear();
    if (!fs.existsSync(KNOWLEDGE_DIR)) return;
    const files = fs.readdirSync(KNOWLEDGE_DIR).filter(f => f.endsWith('.json') && f.startsWith('kb_'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf-8');
        const doc = JSON.parse(content);
        if (doc && doc.id && doc.content) {
          documents.set(doc.id, doc);
          indexDocument(doc);
        }
      } catch (e) {
        log('WARN', `KB: failed to load ${file}: ${e.message}`);
      }
    }
    log('INFO', `KB: loaded ${documents.size} documents, ${invertedIndex.size} unique tokens`);
  }

  // ==================== 文档 CRUD ====================
  function init() {
    ensureDir(KNOWLEDGE_DIR);
    rebuildIndex();
  }

  async function uploadDocument(name, content) {
    const ext = path.extname(name) || '.txt';
    const doc = {
      id: 'kb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      name,
      content,
      size: Buffer.byteLength(content, 'utf-8'),
      ext,
      uploadedAt: new Date().toISOString()
    };
    const filePath = path.join(KNOWLEDGE_DIR, doc.id + '.json');
    fs.writeFileSync(filePath, JSON.stringify(doc, null, 2), 'utf-8');
    documents.set(doc.id, doc);
    indexDocument(doc);
    log('INFO', `KB: uploaded "${name}" (${doc.size} bytes)`);
    return doc;
  }

  function listDocuments() {
    return Array.from(documents.values()).map(d => ({
      id: d.id, name: d.name, size: d.size, ext: d.ext, uploadedAt: d.uploadedAt
    }));
  }

  function getDocument(id) {
    const doc = documents.get(id);
    if (!doc) return null;
    return { id: doc.id, name: doc.name, content: doc.content, size: doc.size, ext: doc.ext };
  }

  function deleteDocument(id) {
    const doc = documents.get(id);
    if (!doc) return false;
    const filePath = path.join(KNOWLEDGE_DIR, doc.id + '.json');
    try { fs.unlinkSync(filePath); } catch {}
    unindexDocument(id);
    documents.delete(id);
    log('INFO', `KB: deleted "${doc.name}"`);
    return true;
  }

  // ==================== 搜索 ====================
  function search(query, maxResults = 5, documentIds = null) {
    const queryTokens = tokenize(query);
    if (queryTokens.size === 0) return [];

    // 评分：每个文档的命中 token 数
    const scores = new Map(); // docId -> { score, positions: [] }
    for (const token of queryTokens) {
      const docSet = invertedIndex.get(token);
      if (!docSet) continue;
      for (const docId of docSet) {
        // 如果指定了 documentIds 过滤，只搜索指定文档
        if (documentIds && !documentIds.includes(docId)) continue;
        if (!scores.has(docId)) scores.set(docId, { score: 0, matchedTokens: new Set() });
        scores.get(docId).score++;
        scores.get(docId).matchedTokens.add(token);
      }
    }

    // 按评分降序排列
    const sorted = Array.from(scores.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, maxResults);

    // 提取 snippet
    return sorted.map(([docId, { score, matchedTokens }]) => {
      const doc = documents.get(docId);
      if (!doc) return null;

      const snippet = extractSnippet(doc.content, matchedTokens);
      return {
        id: doc.id,
        name: doc.name,
        score,
        snippet,
        size: doc.size
      };
    }).filter(Boolean);
  }

  function extractSnippet(content, matchedTokens) {
    // 找到第一个匹配位置附近的 ~100 字片段
    let bestIdx = -1;
    for (const token of matchedTokens) {
      // 对 bigram token（2 字符），直接搜索原文
      const idx = content.indexOf(token);
      if (idx >= 0 && (bestIdx === -1 || idx < bestIdx)) {
        bestIdx = idx;
      }
    }

    if (bestIdx === -1) {
      // 无匹配时返回开头
      return content.slice(0, 100) + (content.length > 100 ? '...' : '');
    }

    const snippetLen = 120;
    const halfLen = Math.floor(snippetLen / 2);
    let start = Math.max(0, bestIdx - halfLen);
    let end = Math.min(content.length, start + snippetLen);
    if (end - start < snippetLen && start > 0) {
      start = Math.max(0, end - snippetLen);
    }

    let snippet = content.slice(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet += '...';
    return snippet;
  }

  return {
    init, uploadDocument, listDocuments, getDocument, deleteDocument, search, rebuildIndex
  };
}

module.exports = { createKnowledgeBase };
