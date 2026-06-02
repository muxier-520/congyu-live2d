/**
 * 文件操作路由
 * - 列出目录 (/api/files/list)
 * - 读取文件 (/api/files/read)
 * - 写入文件 (/api/files/write)
 * - 删除文件 (/api/files/delete)
 *
 * 安全：路径遍历保护，大小限制，扩展名白名单
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_READ_SIZE = 1 * 1024 * 1024; // 1MB
const ALLOWED_EXTENSIONS = new Set([
  '.txt', '.json', '.md', '.js', '.css', '.html', '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.xml', '.csv', '.log'
]);
const READONLY_DIRS = ['config', 'node_modules', '.git'];
const PROTECTED_FILES = ['config.json', '.env'];

function createFilesRoutes(appRoot, { log, utils }) {
  const { HTTP_STATUS, sendJSON, sendError, collectBody, ensureDir } = utils;

  function safeResolve(inputPath) {
    const resolved = path.resolve(appRoot, inputPath);
    if (!resolved.startsWith(path.resolve(appRoot))) return null;
    if (resolved === appRoot) return resolved;
    // 检查父目录是否被允许
    const rel = path.relative(appRoot, resolved);
    const parts = rel.split(path.sep);
    for (const p of parts) {
      if (p === '..') return null;
    }
    return resolved;
  }

  function register(handlers) {

    // POST /api/files/list — 列出目录内容
    handlers['POST /api/files/list'] = async (req, res) => {
      collectBody(req, async body => {
        try {
          const { dir } = JSON.parse(body);
          const targetDir = dir && dir !== '.' ? safeResolve(dir) : appRoot;
          if (!targetDir) {
            return sendError(res, HTTP_STATUS.FORBIDDEN, 'path not allowed');
          }
          if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
            return sendError(res, HTTP_STATUS.NOT_FOUND, 'directory not found');
          }
          const entries = fs.readdirSync(targetDir).map(name => {
            const fp = path.join(targetDir, name);
            try {
              const stat = fs.statSync(fp);
              return {
                name,
                type: stat.isDirectory() ? 'dir' : 'file',
                size: stat.size,
                mtime: stat.mtime.toISOString()
              };
            } catch { return null; }
          }).filter(Boolean);

          sendJSON(res, { success: true, dir: targetDir, entries, count: entries.length });
        } catch (e) {
          log('ERROR', 'File list error:', e.message);
          sendError(res, HTTP_STATUS.SERVER_ERROR, 'list failed');
        }
      });
    };

    // POST /api/files/read — 读取文件内容
    handlers['POST /api/files/read'] = async (req, res) => {
      collectBody(req, async body => {
        try {
          const { file } = JSON.parse(body);
          if (!file) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'file required');

          const fp = safeResolve(file);
          if (!fp) return sendError(res, HTTP_STATUS.FORBIDDEN, 'path not allowed');
          if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
            return sendError(res, HTTP_STATUS.NOT_FOUND, 'file not found');
          }

          const stat = fs.statSync(fp);
          if (stat.size > MAX_READ_SIZE) {
            return sendError(res, HTTP_STATUS.ENTITY_TOO_LARGE, 'file too large (max 1MB)');
          }

          const content = fs.readFileSync(fp, 'utf-8');
          sendJSON(res, { success: true, content, size: stat.size, name: path.basename(fp) });
        } catch (e) {
          log('ERROR', 'File read error:', e.message);
          sendError(res, HTTP_STATUS.SERVER_ERROR, 'read failed');
        }
      });
    };

    // POST /api/files/write — 写入/创建文件
    handlers['POST /api/files/write'] = async (req, res) => {
      collectBody(req, async body => {
        try {
          const { file, content } = JSON.parse(body);
          if (!file) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'file required');
          if (content === undefined) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'content required');

          const ext = path.extname(file).toLowerCase();
          if (!ALLOWED_EXTENSIONS.has(ext)) {
            return sendError(res, HTTP_STATUS.FORBIDDEN,
              `extension "${ext}" not allowed (allowed: ${[...ALLOWED_EXTENSIONS].join(', ')})`);
          }

          const fp = safeResolve(file);
          if (!fp) return sendError(res, HTTP_STATUS.FORBIDDEN, 'path not allowed');

          // 禁止写入只读目录
          const rel = path.relative(appRoot, fp);
          for (const pf of PROTECTED_FILES) {
            if (rel === pf || rel.endsWith(path.sep + pf)) {
              return sendError(res, HTTP_STATUS.FORBIDDEN, `cannot modify protected file: ${pf}`);
            }
          }
          for (const rd of READONLY_DIRS) {
            if (rel === rd || rel.startsWith(rd + path.sep)) {
              return sendError(res, HTTP_STATUS.FORBIDDEN, `cannot write to ${rd} directory`);
            }
          }

          ensureDir(path.dirname(fp));
          fs.writeFileSync(fp, content, 'utf-8');
          log('INFO', `File written: ${rel}`);
          sendJSON(res, { success: true, size: Buffer.byteLength(content, 'utf-8'), path: rel });
        } catch (e) {
          log('ERROR', 'File write error:', e.message);
          sendError(res, HTTP_STATUS.SERVER_ERROR, 'write failed');
        }
      });
    };

    // POST /api/files/delete — 删除文件
    handlers['POST /api/files/delete'] = async (req, res) => {
      collectBody(req, async body => {
        try {
          const { file } = JSON.parse(body);
          if (!file) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'file required');

          const fp = safeResolve(file);
          if (!fp) return sendError(res, HTTP_STATUS.FORBIDDEN, 'path not allowed');
          if (!fs.existsSync(fp)) return sendError(res, HTTP_STATUS.NOT_FOUND, 'file not found');

          // 禁止删除目录或系统文件
          if (fs.statSync(fp).isDirectory()) {
            return sendError(res, HTTP_STATUS.FORBIDDEN, 'cannot delete directories');
          }

          const rel = path.relative(appRoot, fp);
          for (const pf of PROTECTED_FILES) {
            if (rel === pf || rel.endsWith(path.sep + pf)) {
              return sendError(res, HTTP_STATUS.FORBIDDEN, `cannot delete protected file: ${pf}`);
            }
          }
          for (const rd of READONLY_DIRS) {
            if (rel === rd || rel.startsWith(rd + path.sep)) {
              return sendError(res, HTTP_STATUS.FORBIDDEN, `cannot delete from ${rd} directory`);
            }
          }

          fs.unlinkSync(fp);
          log('INFO', `File deleted: ${rel}`);
          sendJSON(res, { success: true, path: rel });
        } catch (e) {
          log('ERROR', 'File delete error:', e.message);
          sendError(res, HTTP_STATUS.SERVER_ERROR, 'delete failed');
        }
      });
    };
  }

  return { register };
}

module.exports = { createFilesRoutes };
