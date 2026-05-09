/**
 * 丛雨 Live2D 后端服务器 v3.3
 *
 * v3.3 优化:
 * - 增加 GPT-SoVITS 自动启动与进程崩溃自动重启
 * - 请求日志 (🌐 REQ) — 记录方法、URL、状态码、耗时
 * - 结构化错误日志 — 包含 Error 对象的 stack trace
 * - 优化启动鲁棒性 — 端口冲突自动清理旧进程
 * - 增加 /api/config-reload 热重载配置
 * - 修复多处静默 catch 块，增加上下文日志
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn, exec } = require('child_process');
const { tmpdir } = require('os');
const { promisify } = require('util');
const execPromise = promisify(exec);

const APP_ROOT = __dirname;
const CONFIG_PATH = path.join(APP_ROOT, 'config.json');

// Audio output directory - must be OUTSIDE asar (asar is read-only!)
const AUDIO_DIR = APP_ROOT.includes('.asar')
  ? path.join(tmpdir(), 'murasame-audio')
  : path.join(APP_ROOT, 'audio');

// ==================== 常量 ====================
const HTTP_STATUS = {
  OK: 200, CREATED: 201, NO_CONTENT: 204,
  BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  RATE_LIMIT: 429, SERVER_ERROR: 500, BAD_GATEWAY: 502, GATEWAY_TIMEOUT: 504,
  SERVICE_UNAVAILABLE: 503, PARTIAL_CONTENT: 206
};

const MIME_TYPES = {
  '.html': 'text/html;charset=utf-8', '.css': 'text/css',
  '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.webm': 'audio/webm', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.moc3': 'application/octet-stream',
  '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.rar': 'application/x-rar-compressed', '.7z': 'application/x-7z-compressed',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv', '.md': 'text/markdown', '.txt': 'text/plain'
};

const MAX_TTS_TEXT_LENGTH = 500;
const MAX_TTS_TEXT_BYTES = 2048;

// Bug reports 目录
const BUG_REPORTS_DIR = path.join(APP_ROOT, 'bug_reports');

// 日志环形缓冲区 - 保留最近 N 条日志用于生成 bug 报告
const MAX_RECENT_LOGS = 500;
const recentLogs = [];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Max-Age': '86400'
};

// ==================== 默认配置 ====================
const DEFAULTS = {
  server: { port: 8888, host: '127.0.0.1' },
  gpt_sovits: {
    hostname: '127.0.0.1',
    port: 9880,
    endpoint: '/',
    startup_timeout_ms: 120000
  },
  ollama: {
    model: 'qwen2.5:latest', port: 11434,
    search_paths: ['E:\\ollma\\ollama.exe', 'C:\\Users\\muxier\\AppData\\Local\\Programs\\Ollama\\ollama.exe'],
    models_dir: 'E:\\ollma-data\\.ollama\\models',
    cuda_enabled: true, flash_attention: true
  },
  gateway: { url: 'http://127.0.0.1:28789', token: '8e98b884e9a91f6b8689a98a631024b75a2e748dcb31edba' },
  tts: {
    mode: 'local',
    ref_audio_path: 'models/sounds/congyu_ref.wav',
    prompt_text: '我輩の名前は村雨。村雨丸の管理者。',
    prompt_lang: 'ja', text_lang: 'auto',
    retry: { max_attempts: 2, delay_ms: 1000 },
    timeout_ms: 60000,
    top_k: 15, top_p: 0.6, temperature: 0.8, speed: 1.0,
    cut_punc: ''
  },
  cloud_tts: { voice: 'zh-CN-XiaoxiaoNeural', rate: '+10%' },
  audio: { dir: 'audio', max_files: 50, max_age_ms: 3600000 },
  system_prompt: '你是丛雨(Murasame)，一个温柔可爱的日式女仆。\n\n【强制规则】\n1. 必须用中文回复，文字部分为中文。\n2. 每句话后面用全角括号（）加上对应的日语假名。\n3. 格式：中文句子（日语假名）\n4. 语气温柔可爱，可用"～"符号。\n5. 回答简洁，不超过3句话。\n\n【示例】\n主人，欢迎回来～（ご主人様、おかえりなさい～）\n今天天气真好呢（今日は天気が良いですね）\n\n禁止输出纯日语或纯英语。',
  security: { max_body_size: 1048576, rate_limit_per_min: 60 },
  gpu_cache: {
    enabled: true,
    max_generations: 8,
    vram_threshold_percent: 85,
    cooldown_ms: 30000
  }
};

// ==================== 工具函数 ====================
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      result[key] = deepMerge(target[key] || {}, val);
    } else if (val !== undefined && val !== '') {
      result[key] = val;
    }
  }
  return result;
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return deepMerge(DEFAULTS, saved);
    }
  } catch (e) { console.warn('config.json load failed:', e.message); }
  return { ...DEFAULTS };
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8');
  } catch (e) { log('ERROR', 'Failed to save config', e); }
}

// ==================== 运行时状态 ====================
const state = {
  ttsReady: false, ollamaReady: false, shuttingDown: false,
  startTime: Date.now(), requestCount: 0, lastError: null,
  gptProcess: null,
  rateLimits: new Map(),
  ttsLock: false, ttsQueue: [],
  ttsGenerationCount: 0, lastGpuGcTime: 0
};

let config = loadConfig();

// ==================== 日志 ====================
function log(level, msg, ...args) {
  const icons = { ERROR: '❌', WARN: '⚠️', INFO: 'ℹ️', DEBUG: '🔍', REQ: '🌐', GPT: '🤖' };
  const icon = icons[level] || '';
  const ts = new Date().toISOString();
  // 将 Error 对象展开为可读信息
  const formatted = args.map(a => {
    if (a instanceof Error) return `${a.message}${a.stack ? '\n  ' + a.stack.split('\n').slice(1).join('\n  ') : ''}`;
    if (typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
    return String(a);
  }).join(' ');
  const line = `${icon} [${ts}] [${level}] ${msg}${formatted ? ' ' + formatted : ''}`;
  console.log(line);

  // 写入环形日志缓冲区（用于 bug 报告）
  recentLogs.push({ ts, level, msg, formatted, icon });
  if (recentLogs.length > MAX_RECENT_LOGS) recentLogs.shift();
}

// 简化的请求日志
function logReq(req, status, durationMs) {
  const url = req.url?.split('?')[0] || '/';
  log('REQ', `${req.method} ${url} → ${status} (${durationMs}ms)`);
}

// 安全 JSON 解析，失败返回 null 并记录日志
function safeJSON(str, ctx = '') {
  try { return JSON.parse(str); }
  catch (e) { log('WARN', `JSON parse failed${ctx ? ' [' + ctx + ']' : ''}: ${e.message}`); return null; }
}

// ==================== 核心工具 ====================
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function resolveAudio(p) {
  if (!p) return path.join(APP_ROOT, config.audio.dir, 'congyu_ref.wav');
  return path.isAbsolute(p) ? p : path.join(APP_ROOT, p);
}

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
      try { await execPromise(`taskkill /F /PID ${pid}`); log('INFO', `Killed PID ${pid} on port ${port}`); } catch (e) { log('WARN', `Failed to kill PID ${pid}: ${e.message}`); }
    }
    if (pids.size) await new Promise(r => setTimeout(r, 1000));
  } catch (e) { log('WARN', `killPort(${port}) failed: ${e.message}`); }
}

// 带超时的 HTTP 请求
function httpReq(opts, body = null, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const req = http.request(opts, res => {
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

// ==================== 限流 ====================
function checkRate(ip) {
  const now = Date.now(), window = 60000, max = config.security.rate_limit_per_min;
  const r = state.rateLimits.get(ip);
  if (!r || now > r.resetAt) {
    state.rateLimits.set(ip, { count: 1, resetAt: now + window });
    return true;
  }
  r.count++;
  return r.count <= max;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, r] of state.rateLimits) { if (now > r.resetAt) state.rateLimits.delete(ip); }
}, 60000);

// ==================== 端口检测 ====================
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

// ==================== GPT-SoVITS 自动启动 ====================
async function autoStartGPT() {
  if (!config.gpt_sovits.auto_start) {
    log('INFO', 'GPT-SoVITS auto_start disabled');
    return false;
  }
  if (await checkPort(config.gpt_sovits.port)) {
    log('INFO', `GPT-SoVITS already running on port ${config.gpt_sovits.port}`);
    return true;
  }

  const searchPaths = config.gpt_sovits.search_paths || [
    'E:\\gpt sovlts\\GPT-SoVITS-v2pro-20250604-nvidia50',
    'E:\\gpt-sovit\\GPT-SoVITS-v2pro-20250604-nvidia50',
  ];

  const refAudio = path.resolve(config.tts.ref_audio_path) ||
    path.join(APP_ROOT, 'models', 'sounds', 'congyu_ref.wav');
  const gptModel = path.join(APP_ROOT, '..', 'model', 'congyu-e15.ckpt');
  const sovitsModel = path.join(APP_ROOT, '..', 'model', 'congyu_e8_s200.pth');

  for (const base of searchPaths) {
    const pythonExe = path.join(base, 'runtime', 'python.exe');
    const apiPy = path.join(base, config.gpt_sovits.api_script || 'api.py');
    if (!fs.existsSync(pythonExe) || !fs.existsSync(apiPy)) continue;

    log('INFO', `Starting GPT-SoVITS from: ${base}`);
    const proc = spawn(pythonExe, [
      apiPy,
      '-a', '127.0.0.1',
      '-p', String(config.gpt_sovits.port),
      '-dr', refAudio,
      '-dt', config.tts.prompt_text || '我輩の名前は村雨。村雨丸の管理者。',
      '-dl', config.tts.prompt_lang || 'ja',
      '-g', gptModel,
      '-s', sovitsModel,
    ], {
      cwd: base,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    proc.stdout.on('data', d => log('GPT', d.toString().trim()));
    proc.stderr.on('data', d => log('GPT', d.toString().trim()));
    proc.on('exit', (code, sig) => {
      log('WARN', `GPT-SoVITS process exited (code=${code} signal=${sig})`);
      state.gptProcess = null;
      state.ttsReady = false;
      // 如果启用了自动重启且非正常关闭, 尝试重启
      if (code !== 0 && sig !== 'SIGTERM' && sig !== 'SIGKILL' && config.gpt_sovits.auto_start && !state.shuttingDown) {
        log('INFO', 'GPT-SoVITS crashed — attempting restart in 5s...');
        setTimeout(() => {
          autoStartGPT().then(ok => {
            if (ok) log('INFO', 'GPT-SoVITS restarted successfully');
          });
        }, 5000);
      }
    });

    state.gptProcess = proc;

    // 等待 GPT-SoVITS 就绪
    const timeout = config.gpt_sovits.startup_timeout_ms || 120000;
    const started = await waitForPort(config.gpt_sovits.port, timeout);
    if (started) {
      log('INFO', 'GPT-SoVITS ready');
      return true;
    }
    log('WARN', `GPT-SoVITS at ${base} failed to start within ${timeout}ms`);
  }

  log('WARN', 'GPT-SoVITS not found or failed to start — TTS unavailable');
  return false;
}

// ==================== TTS 健康检查 ====================
let ttsRestartCount = 0;
const TTS_MAX_RESTARTS = 5;
let ttsHealFailCount = 0;
const TTS_HEAL_FAIL_LIMIT = 3;

// 轻量 HTTP 探测：向 GPT-SoVITS 发送短文本 POST，验证服务真正可用
async function probeTTS() {
  try {
    const refAudio = config.tts.ref_audio_path;
    if (!refAudio || !fs.existsSync(refAudio)) {
      log('WARN', `TTS probe skipped: ref audio missing: ${refAudio || '(empty)'}`);
      return true; // 跳过探测，仅依赖端口检查
    }
    const body = JSON.stringify({
      refer_wav_path: refAudio,
      prompt_text: config.tts.prompt_text || '',
      prompt_language: config.tts.prompt_lang || 'ja',
      text_language: 'auto',
      text: '接续。',
      top_k: 15, top_p: 0.6, temperature: 0.8, speed: 1.0
    });
    const r = await httpReq({
      hostname: config.gpt_sovits.hostname,
      port: config.gpt_sovits.port,
      path: config.gpt_sovits.endpoint,
      method: 'POST',
      timeout: 5000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, body, 5000);
    return r.status === 200 && r.body.length > 500;
  } catch {
    return false;
  }
}

async function checkTTS() {
  try {
    const portOk = await checkPort(config.gpt_sovits.port);
    if (!portOk) {
      if (state.ttsReady) {
        state.ttsReady = false;
        log('WARN', `TTS disconnected (port ${config.gpt_sovits.port} unreachable, restartCount=${ttsRestartCount})`);
        triggerTTSRestart();
      }
      return false;
    }

    // 端口开放后再做一次 HTTP 探测，确认服务真正存活
    const alive = await probeTTS();
    if (!alive) {
      ttsHealFailCount++;
      log('WARN', `TTS probe failed (${ttsHealFailCount}/${TTS_HEAL_FAIL_LIMIT}), port=${config.gpt_sovits.port}`);
      if (ttsHealFailCount >= TTS_HEAL_FAIL_LIMIT) {
        state.ttsReady = false;
        ttsHealFailCount = 0;
        triggerTTSRestart();
      }
      return false;
    }

    ttsHealFailCount = 0;
    if (!state.ttsReady) {
      state.ttsReady = true;
      log('INFO', 'TTS: ✅ (service ready)');
      ttsRestartCount = 0;
    }
    return true;
  } catch (e) {
    if (state.ttsReady) {
      state.ttsReady = false;
      log('WARN', `TTS disconnected: ${e.message}`);
    }
    return false;
  }
}

function triggerTTSRestart() {
  if (ttsRestartCount >= TTS_MAX_RESTARTS || !config.gpt_sovits.auto_start) {
    log('WARN', `TTS restart skipped (count=${ttsRestartCount}/${TTS_MAX_RESTARTS} auto_start=${config.gpt_sovits.auto_start})`);
    return;
  }
  ttsRestartCount++;
  log('INFO', `Attempting GPT-SoVITS restart #${ttsRestartCount}...`);
  autoStartGPT().then(ok => {
    if (ok) {
      ttsRestartCount = 0;
      ttsHealFailCount = 0;
    }
  });
}

// ==================== TTS 生成 ====================
// 检测文本语言：zh（中文）/ ja（日文）/ auto（混合）
function detectTextLang(text) {
  if (!text) return 'auto';
  // 统计中日字符比例
  const cjk = text.match(/[一-鿿]/g);
  const hiragana = text.match(/[぀-ゟ]/g);
  const katakana = text.match(/[゠-ヿ]/g);
  const cjkCount = cjk ? cjk.length : 0;
  const jaCount = (hiragana ? hiragana.length : 0) + (katakana ? katakana.length : 0);
  const total = cjkCount + jaCount;
  if (total === 0) return 'auto';
  // 假名占比 > 30% 判定为日文，否则当作中文处理
  return (jaCount / total) > 0.3 ? 'ja' : 'zh';
}

// ==================== TTS 音频验证 ====================
// 验证生成的音频长度是否与文本长度匹配，检测"句首被截断"问题
function validateAudioBuffer(audioBuf, text) {
  if (!audioBuf || audioBuf.length < 1024) return { valid: false, reason: 'audio too small' };

  // WAV 头部解析
  let durationSec = 0;
  let sampleRate = 24000;
  if (audioBuf.length > 44 && audioBuf.toString('ascii', 0, 4) === 'RIFF') {
    sampleRate = audioBuf.readUInt32LE(24);
    const channels = audioBuf.readUInt16LE(22);
    const bitsPerSample = audioBuf.readUInt16LE(34);
    const dataSize = audioBuf.length - 44;
    const bytesPerSec = sampleRate * channels * (bitsPerSample / 8);
    durationSec = bytesPerSec > 0 ? dataSize / bytesPerSec : 0;
  } else {
    durationSec = audioBuf.length / 48000;
  }

  // 文本长度预估：中日文 TTS 约 3-6 字/秒
  const textLen = text.length;
  const estimatedMinDuration = Math.max(0.3, textLen / 6);
  const estimatedMaxDuration = Math.max(2, textLen / 2);

  if (durationSec < estimatedMinDuration) {
    return {
      valid: false,
      reason: `audio too short for text: ${durationSec.toFixed(1)}s for ${textLen} chars (expected >=${estimatedMinDuration.toFixed(1)}s)`,
      duration: durationSec,
      expected: estimatedMinDuration,
      size: audioBuf.length
    };
  }

  // 检查音频中段是否有实际振幅（非静音）
  if (audioBuf.length > 1000) {
    const dataStart = audioBuf.toString('ascii', 0, 4) === 'RIFF' ? 44 : 0;
    const sampleLen = Math.min(10000, audioBuf.length - dataStart);
    if (sampleLen > 100) {
      let maxAmplitude = 0;
      for (let i = dataStart + Math.floor(sampleLen * 0.3); i < dataStart + Math.floor(sampleLen * 0.7); i += 2) {
        const amp = Math.abs(audioBuf.readInt16LE(i));
        if (amp > maxAmplitude) maxAmplitude = amp;
      }
      if (maxAmplitude < 50) {
        return { valid: false, reason: 'audio appears to be silence', duration: durationSec, size: audioBuf.length };
      }
    }
  }

  return { valid: true, duration: durationSec, size: audioBuf.length };
}

async function localTTS(text, customRef) {
  let refAudio = (customRef?.ref_audio_path) || config.tts.ref_audio_path;
  if (refAudio && !path.isAbsolute(refAudio)) refAudio = path.join(APP_ROOT, refAudio);

  const promptText = customRef?.prompt_text !== undefined ? customRef.prompt_text : config.tts.prompt_text;
  const promptLang = customRef?.prompt_lang || config.tts.prompt_lang;
  // 根据文本内容自动判断语言，回退参数可覆盖
  const textLang = customRef?._text_language || detectTextLang(text);

  if (!refAudio || !fs.existsSync(refAudio)) {
    throw new Error(`ref audio missing: ${refAudio || '(empty)'}`);
  }

  log('INFO', `[TTS] ref=${path.basename(refAudio)} prompt="${(promptText || '').substring(0, 30)}..." lang=${promptLang}/${textLang}`);

  const bodyObj = {
    refer_wav_path: refAudio, prompt_text: promptText || '',
    prompt_language: promptLang, text_language: textLang,
    text: text,
    top_k: config.tts.top_k || 15,
    top_p: customRef?._top_p || config.tts.top_p || 0.6,
    temperature: customRef?._temperature || config.tts.temperature || 0.8,
    speed: config.tts.speed || 1.0,
    // GPT-SoVITS v2Pro 专有参数
    inp_refs: [],
    sample_steps: config.tts.sample_steps || 32,
    if_sr: false,
  };
  // 按语言自动添加标点分段，回退参数可覆盖
  if (customRef?._cut_punc !== undefined) {
    bodyObj.cut_punc = customRef._cut_punc;
  } else if (config.tts.cut_punc) {
    bodyObj.cut_punc = config.tts.cut_punc;
  } else if (textLang === 'zh') {
    bodyObj.cut_punc = '，。！？；';
  } else if (textLang === 'ja') {
    bodyObj.cut_punc = '、。！？';
  }

  const body = JSON.stringify(bodyObj);

  return withRetry(async () => {
    const r = await httpReq({
      hostname: config.gpt_sovits.hostname, port: config.gpt_sovits.port,
      path: config.gpt_sovits.endpoint, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, body, config.tts.timeout_ms);

    // 成功状态码且音频数据大于 1KB 才视为有效（短音频也能通过）
    if (r.status === 200 && r.body.length > 1024) {
      const firstBytes = r.body.slice(0, 10).toString('ascii').toLowerCase();
      if (firstBytes.includes('<!doctype') || firstBytes.includes('<html')) {
        throw new Error('GPT-SoVITS error page');
      }
      // 检查是否是 GPT-SoVITS 的错误响应（JSON 格式错误信息）
      if (r.body.length < 100000) {
        try {
          const jsonErr = JSON.parse(r.body.toString('utf-8'));
          if (jsonErr.error || jsonErr.message) {
            throw new Error(`GPT-SoVITS: ${jsonErr.error || jsonErr.message}`);
          }
        } catch (e) {
          // 不是 JSON，继续检查是否是纯文本错误
          if (e.message.startsWith('GPT-SoVITS:')) throw e;
          const bodyStr = r.body.toString('utf-8', 0, Math.min(r.body.length, 200));
          if (bodyStr.includes('truncated') || bodyStr.includes('error') || bodyStr.includes('Error')) {
            throw new Error(`GPT-SoVITS: ${bodyStr.substring(0, 100)}`);
          }
        }
      }
      return r.body;
    }

    if (r.status === 400) {
      try {
        const err = JSON.parse(r.body.toString());
        throw new Error(err.message || 'GPT-SoVITS 400');
      } catch (e) {
        if (e.message !== 'GPT-SoVITS 400') throw e;
      }
    }

    throw new Error(`GPT-SoVITS ${r.status} size=${r.body.length}`);
  }, config.tts.retry.max_attempts, config.tts.retry.delay_ms);
}

// 短文本补长函数
function padShortText(text) {
  const cleaned = text.trim();
  if (cleaned.length >= 8) return cleaned;  // 足够长，直接返回
  // 短于 8 个字符时，追加一个省略号并重复一次，例如 "嗯" => "嗯…嗯"
  return cleaned + '…' + cleaned;
}

async function generateTTS(text, customRef) {
  // 1. 基础清洗
  const clean = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
                    .replace(/[～~]/g, '')
                    .replace(/\n/g, '。')
                    .trim();
  if (!clean) throw new Error('empty text');

  // 2. 短文本补长，杜绝生成过短音频
  const finalText = padShortText(clean);

  log('INFO', `TTS [Forced Local]: "${finalText.substring(0, 30)}..."`);

  // 如果正在生成中，进入队列
  if (state.ttsLock) {
    log('INFO', `TTS queued: "${finalText.substring(0, 20)}..."`);
    return new Promise((resolve, reject) => {
      state.ttsQueue.push({ text: finalText, customRef, resolve, reject });
    });
  }

  state.ttsLock = true;
  try {
    // 带验证与自动回退的 TTS 生成
    const result = await attemptTTSWithFallback(finalText, customRef);
    // 成功生成后递增计数器并检查是否需要清理 GPU 缓存
    state.ttsGenerationCount++;
    checkGPUCache().catch(e => log('WARN', 'GPU cache check error:', e.message));
    return result;
  } catch (e) {
    log('WARN', 'TTS all attempts failed:', e.message);
    throw e;
  } finally {
    processTTSQueue();
  }
}

// 带验证和自动回退的 TTS 生成（最多尝试 3 次不同参数组合）
const TTS_FALLBACK_CONFIGS = [
  { label: 'standard', params: {} },
  { label: 'fallback#1', params: { _text_language: 'auto', _cut_punc: '' } },
  { label: 'fallback#2', params: { _text_language: 'zh', _temperature: 0.7, _top_p: 0.7 } },
];

async function attemptTTSWithFallback(text, customRef) {
  for (const fb of TTS_FALLBACK_CONFIGS) {
    try {
      log('INFO', `TTS attempt ${fb.label}: "${text.substring(0, 20)}..."`);

      // 将回退参数合并到 customRef 中
      const enhancedRef = { ...(customRef || {}), ...fb.params };

      const audioBuf = await localTTS(text, enhancedRef);

      // 验证生成的音频
      const validation = validateAudioBuffer(audioBuf, text);
      if (validation.valid) {
        log('INFO', `TTS ${fb.label} OK: ${(audioBuf.length / 1024).toFixed(0)}KB, ${validation.duration.toFixed(1)}s`);
        return audioBuf;
      }

      log('WARN', `TTS ${fb.label} validation failed: ${validation.reason}`);
    } catch (e) {
      log('WARN', `TTS ${fb.label} error: ${e.message}`);
    }
  }

  throw new Error(`TTS failed after ${TTS_FALLBACK_CONFIGS.length} parameter combinations`);
}

async function processTTSQueue() {
  if (state.ttsQueue.length === 0) {
    state.ttsLock = false;
    return;
  }
  const { text, customRef, resolve, reject } = state.ttsQueue.shift();
  try {
    const result = await localTTS(text, customRef);
    resolve(result);
  } catch (e) {
    reject(e);
  } finally {
    await processTTSQueue(); // 等队列清空才释放锁
  }
}

// ==================== GPU 信息 ====================
async function getGPUInfo() {
  try {
    const { stdout } = await execPromise('nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader', { timeout: 5000 });
    const parts = stdout.trim().split(',');
    return {
      name: parts[0]?.trim(), vram_used: parts[1]?.trim(),
      vram_total: parts[2]?.trim(), gpu_util: parts[3]?.trim()
    };
  } catch { return null; }
}

// ==================== GPU 缓存管理 ====================
async function getVRAMUsagePercent() {
  try {
    const { stdout } = await execPromise(
      'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits',
      { timeout: 3000 }
    );
    const parts = stdout.trim().split(',');
    const used = parseInt(parts[0]?.trim(), 10);
    const total = parseInt(parts[1]?.trim(), 10);
    if (!total) return 0;
    return (used / total) * 100;
  } catch {
    return -1; // nvidia-smi unavailable
  }
}

async function triggerGPUCacheClear() {
  const cfg = config.gpu_cache;
  if (!cfg.enabled) return false;

  const now = Date.now();
  if (now - state.lastGpuGcTime < cfg.cooldown_ms) {
    log('DEBUG', `GPU GC skipped — in cooldown (${now - state.lastGpuGcTime}ms < ${cfg.cooldown_ms}ms)`);
    return false;
  }

  log('INFO', '🧹 GPU cache clearing triggered — restarting GPT-SoVITS...');
  state.lastGpuGcTime = now;
  state.ttsGenerationCount = 0;

  // Kill GPT-SoVITS process
  if (state.gptProcess) {
    try { state.gptProcess.kill('SIGTERM'); } catch {}
    state.gptProcess = null;
  }
  state.ttsReady = false;

  // Wait for port to be free
  await new Promise(r => setTimeout(r, 3000));

  // Restart GPT-SoVITS (non-blocking)
  autoStartGPT().then(ok => {
    if (ok) {
      log('INFO', '🧹 GPU cache cleared — GPT-SoVITS restarted');
      state.ttsGenerationCount = 0;
    } else {
      log('WARN', '🧹 GPU GC failed to restart GPT-SoVITS');
    }
  });

  return true;
}

async function checkGPUCache() {
  if (!config.gpu_cache?.enabled || state.ttsGenerationCount === 0) return;

  const cfg = config.gpu_cache;

  // Check 1: generation count threshold
  if (state.ttsGenerationCount >= cfg.max_generations) {
    log('INFO', `🧹 GPU GC triggered: ${state.ttsGenerationCount} generations (max=${cfg.max_generations})`);
    await triggerGPUCacheClear();
    return;
  }

  // Check 2: VRAM threshold (only if nvidia-smi available)
  const vramPct = await getVRAMUsagePercent();
  if (vramPct >= 0 && vramPct >= cfg.vram_threshold_percent) {
    log('INFO', `🧹 GPU GC triggered: VRAM at ${vramPct.toFixed(1)}% (threshold=${cfg.vram_threshold_percent}%)`);
    await triggerGPUCacheClear();
  }
}

// ==================== Bug 报告系统 ====================
function generateBugReport(error, context = '') {
  try {
    ensureDir(BUG_REPORTS_DIR);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const mem = process.memoryUsage();
    const filename = `bug_${ts}_${Date.now()}.json`;
    const filepath = path.join(BUG_REPORTS_DIR, filename);

    // 获取最近 50 条日志（错误级别以上优先）
    const recent = recentLogs.slice(-50).map(l => `${l.icon} [${l.ts}] [${l.level}] ${l.msg}${l.formatted ? ' ' + l.formatted : ''}`);

    const report = {
      timestamp: new Date().toISOString(),
      context: context || 'unknown',
      error: {
        message: error?.message || String(error),
        stack: error?.stack || null,
        code: error?.code || null
      },
      server: {
        uptime_ms: Date.now() - state.startTime,
        request_count: state.requestCount,
        tts_ready: state.ttsReady,
        tts_generation_count: state.ttsGenerationCount,
        tts_queue_length: state.ttsQueue.length,
        last_error: state.lastError
      },
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
        heap_total: Math.round(mem.heapTotal / 1024 / 1024) + 'MB',
        heap_used: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
        external: Math.round(mem.external / 1024 / 1024) + 'MB',
        array_buffers: Math.round((mem.arrayBuffers || 0) / 1024 / 1024) + 'MB'
      },
      config: {
        tts_mode: config.tts.mode,
        tts_ref_audio: config.tts.ref_audio_path,
        gpt_sovits: `${config.gpt_sovits.hostname}:${config.gpt_sovits.port}`,
        gpu_cache_enabled: config.gpu_cache?.enabled,
        gpu_cache_max_gen: config.gpu_cache?.max_generations
        // 注意：不包含 token/api_key 等敏感信息
      },
      recent_logs: recent
    };

    fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf-8');

    // 自动清理旧报告：保留最近 50 个
    try {
      const files = fs.readdirSync(BUG_REPORTS_DIR)
        .filter(f => f.startsWith('bug_') && f.endsWith('.json'))
        .map(f => ({ name: f, path: path.join(BUG_REPORTS_DIR, f), mtime: fs.statSync(path.join(BUG_REPORTS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      for (let i = 50; i < files.length; i++) {
        try { fs.unlinkSync(files[i].path); } catch {}
      }
    } catch {}

    log('INFO', `🐛 Bug report saved: ${filename}`);
    return filename;
  } catch (e) {
    log('ERROR', 'Failed to generate bug report:', e.message);
    return null;
  }
}

// ==================== 动态内存清理 ====================
function cleanMemory() {
  const before = process.memoryUsage();
  let freed = 0;

  // 1. 限制 TTS 队列长度（最多保留 10 个待处理）
  while (state.ttsQueue.length > 10) {
    const dropped = state.ttsQueue.shift();
    if (dropped?.reject) dropped.reject(new Error('Queue overflow — dropped'));
    freed++;
  }
  if (freed) log('INFO', `🧹 Cleaned ${freed} stale TTS queue items`);

  // 2. 清理过期的限流记录（超过 2 分钟无活动的）
  const now = Date.now();
  let rateFreed = 0;
  for (const [ip, r] of state.rateLimits) {
    if (now > r.resetAt + 60000) { state.rateLimits.delete(ip); rateFreed++; }
  }
  if (rateFreed) log('DEBUG', `🧹 Cleaned ${rateFreed} stale rate limit entries`);

  // 3. 尝试触发 V8 GC（如果 Node 以 --expose-gc 启动）
  if (global.gc) {
    global.gc();
    const after = process.memoryUsage();
    const saved = Math.max(0, before.heapUsed - after.heapUsed);
    log('INFO', `🧹 V8 GC: ${Math.round(saved / 1024 / 1024)}MB freed (heap: ${Math.round(before.heapUsed / 1024 / 1024)}MB → ${Math.round(after.heapUsed / 1024 / 1024)}MB)`);
  }

  // 4. 记录当前内存状态
  const afterMem = process.memoryUsage();
  return {
    before: { rss: Math.round(before.rss / 1024 / 1024) + 'MB', heap: Math.round(before.heapUsed / 1024 / 1024) + 'MB' },
    after: { rss: Math.round(afterMem.rss / 1024 / 1024) + 'MB', heap: Math.round(afterMem.heapUsed / 1024 / 1024) + 'MB' },
    queue_freed: freed,
    rate_freed: rateFreed
  };
}

// 定时内存清理 + 监控
function startMemoryManagement() {
  // 每 5 分钟主动清理一次
  setInterval(() => {
    try { cleanMemory(); } catch (e) { log('WARN', 'Memory cleanup error:', e.message); }
  }, 300000);

  // 每 60 秒记录内存状态（仅当 heap 超过 200MB 时告警）
  setInterval(() => {
    const mem = process.memoryUsage();
    if (mem.heapUsed > 200 * 1024 * 1024) {
      log('WARN', `📊 Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB heap (warning: >200MB)`);
    }
  }, 60000);
}

// ==================== 音频 GC ====================
function gcAudio() {
  if (!fs.existsSync(AUDIO_DIR)) return;
  const now = Date.now();
  const files = fs.readdirSync(AUDIO_DIR)
    .filter(f => f.startsWith('tts_'))
    .map(f => ({ n: f, p: path.join(AUDIO_DIR, f), t: fs.statSync(path.join(AUDIO_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  let del = 0;
  for (let i = 0; i < files.length; i++) {
    if (i >= config.audio.max_files || now - files[i].t > config.audio.max_age_ms) {
      try { fs.unlinkSync(files[i].p); del++; } catch (e) { log('DEBUG', `GC unlink error: ${e.message}`); }
    }
  }
  if (del) log('DEBUG', `GC ${del} audio files`);
}

// ==================== 响应工具 ====================
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
    if (size > config.security.max_body_size) { aborted = true; req.destroy(); return; }
    chunks.push(c);
  });
  const done = () => Buffer.concat(chunks).toString('utf-8');
  const onError = (e) => {
    if (e) log('WARN', `collectBody error (aborted=${aborted}): ${e.message}`);
    if (cb) cb('');
  };
  if (cb) {
    req.on('end', () => { if (!aborted) cb(done()); else log('WARN', 'collectBody aborted after ' + size + ' bytes'); });
    req.on('error', onError);
  } else {
    return new Promise(resolve => {
      req.on('end', () => { if (!aborted) resolve(done()); else resolve(''); });
      req.on('error', onError);
    });
  }
}

// ==================== 路由处理器 ====================
const handlers = {
  'GET /api/health': async (req, res) => {
    const gpu = await getGPUInfo();
    sendJSON(res, {
      status: state.shuttingDown ? 'stopping' : 'ok',
      uptime_ms: Date.now() - state.startTime,
      tts: { mode: config.tts.mode, ready: state.ttsReady, generation_count: state.ttsGenerationCount },
      gpt_sovits: config.gpt_sovits,
      gpu_cache: {
        enabled: config.gpu_cache?.enabled || false,
        generation_count: state.ttsGenerationCount,
        max_generations: config.gpu_cache?.max_generations || 8,
        last_gc_ms_ago: state.lastGpuGcTime ? Date.now() - state.lastGpuGcTime : -1
      },
      ollama: { ready: state.ollamaReady, model: config.ollama.model, cuda: config.ollama.cuda_enabled },
      gpu, requests: state.requestCount, version: '3.4'
    });
  },

  'POST /api/tts': (req, res) => collectBody(req, async body => {
    try {
      const d = JSON.parse(body);
      const text = (d.text || '').trim();
      if (!text) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'missing text');
      // TTS 文本长度限制
      if (text.length > MAX_TTS_TEXT_LENGTH) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 
          `TTS text too long: ${text.length} chars (max ${MAX_TTS_TEXT_LENGTH})`);
      }
      if (Buffer.byteLength(text, 'utf-8') > MAX_TTS_TEXT_BYTES) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 
          `TTS text too large: ${Buffer.byteLength(text, 'utf-8')} bytes (max ${MAX_TTS_TEXT_BYTES})`);
      }


      const customRef = {};
      if (d.ref_audio_path) customRef.ref_audio_path = d.ref_audio_path;
      if (d.prompt_text) customRef.prompt_text = d.prompt_text;
      if (d.prompt_lang) customRef.prompt_lang = d.prompt_lang;
      if (d.text_lang) customRef.text_lang = d.text_lang;
      if (customRef.ref_audio_path && !path.isAbsolute(customRef.ref_audio_path)) {
        customRef.ref_audio_path = path.join(APP_ROOT, customRef.ref_audio_path);
      }

      log('INFO', `[TTS] "${text.substring(0, 30)}..." custom=${Object.keys(customRef).length > 0} audioDir=${AUDIO_DIR}`);
      const buf = await generateTTS(text, Object.keys(customRef).length > 0 ? customRef : null);

      // 最终安全校验（实际上前面已经做了）
      if (!buf || buf.length <= 500) throw new Error(`invalid audio size=${buf ? buf.length : 'null'}`);
      const firstBytes = buf.slice(0, 10).toString('ascii').toLowerCase();
      if (firstBytes.includes('<!doctype') || firstBytes.includes('<html')) throw new Error('GPT-SoVITS error page');

      ensureDir(AUDIO_DIR);
      const fn = `tts_${Date.now()}.wav`;
      fs.writeFileSync(path.join(AUDIO_DIR, fn), buf);

      sendAudio(res, buf);
    } catch (e) {
      log('ERROR', 'TTS fail:', e.message);
      generateBugReport(e, 'POST /api/tts');
      // TTS 请求失败时立即触发健康检查，加速崩溃检测
      if (e.message && (e.message.includes('timeout') || e.message.includes('ECONNREFUSED') || e.message.includes('ECONNRESET'))) {
        log('WARN', 'TTS request failed — scheduling immediate health check');
        setImmediate(() => checkTTS());
      }
      sendError(res, HTTP_STATUS.SERVER_ERROR, 'TTS failed');
    }
  }),

  'POST /api/tts-generate': (req, res) => collectBody(req, async body => {
    try {
      const { text } = JSON.parse(body);
      if (!text) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'missing text');
      // TTS 文本长度限制
      if (text.length > MAX_TTS_TEXT_LENGTH) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 
          `TTS text too long: ${text.length} chars (max ${MAX_TTS_TEXT_LENGTH})`);
      }
      if (Buffer.byteLength(text, 'utf-8') > MAX_TTS_TEXT_BYTES) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 
          `TTS text too large: ${Buffer.byteLength(text, 'utf-8')} bytes (max ${MAX_TTS_TEXT_BYTES})`);
      }

      const buf = await generateTTS(text);
      if (!buf || buf.length <= 500) throw new Error(`invalid audio size=${buf ? buf.length : 'null'}`);
      const firstBytes = buf.slice(0, 10).toString('ascii').toLowerCase();
      if (firstBytes.includes('<!doctype') || firstBytes.includes('<html')) throw new Error('GPT-SoVITS error page');
      ensureDir(AUDIO_DIR);
      const fn = `tts_${Date.now()}.wav`;
      fs.writeFileSync(path.join(AUDIO_DIR, fn), buf);
      sendJSON(res, { success: true, audio_url: `/audio/${fn}` });
    } catch (e) {
      log('ERROR', 'TTS generate fail:', e.message);
      generateBugReport(e, 'POST /api/tts-generate');
      sendError(res, HTTP_STATUS.SERVER_ERROR, e.message);
    }
  }),

  'GET /api/tts-config': (req, res) => sendJSON(res, {
    config: { ref_audio_path: config.tts.ref_audio_path, prompt_text: config.tts.prompt_text, prompt_lang: config.tts.prompt_lang, text_lang: config.tts.text_lang, top_k: config.tts.top_k, top_p: config.tts.top_p, temperature: config.tts.temperature, speed: config.tts.speed, cut_punc: config.tts.cut_punc },
    mode: config.tts.mode, ready: state.ttsReady, gpt_sovits: config.gpt_sovits
  }),

  'POST /api/tts-config': (req, res) => collectBody(req, body => {
    try {
      const d = JSON.parse(body);
      if (d.prompt_text !== undefined) config.tts.prompt_text = d.prompt_text;
      if (d.prompt_lang !== undefined) config.tts.prompt_lang = d.prompt_lang;
      if (d.text_lang !== undefined) config.tts.text_lang = d.text_lang;
      if (d.ref_audio_path !== undefined) config.tts.ref_audio_path = d.ref_audio_path;
      if (d.top_k !== undefined) config.tts.top_k = d.top_k;
      if (d.top_p !== undefined) config.tts.top_p = d.top_p;
      if (d.temperature !== undefined) config.tts.temperature = d.temperature;
      if (d.speed !== undefined) config.tts.speed = d.speed;
      if (d.cut_punc !== undefined) config.tts.cut_punc = d.cut_punc;
      if (d.ref_audio_path && !path.isAbsolute(d.ref_audio_path)) {
        config.tts.ref_audio_path = path.join(APP_ROOT, d.ref_audio_path);
      }
      log('INFO', 'TTS config saved:', JSON.stringify({ ref: config.tts.ref_audio_path, prompt: config.tts.prompt_text?.substring(0, 20), lang: config.tts.prompt_lang }));
      saveConfig(config);
      sendJSON(res, { success: true, config: { ref_audio_path: config.tts.ref_audio_path, prompt_text: config.tts.prompt_text, prompt_lang: config.tts.prompt_lang, text_lang: config.tts.text_lang, top_k: config.tts.top_k, top_p: config.tts.top_p, temperature: config.tts.temperature, speed: config.tts.speed, cut_punc: config.tts.cut_punc } });
    } catch (e) { sendError(res, HTTP_STATUS.BAD_REQUEST, e.message); }
  }),

  'GET /api/tts-mode': (req, res) => sendJSON(res, { mode: config.tts.mode, ready: state.ttsReady }),
  'POST /api/tts-mode': (req, res) => collectBody(req, body => {
    try {
      const { mode } = JSON.parse(body);
      if (!['local', 'system', 'cloud'].includes(mode)) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid');
      config.tts.mode = mode;
      saveConfig(config);
      sendJSON(res, { success: true, mode });
    } catch (e) { sendError(res, HTTP_STATUS.BAD_REQUEST, e.message); }
  }),

  'GET /api/gpt-sovits-config': (req, res) => sendJSON(res, { config: config.gpt_sovits }),
  'POST /api/gpt-sovits-config': (req, res) => collectBody(req, body => {
    try {
      const d = JSON.parse(body);
      if (d.hostname) config.gpt_sovits.hostname = d.hostname;
      if (d.port) config.gpt_sovits.port = d.port;
      if (d.endpoint) config.gpt_sovits.endpoint = d.endpoint;
      saveConfig(config);
      sendJSON(res, { success: true });
    } catch (e) { sendError(res, HTTP_STATUS.BAD_REQUEST, e.message); }
  }),

  'GET /api/chat-mode': (req, res) => sendJSON(res, { mode: 'qclaw' }),
  'POST /api/chat-mode': (req, res) => collectBody(req, body => {
    try {
      const { mode } = JSON.parse(body);
      sendJSON(res, { success: true, mode: mode || 'qclaw' });
    } catch (e) { sendError(res, HTTP_STATUS.BAD_REQUEST, e.message); }
  }),

  'GET /api/ref-audio-list': (req, res) => {
    const refDir = path.join(APP_ROOT, 'ref_audio');
    const audioDir = AUDIO_DIR;
    const files = [];
    [refDir, audioDir].forEach(dir => {
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).filter(f => f.endsWith('.wav') || f.endsWith('.mp3')).forEach(f => {
          const p = path.join(dir, f);
          const stat = fs.statSync(p);
          files.push({ name: f, path: p, size: stat.size, mtime: stat.mtimeMs, dir: dir === refDir ? 'ref_audio' : 'audio' });
        });
      }
    });
    sendJSON(res, { files, current: { ref_audio_path: config.tts.ref_audio_path, prompt_text: config.tts.prompt_text, prompt_lang: config.tts.prompt_lang, text_lang: config.tts.text_lang } });
  },

  'GET /api/config-reload': (req, res) => {
    try {
      config = loadConfig();
      log('INFO', 'Config reloaded from disk');
      sendJSON(res, { success: true, version: '3.3' });
    } catch (e) {
      log('ERROR', 'Config reload failed', e);
      sendError(res, HTTP_STATUS.SERVER_ERROR, 'config reload failed');
    }
  },

  'POST /api/upload-file': handleUpload,
  'POST /api/upload-audio': handleUpload,

  'GET /api/tts-latest': (req, res) => {
    // 返回最新的 TTS 音频 URL（JSON 格式）
    try {
      if (!fs.existsSync(AUDIO_DIR)) {
        return sendJSON(res, { audio_url: null, error: 'No audio generated yet' });
      }
      const files = fs.readdirSync(AUDIO_DIR)
        .filter(f => f.startsWith('tts_') && f.endsWith('.wav'))
        .map(f => ({ name: f, path: path.join(AUDIO_DIR, f), mtime: fs.statSync(path.join(AUDIO_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length === 0) {
        return sendJSON(res, { audio_url: null, error: 'No audio generated yet' });
      }

      const latest = files[0];
      sendJSON(res, { audio_url: '/audio/' + latest.name });
    } catch (e) {
      log('ERROR', 'TTS latest error:', e.message);
      sendJSON(res, { audio_url: null, error: e.message });
    }
  },

  'POST /api/tts-gc': async (req, res) => {
    try {
      const ok = await triggerGPUCacheClear();
      sendJSON(res, {
        success: ok,
        message: ok ? 'GPU cache clearing triggered' : 'GPU cache management disabled',
        generation_count: state.ttsGenerationCount
      });
    } catch (e) {
      log('ERROR', 'TTS GC error:', e.message);
      sendError(res, HTTP_STATUS.SERVER_ERROR, e.message);
    }
  },

  'GET /api/tts-gc-status': (req, res) => {
    sendJSON(res, {
      generation_count: state.ttsGenerationCount,
      max_generations: config.gpu_cache?.max_generations || 8,
      vram_threshold: config.gpu_cache?.vram_threshold_percent || 85,
      enabled: config.gpu_cache?.enabled || false,
      last_gc_ms: state.lastGpuGcTime ? Date.now() - state.lastGpuGcTime : -1,
      cooldown_ms: config.gpu_cache?.cooldown_ms || 30000
    });
  },

  'GET /api/bug-reports': (req, res) => {
    try {
      if (!fs.existsSync(BUG_REPORTS_DIR)) {
        return sendJSON(res, { reports: [] });
      }
      const files = fs.readdirSync(BUG_REPORTS_DIR)
        .filter(f => f.startsWith('bug_') && f.endsWith('.json'))
        .map(f => {
          const fp = path.join(BUG_REPORTS_DIR, f);
          const stat = fs.statSync(fp);
          try {
            const content = JSON.parse(fs.readFileSync(fp, 'utf-8'));
            return {
              filename: f,
              timestamp: content.timestamp,
              context: content.context,
              error_message: content.error?.message,
              error_code: content.error?.code,
              memory: content.memory,
              size: stat.size,
              mtime: stat.mtimeMs
            };
          } catch {
            return { filename: f, size: stat.size, mtime: stat.mtimeMs };
          }
        })
        .sort((a, b) => b.mtime - a.mtime);

      sendJSON(res, { reports: files, count: files.length });
    } catch (e) {
      log('ERROR', 'Bug reports list error:', e.message);
      sendError(res, HTTP_STATUS.SERVER_ERROR, e.message);
    }
  },

  'GET /api/bug-reports/:filename': (req, res) => {
    // Handled via dynamic route check below
    sendError(res, HTTP_STATUS.NOT_FOUND, 'use /api/bug-report?file=...');
  },

  'POST /api/clean-memory': (req, res) => {
    // 不等待 GC 完成，先返回再后台清理
    const result = cleanMemory();
    sendJSON(res, {
      success: true,
      before: result.before,
      after: result.after,
      queue_freed: result.queue_freed,
      rate_freed: result.rate_freed
    });
  },

  'GET /api/bug-report': (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const file = url.searchParams.get('file');
      if (!file || file.includes('..')) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid file');
      const fp = path.join(BUG_REPORTS_DIR, path.basename(file));
      if (!fs.existsSync(fp)) return sendError(res, HTTP_STATUS.NOT_FOUND, 'report not found');
      const content = JSON.parse(fs.readFileSync(fp, 'utf-8'));
      sendJSON(res, content);
    } catch (e) {
      log('ERROR', 'Bug report read error:', e.message);
      sendError(res, HTTP_STATUS.SERVER_ERROR, e.message);
    }
  }
};

function handleUpload(req, res) {
  const chunks = [];
  let size = 0;
  const MAX = 50 * 1024 * 1024;
  req.on('data', c => {
    size += c.length;
    if (size > MAX) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    try {
      const ct = req.headers['content-type'] || '';
      const extMap = {
        'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg',
        'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
        'text/plain': 'txt', 'application/pdf': 'pdf',
        'application/zip': 'zip', 'application/x-rar-compressed': 'rar'
      };
      const ext = extMap[ct] || 'bin';
      const uploadDir = path.join(APP_ROOT, 'uploads');
      ensureDir(uploadDir);
      const filename = `file_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filepath = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, Buffer.concat(chunks));
      log('INFO', `File uploaded: ${filepath} (${size}B)`);
      sendJSON(res, { success: true, path: filepath, filename, url: `/uploads/${filename}`, size });
    } catch (e) { log('ERROR', 'upload failed:', e.message); sendError(res, HTTP_STATUS.SERVER_ERROR, 'upload failed'); }
  });
}

// ==================== 代理函数 ====================
function proxyRequest(req, res, targetUrl, path, body, headers = {}) {
  const u = new URL(targetUrl);
  const p = http.request({
    hostname: u.hostname, port: u.port, path, method: req.method,
    headers: { ...req.headers, ...headers }, timeout: 120000
  }, pr => {
    sendCORS(res);
    if (pr.headers['content-type']?.includes('text/event-stream')) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
    } else {
      Object.entries(pr.headers).forEach(([k, v]) => res.setHeader(k, v));
    }
    res.writeHead(pr.statusCode);
    pr.pipe(res).on('error', () => { try { res.end(); } catch {} });
  });
  p.on('error', (e) => { log('WARN', `Proxy error [${req.method} ${req.url}]: ${e.message}`); sendError(res, HTTP_STATUS.BAD_GATEWAY, 'proxy error'); });
  p.on('timeout', () => { log('WARN', `Proxy timeout [${req.method} ${req.url}]`); p.destroy(); sendError(res, HTTP_STATUS.GATEWAY_TIMEOUT, 'proxy timeout'); });
  if (body) p.write(body);
  req.pipe(p);
}

function proxyChat(req, res, body) {
  try {
    const d = JSON.parse(body);
    const msgs = [{ role: 'system', content: config.system_prompt }, ...(d.messages || []).filter(m => m.role !== 'system')];
    const reqBody = JSON.stringify({ ...d, messages: msgs });
    proxyRequest(req, res, config.gateway.url, '/v1/chat/completions', reqBody, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(reqBody),
      'Authorization': `Bearer ${config.gateway.token}`
    });
  } catch { sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid json'); }
}

function proxyOllama(req, res, body) {
  try {
    const d = JSON.parse(body);
    if (d.model === 'qwen3.5') d.model = 'qwen2.5:latest';
    if (!d.max_tokens || d.max_tokens > 512) d.max_tokens = 512;
    if (d.temperature > 1) d.temperature = 0.8;
    const msgs = [{ role: 'system', content: config.system_prompt }, ...(d.messages || []).filter(m => m.role !== 'system')];
    if (msgs.length > 7) msgs.splice(1, msgs.length - 7);
    const reqBody = JSON.stringify({ ...d, messages: msgs });
    proxyRequest(req, res, `http://127.0.0.1:${config.ollama.port}`, '/v1/chat/completions', reqBody, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(reqBody)
    });
  } catch { sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid json'); }
}

function proxyOllamaModels(req, res) {
  httpReq({ hostname: '127.0.0.1', port: config.ollama.port, path: '/api/tags', method: 'GET', timeout: 5000 })
    .then(r => sendJSON(res, JSON.parse(r.body.toString()), r.status))
    .catch(() => sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'ollama not running'));
}

// ==================== 静态文件服务 ====================
function serveStatic(req, res) {
  let fp = req.url.split('?')[0];
  if (fp === '/') fp = '/index.html';
  const full = path.resolve(APP_ROOT, '.' + fp);
  if (!full.startsWith(path.resolve(APP_ROOT))) {
    return sendError(res, HTTP_STATUS.FORBIDDEN, 'forbidden');
  }
  const ct = MIME_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream';
  fs.stat(full, (err, st) => {
    if (err) return sendError(res, HTTP_STATUS.NOT_FOUND, 'not found');
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : st.size - 1;
      res.writeHead(HTTP_STATUS.PARTIAL_CONTENT, {
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': ct
      });
      fs.createReadStream(full, { start, end }).pipe(res).on('error', (e) => { log('WARN', `Stream error (range): ${e.message}`); try { res.end(); } catch {} });
    } else {
      res.writeHead(HTTP_STATUS.OK, { 'Content-Length': st.size, 'Content-Type': ct });
      fs.createReadStream(full).pipe(res).on('error', (e) => { log('WARN', `Stream error: ${e.message}`); try { res.end(); } catch {} });
    }
  });
}

// ==================== 主服务器 ====================
const server = http.createServer(async (req, res) => {
  const startTime = Date.now();

  if (state.shuttingDown) {
    res.writeHead(HTTP_STATUS.SERVICE_UNAVAILABLE);
    res.end('shutting down');
    logReq(req, HTTP_STATUS.SERVICE_UNAVAILABLE, Date.now() - startTime);
    return;
  }

  const url = req.url.split('?')[0];
  state.requestCount++;

  if (req.method === 'OPTIONS') {
    res.writeHead(HTTP_STATUS.NO_CONTENT, CORS_HEADERS);
    res.end();
    return;
  }

  // 限流检查（跳过 /api/tts-latest 轮询，避免耗尽配额）
  if (url !== '/api/tts-latest') {
    const ip = req.connection?.remoteAddress || 'unknown';
    if (!checkRate(ip)) {
      log('WARN', `Rate limit exceeded for ${ip}: ${req.method} ${url}`);
      sendError(res, HTTP_STATUS.RATE_LIMIT, 'rate limit exceeded');
      logReq(req, HTTP_STATUS.RATE_LIMIT, Date.now() - startTime);
      return;
    }
  }

  const key = `${req.method} ${url}`;
  const handler = handlers[key];
  if (handler) {
    let status = HTTP_STATUS.OK;
    // 包装 res 以捕获状态码
    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = function(code, ...args) { status = code; return origWriteHead(code, ...args); };
    try {
      await handler(req, res);
    } catch (e) {
      log('ERROR', `Handler error: ${req.method} ${url}`, e);
      generateBugReport(e, `handler:${req.method}:${url}`);
      sendError(res, HTTP_STATUS.SERVER_ERROR, 'handler error');
      status = HTTP_STATUS.SERVER_ERROR;
    }
    // 跳过静态文件的日志(太多)
    if (!url.startsWith('/') || url === '/' || url.startsWith('/api/')) {
      logReq(req, status, Date.now() - startTime);
    }
    return;
  }

  // 特殊路由
  if (url.startsWith('/audio/') && req.method === 'GET') {
    const filename = url.replace('/audio/', '').split('?')[0];
    if (filename.includes('..')) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid');
    const fp = path.join(AUDIO_DIR, filename);
    if (!fs.existsSync(fp)) return sendError(res, HTTP_STATUS.NOT_FOUND, 'audio not found');
    const buf = fs.readFileSync(fp);
    res.writeHead(HTTP_STATUS.OK, { 'Content-Type': 'audio/wav', 'Content-Length': buf.length });
    return res.end(buf);
  }
  if (url === '/api/gateway/v1/chat/completions' && req.method === 'POST') {
    return collectBody(req, body => proxyChat(req, res, body));
  }
  if (url === '/api/ollama/v1/chat/completions' && req.method === 'POST') {
    return collectBody(req, body => proxyOllama(req, res, body));
  }
  if (url === '/api/ollama/models' && req.method === 'GET') {
    return proxyOllamaModels(req, res);
  }
  if (url.startsWith('/api/gateway/')) {
    const tp = url.replace('/api/gateway', '');
    const q = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
    return proxyRequest(req, res, config.gateway.url, `${tp}${q}`, null, { 'Authorization': `Bearer ${config.gateway.token}` });
  }

  serveStatic(req, res);
});

// ==================== 优雅关闭 ====================
async function shutdown(sig) {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  log('INFO', `Shutting down (${sig})...`);
  server.close(() => log('INFO', 'Server closed'));
  if (healthTimer) clearInterval(healthTimer);
  if (state.gptProcess) { try { state.gptProcess.kill(); } catch {} state.gptProcess = null; }
  await new Promise(r => setTimeout(r, 2000));
  log('INFO', 'Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', e => {
  log('ERROR', 'Uncaught exception', e);
  state.lastError = { message: e.message, code: e.code, time: new Date().toISOString() };
  generateBugReport(e, 'uncaughtException');
  // 网络连接错误不需要重启服务器
  if (['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED', 'EADDRINUSE', 'EACCES'].includes(e.code)) {
    log('WARN', `Network error (${e.code}) — ignored, server continues`);
    return;
  }
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (reason, promise) => {
  log('ERROR', 'Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
  generateBugReport(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection');
});

// ==================== 启动 ====================
let healthTimer = null;

async function start() {
  const isElectron = process.env.ELECTRON_MODE === '1';
  const portInUse = !(await isPortFree(config.server.port));

  if (portInUse) {
    if (isElectron) {
      // Electron 模式: 端口被占用可能是旧进程残留, 先尝试杀死
      log('WARN', `Port ${config.server.port} in use — attempting to kill old process`);
      await killPort(config.server.port);
      // 再次检查端口是否释放
      const stillInUse = !(await isPortFree(config.server.port));
      if (stillInUse) {
        log('ERROR', `Port ${config.server.port} still in use after kill — using existing instance`);
        log('INFO', '✅ Server ready (using existing instance)');
        return;
      }
    } else {
      log('INFO', `Port ${config.server.port} in use, cleaning...`);
      await killPort(config.server.port);
    }
  }

  server.listen(config.server.port, config.server.host, () => {
    log('INFO', '🌸 丛雨 Live2D v3.3');
    log('INFO', `   http://${config.server.host}:${config.server.port}/`);
    log('INFO', `   TTS: ${config.tts.mode} | GPT-SoVITS: ${config.gpt_sovits.hostname}:${config.gpt_sovits.port}${config.gpt_sovits.endpoint}`);
  });

  await autoStartGPT();
  await checkTTS();
  healthTimer = setInterval(checkTTS, 10000);

  setTimeout(async () => {
    try {
      const r = await httpReq({ hostname: '127.0.0.1', port: config.ollama.port, path: '/api/tags', method: 'GET', timeout: 5000 });
      const { models } = JSON.parse(r.body.toString());
      if (models?.length) {
        state.ollamaReady = true;
        log('INFO', 'Ollama:', models.map(m => m.name).join(', '));
      }
    } catch { log('WARN', 'Ollama not running'); }
  }, 1000);

  setInterval(gcAudio, 300000);
  gcAudio();
  startMemoryManagement();
  log('INFO', '✅ Server ready');
}

start().catch(e => { log('ERROR', 'Start failed:', e.message); process.exit(1); });