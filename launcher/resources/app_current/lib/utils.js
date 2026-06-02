/**
 * 通用工具函数
 * - HTTP 响应、请求体解析、端口检测、网络请求、限流
 */
'use strict';

const net = require('net');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const { promisify } = require('util');
const execPromise = promisify(exec);

// ==================== 常量 ====================
const HTTP_STATUS = {
  OK: 200, CREATED: 201, NO_CONTENT: 204,
  BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  RATE_LIMIT: 429, SERVER_ERROR: 500, BAD_GATEWAY: 502, GATEWAY_TIMEOUT: 504,
  SERVICE_UNAVAILABLE: 503, PARTIAL_CONTENT: 206
};

const MIME_TYPES = {
  '.html': 'text/html;charset=utf-8', '.css': 'text/css;charset=utf-8',
  '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.webm': 'audio/webm', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.moc3': 'application/octet-stream',
  '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed', '.7z': 'application/x-7z-compressed',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv;charset=utf-8', '.md': 'text/markdown;charset=utf-8',
  '.txt': 'text/plain;charset=utf-8'
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400'
};

// ==================== 响应辅助 ====================
function sendCORS(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}

function sendJSON(res, data, code = HTTP_STATUS.OK) {
  sendCORS(res);
  res.setHeader('Content-Type', 'application/json;charset=utf-8');
  res.writeHead(code);
  res.end(JSON.stringify(data));
}

function sendError(res, code, message) {
  sendCORS(res);
  res.setHeader('Content-Type', 'application/json;charset=utf-8');
  res.writeHead(code);
  res.end(JSON.stringify({ error: message }));
}

function detectAudioMime(buffer) {
  if (!buffer || buffer.length < 12) return 'audio/wav';
  const magic = buffer.toString('ascii', 0, 12).toLowerCase();
  if (magic.startsWith('riff') && magic.includes('wave')) return 'audio/wav';
  if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) return 'audio/mpeg';
  if (magic.startsWith('id3')) return 'audio/mpeg';
  if (magic.startsWith('ftyp')) return 'audio/mp4';
  return 'audio/wav';
}

function sendAudio(res, buffer, contentType) {
  res.writeHead(HTTP_STATUS.OK, {
    'Content-Type': contentType || detectAudioMime(buffer),
    'Content-Length': buffer.length,
    'Access-Control-Allow-Origin': '*'
  });
  res.end(buffer);
}

// ==================== 请求体解析 ====================
function collectBody(req, cb) {
  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', c => {
    size += c.length;
    if (size > 1048576) { aborted = true; req.destroy(); return; }
    chunks.push(c);
  });
  const done = () => Buffer.concat(chunks).toString('utf-8');
  const onError = () => { if (cb) cb(''); };
  if (cb) {
    req.on('end', () => { if (!aborted) cb(done()); });
    req.on('error', onError);
  } else {
    return new Promise(resolve => {
      req.on('end', () => { if (!aborted) resolve(done()); else resolve(''); });
      req.on('error', onError);
    });
  }
}

// ==================== HTTP 请求 ====================
function httpReq(opts, body = null, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const client = opts.protocol === 'https:' ? https : http;
    const req = client.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error(`timeout ${timeout}ms`)); });
    if (body) req.write(body);
    req.end();
  });
}

async function withRetry(fn, max = 2, delay = 1000) {
  let lastErr;
  for (let i = 1; i <= max; i++) {
    try { return await fn(); } catch (e) { lastErr = e; if (i < max) await new Promise(r => setTimeout(r, delay)); }
  }
  throw lastErr;
}

// ==================== 端口检测 ====================
function isPortFree(port) {
  return new Promise(r => {
    const s = net.createServer();
    s.once('error', () => r(false));
    s.once('listening', () => s.close(() => r(true)));
    s.listen(port);
  });
}

async function killPort(port) {
  try {
    const { stdout } = await execPromise(`netstat -ano | findstr :${port} | findstr LISTENING`);
    const pids = new Set();
    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid) && pid !== '0' && pid !== String(process.pid)) pids.add(pid);
    }
    for (const pid of pids) {
      try { await execPromise(`taskkill /F /PID ${pid}`); } catch {}
    }
    if (pids.size) await new Promise(r => setTimeout(r, 1000));
  } catch {}
}

function checkPort(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const s = net.createConnection(port, host, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(2000, () => { s.destroy(); resolve(false); });
  });
}

function waitForPort(port, timeoutMs = 30000, host = '127.0.0.1') {
  return new Promise(resolve => {
    const start = Date.now();
    const check = () => {
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      checkPort(port, host).then(ok => {
        if (ok) resolve(true);
        else setTimeout(check, 1000);
      });
    };
    check();
  });
}

// ==================== 杂项 ====================
function ensureDir(dir) {
  const fs = require('fs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeJSON(str) {
  try { return JSON.parse(str); }
  catch { return null; }
}

// ==================== 限流 ====================
function createRateChecker(rateLimits, maxRequests) {
  return function checkRate(ip) {
    const now = Date.now(), window = 60000;
    let r = rateLimits.get(ip);
    if (!r || now > r.resetAt) {
      rateLimits.set(ip, { count: 1, resetAt: now + window });
      return true;
    }
    r.count++;
    return r.count <= maxRequests;
  };
}

function startRateLimitCleanup(rateLimits, intervalMs = 60000) {
  return setInterval(() => {
    const now = Date.now();
    for (const [ip, r] of rateLimits) {
      if (now > r.resetAt) rateLimits.delete(ip);
    }
  }, intervalMs);
}

module.exports = {
  HTTP_STATUS, MIME_TYPES, CORS_HEADERS,
  sendCORS, sendJSON, sendError, sendAudio, detectAudioMime,
  collectBody, httpReq, withRetry,
  isPortFree, killPort, checkPort, waitForPort,
  ensureDir, safeJSON,
  createRateChecker, startRateLimitCleanup
};
