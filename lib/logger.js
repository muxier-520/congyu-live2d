/**
 * 日志系统
 * - 分级日志: ERROR/WARN/INFO/DEBUG/REQ/GPT
 * - 环形缓冲区：保留最近 N 条日志用于 bug 报告
 */
'use strict';

const MAX_RECENT_LOGS = 500;
const recentLogs = [];

const ICONS = {
  ERROR: '❌', WARN: '⚠️', INFO: 'ℹ️', DEBUG: '🔍', REQ: '🌐', GPT: '🤖'
};

function log(level, msg, ...args) {
  const icon = ICONS[level] || '';
  const ts = new Date().toISOString();
  const formatted = args.map(a => {
    if (a instanceof Error) {
      return `${a.message}${a.stack ? '\n  ' + a.stack.split('\n').slice(1).join('\n  ') : ''}`;
    }
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
  const line = `${icon} [${ts}] [${level}] ${msg}${formatted ? ' ' + formatted : ''}`;
  console.log(line);

  recentLogs.push({ ts, level, msg, formatted, icon });
  if (recentLogs.length > MAX_RECENT_LOGS) recentLogs.shift();
}

function logReq(req, status, durationMs) {
  const url = req.url?.split('?')[0] || '/';
  log('REQ', `${req.method} ${url} → ${status} (${durationMs}ms)`);
}

module.exports = { log, logReq, recentLogs, MAX_RECENT_LOGS };
