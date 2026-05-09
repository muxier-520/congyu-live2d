/**

 * 丛雨 Live2D 后端服务器 v3.1

 *

 * v3.1 优化:

 * - 添加 fetchWithTimeout (解决 UI 卡死问题)

 * - 重构路由系统 (Router 类替代 if-else 链)

 * - 统一错误处理和响应格式

 * - 提取常量 (MIME、HTTP 状态码)

 * - 简化代理逻辑

 */



const http = require('http');

const fs = require('fs');

const path = require('path');

const net = require('net');

const { parse: parseUrl } = require('url');

const { spawn, exec } = require('child_process');

const { tmpdir } = require('os');

const { promisify } = require('util');

const execPromise = promisify(exec);



const APP_ROOT = __dirname;

const CONFIG_PATH = path.join(APP_ROOT, 'config.json');
const memoryStore = require('./js/memory-store');




// Audio output directory - must be OUTSIDE asar (asar is read-only!)

// When running from asar, use a temp directory for audio output

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
    hostname: '127.0.0.1', port: 9880, endpoint: '/', startup_timeout_ms: 120000,
    gpt_model: '', sovits_model: ''
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

  security: { max_body_size: 1048576, rate_limit_per_min: 60, tts_rate_limit_per_min: 30 }

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

  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf-8'); } catch {}

}



// ==================== 运行时状态 ====================

const state = {

  ttsReady: false, ollamaReady: false, shuttingDown: false,

  startTime: Date.now(), requestCount: 0, lastError: null,

  rateLimits: new Map(),

  ttsRateLimits: new Map(),

  ttsLock: false, ttsQueue: [],

  ttsInFlight: new Map(), latestAudioUrl: null // TTS dedup

};



let config = loadConfig();



// ==================== 日志 ====================

function log(level, msg, ...args) {

  const icons = { ERROR: '❌', WARN: '⚠️', INFO: 'ℹ️', DEBUG: '🔍' };

  console.log(`${icons[level] || ''} [${new Date().toISOString()}] [${level}] ${msg}`, ...args);

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

      try { await execPromise(`taskkill /F /PID ${pid}`); log('INFO', `Killed PID ${pid} on port ${port}`); } catch {}

    }

    if (pids.size) await new Promise(r => setTimeout(r, 1000));

  } catch {}

}



// FIX: 带超时的 HTTP 请求（解决 UI 卡死问题）

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



// FIX: 带超时的 fetch 包装（前端调用用）

async function fetchWithTimeout(url, options = {}, timeout = 10000) {

  const controller = new AbortController();

  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {

    const response = await fetch(url, { ...options, signal: controller.signal });

    clearTimeout(timeoutId);

    return response;

  } catch (err) {

    clearTimeout(timeoutId);

    throw err;

  }

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



// TTS 请求独立限流器（避免预生成 + 正式请求耗尽配额）

function checkTTSPerIP(ip) {

  const now = Date.now(), window = 60000, max = config.security.tts_rate_limit_per_min;

  const r = state.ttsRateLimits.get(ip);

  if (!r || now > r.resetAt) {

    state.ttsRateLimits.set(ip, { count: 1, resetAt: now + window });

    return true;

  }

  r.count++;

  return r.count <= max;

}



setInterval(() => {

  const now = Date.now();

  for (const [ip, r] of state.rateLimits) { if (now > r.resetAt) state.rateLimits.delete(ip); }

  for (const [ip, r] of state.ttsRateLimits) { if (now > r.resetAt) state.ttsRateLimits.delete(ip); }

}, 60000);



// ==================== 端口检测 ====================

function checkPort(port, host = '127.0.0.1') {

  return new Promise(resolve => {

    const s = net.createConnection(port, host, () => { s.destroy(); resolve(true); });

    s.on('error', () => resolve(false));

    s.setTimeout(2000, () => { s.destroy(); resolve(false); });

  });

}



// ==================== TTS 健康检查 ====================

async function checkTTS() {

  try {

    // 第一层：TCP 端口检测（快速，无副作用）
    const portOk = await checkPort(config.gpt_sovits.port);
    if (!portOk) {
      if (state.ttsReady) { state.ttsReady = false; log('WARN', 'TTS disconnected'); }
      return false;
    }

    // 第二层：HTTP API 检测（确认 API 实际可用）
    const r = await httpReq({
      hostname: config.gpt_sovits.hostname, port: config.gpt_sovits.port,
      path: '/change_refer', method: 'GET',
      headers: {}
    }, null, 5000);

    // 200=成功, 400=缺少参数 — 都说明 API 在线
    const apiOk = r.status >= 200 && r.status < 600;
    if (apiOk !== state.ttsReady) { state.ttsReady = apiOk; log('INFO', `TTS: ${apiOk ? '✅' : '❌'} (HTTP ${r.status})`); }
    return apiOk;

  } catch {

    if (state.ttsReady) { state.ttsReady = false; log('WARN', 'TTS disconnected'); }

    return false;

  }

}



// ==================== 模型加载 ====================

async function loadGPTSoVITSModel() {
  const gptModel = config.gpt_sovits.gpt_model;
  const sovitsModel = config.gpt_sovits.sovits_model;
  if (!gptModel || !sovitsModel) { log('WARN', '[TTS] Model paths not configured, skipping model load'); return false; }

  try {
    const body = JSON.stringify({ gpt_model_path: gptModel, sovits_model_path: sovitsModel });
    const r = await httpReq({
      hostname: config.gpt_sovits.hostname, port: config.gpt_sovits.port,
      path: '/set_model', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, body, 120000);

    const ok = r.status === 200;
    if (ok) log('INFO', `[TTS] Model loaded: ${path.basename(gptModel)}`);
    else log('WARN', `[TTS] Model load failed: HTTP ${r.status}`);
    return ok;
  } catch (e) {
    log('WARN', `[TTS] Model load error: ${e.message}`);
    return false;
  }
}

// ==================== TTS 生成 ====================

async function localTTS(text, customRef) {

  let refAudio = (customRef?.ref_audio_path) || config.tts.ref_audio_path;

  if (refAudio && !path.isAbsolute(refAudio)) refAudio = path.join(APP_ROOT, refAudio);



  const promptText = customRef?.prompt_text !== undefined ? customRef.prompt_text : config.tts.prompt_text;

  const promptLang = customRef?.prompt_lang || config.tts.prompt_lang;

  // 强制 auto — 中日混合文本下指定 ja/zh 会导致 G2P 崩溃(JPCommonLabel_make No phoneme)
  const textLang = 'auto';

  const cutPunc = config.tts.cut_punc || '';



  if (!refAudio || !fs.existsSync(refAudio)) {

    throw new Error(`ref audio missing: ${refAudio || '(empty)'}`);

  }



  log('INFO', `[TTS] ref=${path.basename(refAudio)} prompt="${(promptText || '').substring(0, 30)}..." lang=${promptLang}/${textLang}`);



  const bodyObj = {

    refer_wav_path: refAudio, prompt_text: promptText || '',

    prompt_language: promptLang, text_language: textLang,

    text: text,

    top_k: config.tts.top_k || 15,

    top_p: config.tts.top_p || 0.6,

    temperature: config.tts.temperature || 0.8,

    speed: config.tts.speed || 1.0

  };

  if (cutPunc) bodyObj.cut_punc = cutPunc;

  const body = JSON.stringify(bodyObj);

  // 带模型自动恢复的重试
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await httpReq({
        hostname: config.gpt_sovits.hostname, port: config.gpt_sovits.port,
        path: config.gpt_sovits.endpoint, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, body, config.tts.timeout_ms);

      if (r.status !== 200) {
        if (r.status === 400) {
          try { const err = JSON.parse(r.body.toString()); throw new Error(err.message || err.code || 'GPT-SoVITS 400'); } catch (e) { if (e.message && !e.message.startsWith('Unexpected')) throw e; }
        }
        throw new Error(`GPT-SoVITS ${r.status} size=${r.body.length}`);
      }

      // 校验音频有效性：检测 HTML 错误页和 JSON 错误响应
      if (r.body.length < 100000) {
        const firstBytes = r.body.slice(0, 10).toString('ascii').toLowerCase();
        if (firstBytes.includes('<!doctype') || firstBytes.includes('<html')) {
          throw new Error('GPT-SoVITS error page');
        }
        try {
          const jsonErr = JSON.parse(r.body.toString('utf-8'));
          if (jsonErr.error || jsonErr.message) {
            throw new Error(`GPT-SoVITS: ${jsonErr.error || jsonErr.message}`);
          }
        } catch (e) { if (e.message && e.message.startsWith('GPT-SoVITS')) throw e; }
      }

      // 校验音频完整性（中文字均2800字节/字，留余量到2000）
      const minExpectedBytes = Math.max(8000, Math.round(text.length * 2000));
      if (r.body.length <= minExpectedBytes) {
        log('WARN', `[TTS] Audio too short: ${r.body.length} bytes (expected >= ${minExpectedBytes}), text_len=${text.length}. Retrying...`);
        throw new Error(`audio truncated: ${r.body.length}b < ${minExpectedBytes}b`);
      }

      return r.body;
    } catch (e) {
      if (attempt < 2) {
        log('WARN', `[TTS] attempt ${attempt} failed: ${e.message}, reloading model...`);
        await loadGPTSoVITSModel();
        await new Promise(r => setTimeout(r, 1000));
      } else {
        throw e;
      }
    }
  }

}



async function systemTTS(text) {

  const tmp = path.join(tmpdir(), `tts_${Date.now()}.wav`);

  // Build a PowerShell script that speaks text and saves to WAV

  // Text is written to a temp script file to avoid shell injection entirely

  const scriptContent = [

    `$t = Get-Content -Path "${tmp.replace(/\\/g, '\\\\')}.txt" -Raw -Encoding UTF8`,

    'Add-Type -AN System.Speech',

    '$s = New-Object Speech.Synthesis.SpeechSynthesizer',

    '$v = $s.GetInstalledVoices() | ? { $_.VoiceInfo.Culture.Name -match "zh" }',

    'if ($v) { $s.SelectVoice($v[0].VoiceInfo.Name) }',

    `$s.SetOutputToWaveFile("${tmp.replace(/\\/g, '\\\\')}")`,

    '$s.Speak($t)',

    '$s.Dispose()'

  ].join('; ');

  const scriptFile = path.join(tmpdir(), `tts_script_${Date.now()}.ps1`);

  fs.writeFileSync(scriptFile, scriptContent, 'utf8');

  fs.writeFileSync(`${tmp}.txt`, text, 'utf8');

  try {

    const child = spawn('powershell', [

      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile

    ], { windowsHide: true });

    const err = [];

    child.stderr.on('data', d => err.push(d));

    const code = await new Promise((resolve, reject) => {

      child.on('close', resolve);

      child.on('error', reject);

      setTimeout(() => { child.kill(); reject(new Error('timeout 15s')); }, 15000);

    });

    if (code !== 0) throw new Error(`system TTS failed: ${err.join('')}`);

    const d = fs.readFileSync(tmp);

    if (d.length < 1000) throw new Error('system TTS too small');

    return d;

  } finally {

    try { fs.unlinkSync(scriptFile); } catch {}

    try { fs.unlinkSync(`${tmp}.txt`); } catch {}

  }

}



async function cloudTTS(text) {

  const tmp = path.join(tmpdir(), `tts_${Date.now()}.mp3`);

  // Use spawn to avoid shell injection — each arg passed as separate array element

  // so special chars in text cannot break out of command string

  const child = spawn('npx', [

    '-y', 'edge-tts',

    '--voice', config.cloud_tts.voice,

    '--rate', config.cloud_tts.rate,

    '--text', text,

    '--write-media', tmp

  ], { windowsHide: true });

  return new Promise((resolve, reject) => {

    const err = [];

    child.stderr.on('data', d => err.push(d));

    child.on('close', code => {

      if (code !== 0) return reject(new Error(`edge-tts exit ${code}: ${err.join('')}`));

      try {

        const d = fs.readFileSync(tmp);

        try { fs.unlinkSync(tmp); } catch {}

        if (d.length < 500) return reject(new Error('cloud TTS too small'));

        resolve(d);

      } catch (e) { reject(e); }

    });

    child.on('error', reject);

    setTimeout(() => { child.kill(); reject(new Error('timeout 30s')); }, 30000);

  });

}



async function generateTTS(text, customRef) {

  // 1. 终极过滤换行符和波浪号（防止 GPT-SoVITS 抽风和断层报错）

  const clean = text.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')

                    .replace(/[～~]/g, '')

                    .replace(/\n/g, '。')

                    .trim();

  if (!clean) throw new Error('empty text');



  // 文本哈希去重：相同文本的并发请求复用同一个 Promise 结果

  // 防止 GPT-SoVITS 收到两个相同的推理请求互相打架（ 4% + 100% 各返回一次）

  const textKey = `${clean}|${customRef?.ref_audio_path || ''}`;

  const inflight = state.ttsInFlight.get(textKey);

  if (inflight) {

    log('INFO', `TTS dedup: reusing in-flight for "${clean.substring(0, 20)}..."`);

    return inflight;

  }



  // TTS 队列逻辑保留（防止前端点太快导致后端卡死）

  if (state.ttsLock) {

    log('INFO', `TTS queued: "${clean.substring(0, 20)}..."`);

    const p = new Promise((resolve, reject) => {

      state.ttsQueue.push({ text: clean, customRef, resolve, reject });

    });

    state.ttsInFlight.set(textKey, p);

    return p;

  }



  // 2. 暴力锁死：强制只用 localTTS，彻底剥夺使用 systemTTS（系统大妈音）的权利！

  log('INFO', `TTS [Forced Local]: "${clean.substring(0, 30)}..."`);

  

  state.ttsLock = true;

  const p = localTTS(clean, customRef).then(result => {

    state.ttsInFlight.delete(textKey);

    processTTSQueue();

    return result;

  }).catch(e => {

    log('WARN', 'local TTS fail (GPT-SoVITS Error):', e.message);

    state.ttsInFlight.delete(textKey);

    processTTSQueue(); // 由队列处理锁释放，不在此提前释放

    throw e;

  });

  state.ttsInFlight.set(textKey, p);

  return p;

}

async function processTTSQueue() {

  if (state.ttsQueue.length === 0) { state.ttsLock = false; return; }

  const { text, customRef, resolve, reject } = state.ttsQueue.shift();

  const textKey = `${text}|${customRef?.ref_audio_path || ''}`;

  try {

    const result = await localTTS(text, customRef);

    state.ttsInFlight.delete(textKey);

    resolve(result);

  } catch (e) {

    state.ttsInFlight.delete(textKey);

    reject(e);

  } finally {

    await processTTSQueue();

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

      try { fs.unlinkSync(files[i].p); del++; } catch {}

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



// 根据音频数据的魔术字节自动识别格式，避免硬编码 audio/wav 导致浏览器解码失败

function detectAudioMime(buffer) {

  if (!buffer || buffer.length < 12) return 'audio/wav';

  const magic = buffer.toString('ascii', 0, 12).toLowerCase();

  if (magic.startsWith('riff') && magic.includes('wave')) return 'audio/wav';    // RIFF...WAVE

  if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) return 'audio/mpeg';   // MP3 frame sync

  if (magic.startsWith('id3')) return 'audio/mpeg';                             // MP3 with ID3

  if (magic.startsWith('ftyp')) return 'audio/mp4';                             // M4A/AAC

  return 'audio/wav';                                                           // default

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

  if (cb) {

    req.on('end', () => { if (!aborted) cb(done()); });

    req.on('error', () => { if (aborted) cb(''); });

  } else {

    return new Promise(resolve => {

      req.on('end', () => { if (!aborted) resolve(done()); });

      req.on('error', () => { if (aborted) resolve(''); });

    });

  }

}



// ==================== 路由处理器 ====================

const handlers = {

  // 健康检查

  'GET /api/health': async (req, res) => {

    const gpu = await getGPUInfo();

    sendJSON(res, {

      status: state.shuttingDown ? 'stopping' : 'ok',

      uptime_ms: Date.now() - state.startTime,

      tts: { mode: config.tts.mode, ready: state.ttsReady },

      gpt_sovits: config.gpt_sovits,

      ollama: { ready: state.ollamaReady, model: config.ollama.model, cuda: config.ollama.cuda_enabled },

      gpu, requests: state.requestCount, version: '3.1'

    });

  },



  // TTS 生成（返回音频）

  'POST /api/tts': (req, res) => {

    if (!checkTTSPerIP(req.socket.remoteAddress)) {

      return sendError(res, HTTP_STATUS.RATE_LIMIT, 'TTS rate limited');

    }

    collectBody(req, async body => {

      try {

        const d = JSON.parse(body);

        const text = (d.text || '').trim();

        if (!text) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'missing text');



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



        // 验证音频有效性（防止 GPT-SoVITS 返回错误页）

        if (!buf || buf.length <= 500) throw new Error(`invalid audio size=${buf ? buf.length : 'null'}`);

        const firstBytes = buf.slice(0, 10).toString('ascii').toLowerCase();

        if (firstBytes.includes('<!doctype') || firstBytes.includes('<html')) throw new Error('GPT-SoVITS error page');



        ensureDir(AUDIO_DIR);

        const fn = `tts_${Date.now()}.wav`;

        fs.writeFileSync(path.join(AUDIO_DIR, fn), buf);



        sendAudio(res, buf);

      } catch (e) { log('ERROR', 'TTS fail:', e.message); sendError(res, HTTP_STATUS.SERVER_ERROR, 'TTS failed'); }

    });

  },



  // TTS 生成（返回 URL）

  'POST /api/tts-generate': (req, res) => {

    if (!checkTTSPerIP(req.socket.remoteAddress)) {

      return sendError(res, HTTP_STATUS.RATE_LIMIT, 'TTS rate limited');

    }

    collectBody(req, async body => {

      try {

        const { text } = JSON.parse(body);

        if (!text) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'missing text');

        const buf = await generateTTS(text);

        // BUG5 fix: 验证音频有效性再写盘，防止 GPT-SoVITS 返回错误 HTML

        if (!buf || buf.length <= 500) throw new Error(`invalid audio size=${buf ? buf.length : 'null'}`);

        const firstBytes = buf.slice(0, 10).toString('ascii').toLowerCase();

        if (firstBytes.includes('<!doctype') || firstBytes.includes('<html')) throw new Error('GPT-SoVITS error page');

        ensureDir(AUDIO_DIR);

        const fn = `tts_${Date.now()}.wav`;

        fs.writeFileSync(path.join(AUDIO_DIR, fn), buf);

        state.latestAudioUrl = `/audio/${fn}`;

        sendJSON(res, { success: true, audio_url: `/audio/${fn}` });

      } catch (e) { sendError(res, HTTP_STATUS.SERVER_ERROR, e.message); }

    });

  },



  // TTS latest audio (polling endpoint)

  'GET /api/tts-latest': (req, res) => {

    sendJSON(res, { audio_url: state.latestAudioUrl || null });

  },



  // TTS 配置

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
    } catch (e) {
      sendError(res, HTTP_STATUS.BAD_REQUEST, e.message);
    }
  }),



  // TTS 模式

  'GET /api/tts-mode': (req, res) => sendJSON(res, { mode: config.tts.mode, ready: state.ttsReady }),

  'POST /api/tts-mode': (req, res) => collectBody(req, body => {
    try {
      const { mode } = JSON.parse(body);
      if (!['local', 'system', 'cloud'].includes(mode)) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid');
      config.tts.mode = mode;
      saveConfig(config);
      sendJSON(res, { success: true, mode });
    } catch (e) {
      sendError(res, HTTP_STATUS.BAD_REQUEST, e.message);
    }
  }),



  // GPT-SoVITS 配置

  'GET /api/gpt-sovits-config': (req, res) => sendJSON(res, { config: config.gpt_sovits }),

  'POST /api/gpt-sovits-config': (req, res) => collectBody(req, body => {
    try {
      const d = JSON.parse(body);
      if (d.hostname) config.gpt_sovits.hostname = d.hostname;
      if (d.port) config.gpt_sovits.port = d.port;
      if (d.endpoint) config.gpt_sovits.endpoint = d.endpoint;
      saveConfig(config);
      sendJSON(res, { success: true });
    } catch (e) {
      sendError(res, HTTP_STATUS.BAD_REQUEST, e.message);
    }
  }),



  // 聊天模式

  'GET /api/chat-mode': (req, res) => sendJSON(res, { mode: 'qclaw' }),

  'POST /api/chat-mode': (req, res) => collectBody(req, body => {
    try {
      const { mode } = JSON.parse(body);
      sendJSON(res, { success: true, mode: mode || 'qclaw' });
    } catch (e) {
      sendError(res, HTTP_STATUS.BAD_REQUEST, e.message);
    }
  }),



  // 参考音频列表

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



  // 文件上传

  'POST /api/upload-file': handleUpload,

  'POST /api/upload-audio': handleUpload,

  // ========== Memory API Routes ==========
  'GET /api/memory': async (req, res) => {
    try {
      const filter = parseUrl(req.url).query.filter || 'all';
      const memories = memoryStore.getMemories(filter);
      sendJSON(res, { memories });
    } catch (e) { sendError(res, HTTP_STATUS.SERVER_ERROR, e.message); }
  },

  'POST /api/memory': async (req, res) => {
    try {
      const raw = await collectBody(req);
      const body = JSON.parse(raw);
      const mem = memoryStore.addMemory(body.content, body.category || 'fact');
      sendJSON(res, { memory: mem });
    } catch (e) { sendError(res, HTTP_STATUS.SERVER_ERROR, e.message); }
  },

  'DELETE /api/memory': async (req, res) => {
    try {
      const raw = await collectBody(req);
      const body = JSON.parse(raw);
      memoryStore.deleteMemory(body.id);
      sendJSON(res, { ok: true });
    } catch (e) { sendError(res, HTTP_STATUS.SERVER_ERROR, e.message); }
  },

  'POST /api/memory/pin': async (req, res) => {
    try {
      const raw = await collectBody(req);
      const body = JSON.parse(raw);
      const mem = memoryStore.togglePin(body.id);
      sendJSON(res, { memory: mem });
    } catch (e) { sendError(res, HTTP_STATUS.SERVER_ERROR, e.message); }
  },

  'POST /api/memory/extract': async (req, res) => {
    try {
      const raw = await collectBody(req);
      const body = JSON.parse(raw);
      const prompt = memoryStore.buildExtractionPrompt(body.text || '');
      const msgs = [{ role: 'system', content: prompt }, { role: 'user', content: body.text || '' }];
      const payload = JSON.stringify({ model: 'openclaw', messages: msgs, max_tokens: 256, temperature: 0.3 });
      const gwUrl = new URL(config.gateway.url + '/v1/chat/completions');
      const gwResult = await new Promise((resolve, reject) => {
        const r = http.request({ hostname: gwUrl.hostname, port: gwUrl.port, path: gwUrl.pathname, method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.gateway.token, 'Content-Length': Buffer.byteLength(payload) }
        }, resp => {
          let data = '';
          resp.on('data', chunk => data += chunk);
          resp.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        });
        r.on('error', reject);
        r.setTimeout(30000, () => { r.destroy(); reject(new Error('gateway timeout')); });
        r.end(payload);
      });
      let extracted = [];
      try { extracted = JSON.parse(gwResult.choices[0].message.content); } catch (e) {}
      for (const item of extracted) {
        memoryStore.addMemory(item.content, item.category || 'fact');
      }
      sendJSON(res, { extracted });
    } catch (e) { sendError(res, HTTP_STATUS.SERVER_ERROR, e.message); }
  },

  'GET /api/memory/search': async (req, res) => {
    try {
      const q = parseUrl(req.url).query.q || '';
      const results = memoryStore.searchRelevantMemories(q, 5);
      sendJSON(res, { results });
    } catch (e) { sendError(res, HTTP_STATUS.SERVER_ERROR, e.message); }
  },

  'GET /api/memory/conversations': async (req, res) => {
    try {
      const list = memoryStore.listConversations();
      sendJSON(res, { conversations: list });
    } catch (e) { sendError(res, HTTP_STATUS.SERVER_ERROR, e.message); }
  },
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

    headers: { ...req.headers, ...headers, host: u.host }, timeout: 120000

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

    pr.pipe(res);

    pr.on('error', () => { try { res.end(); } catch {} });

  });

  p.on('error', () => sendError(res, HTTP_STATUS.BAD_GATEWAY, 'proxy error'));

  p.on('timeout', () => { p.destroy(); sendError(res, HTTP_STATUS.GATEWAY_TIMEOUT, 'proxy timeout'); });

  if (body) {
    p.end(body);
  } else {
    req.pipe(p);
  }

}



function proxyChat(req, res, body) {

  try {

    const d = JSON.parse(body);

    d.model = 'openclaw'; // Gateway 只接受 openclaw 或 openclaw/<agentId>

    // Inject relevant memories into system prompt
    const userText = (d.messages || []).map(m => m.content || '').join(' ');
    const relevantMemories = memoryStore.searchRelevantMemories(userText, 5);
    let systemContent = config.system_prompt;
    if (relevantMemories.length) {
      systemContent += '\n\n' + memoryStore.formatMemoryForPrompt(relevantMemories);
    }
    const msgs = [{ role: 'system', content: systemContent }, ...(d.messages || []).filter(m => m.role !== 'system')];

    // Save conversation to history
    const today = new Date().toISOString().split('T')[0];
    const convMsgs = (d.messages || []).filter(m => m.role !== 'system');
    if (convMsgs.length) memoryStore.saveConversation(today, convMsgs);

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

    // Inject relevant memories into system prompt (Ollama)
    const ollamaText = (d.messages || []).map(m => m.content || '').join(' ');
    const ollamaMemories = memoryStore.searchRelevantMemories(ollamaText, 5);
    let ollamaSystem = config.system_prompt;
    if (ollamaMemories.length) {
      ollamaSystem += '\n\n' + memoryStore.formatMemoryForPrompt(ollamaMemories);
    }
    const msgs = [{ role: 'system', content: ollamaSystem }, ...(d.messages || []).filter(m => m.role !== 'system')];

    // Save conversation
    const ollamaToday = new Date().toISOString().split('T')[0];
    const ollamaMsgs = (d.messages || []).filter(m => m.role !== 'system');
    if (ollamaMsgs.length) memoryStore.saveConversation(ollamaToday, ollamaMsgs);

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

  // SECURITY: normalize and verify path stays within APP_ROOT to prevent path traversal

  // path.resolve ignores APP_ROOT when fp starts with '/', so we must prepend '.' explicitly

  const full = path.resolve(APP_ROOT, fp === fp.normalize ? fp : '.' + fp);

  // Additional check: ensure normalized path is within APP_ROOT

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

      fs.createReadStream(full, { start, end }).pipe(res).on('error', () => { try { res.end(); } catch {} });

    } else {

      res.writeHead(HTTP_STATUS.OK, { 'Content-Length': st.size, 'Content-Type': ct });

      fs.createReadStream(full).pipe(res).on('error', () => { try { res.end(); } catch {} });

    }

  });

}



// ==================== 主服务器 ====================

const server = http.createServer(async (req, res) => {

  if (state.shuttingDown) {

    res.writeHead(HTTP_STATUS.SERVICE_UNAVAILABLE);

    return res.end('shutting down');

  }



  const url = req.url.split('?')[0];

  state.requestCount++;



  // CORS 预检

  if (req.method === 'OPTIONS') {

    res.writeHead(HTTP_STATUS.NO_CONTENT, CORS_HEADERS);

    return res.end();

  }



  // 限流检查 — 只对非静态资源路由启用（TTS请求用独立限流器，跳过全局检查）

  if (url.startsWith('/api/') && !url.startsWith('/api/tts') && !checkRate(req.socket.remoteAddress)) {

    return sendError(res, HTTP_STATUS.RATE_LIMIT, 'rate limited');

  }



  // 路由匹配

  const key = `${req.method} ${url}`;

  const handler = handlers[key];



  if (handler) {

    try { await handler(req, res); } catch (e) { sendError(res, HTTP_STATUS.SERVER_ERROR, 'handler error'); }

    return;

  }



  // 特殊路由

  // 音频文件 (从 AUDIO_DIR 提供，不在 asar 内)

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



  // 静态文件

  serveStatic(req, res);

});



// ==================== 优雅关闭 ====================

async function shutdown(sig) {

  if (state.shuttingDown) return;

  state.shuttingDown = true;

  log('INFO', `Shutting down (${sig})...`);

  server.close(() => log('INFO', 'Server closed'));

  if (healthTimer) clearInterval(healthTimer);

  await new Promise(r => setTimeout(r, 2000));

  log('INFO', 'Shutdown complete');

  process.exit(0);

}



process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', e => {

  log('ERROR', 'Uncaught:', e.message);

  state.lastError = { message: e.message, time: new Date().toISOString() };

  if (['ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(e.code)) return;

  shutdown('uncaughtException');

});

process.on('unhandledRejection', r => log('ERROR', 'Unhandled rejection:', String(r)));



// ==================== 启动 ====================

let healthTimer = null;



async function start() {

  const isElectron = process.env.ELECTRON_MODE === '1';

  const portInUse = !(await isPortFree(config.server.port));



  if (portInUse) {

    if (isElectron) {

      log('INFO', `Port ${config.server.port} already in use — using existing server`);

      log('INFO', '✅ Server ready (using existing instance)');

      return;

    } else {

      log('INFO', `Port ${config.server.port} in use, cleaning...`);

      await killPort(config.server.port);

    }

  }



  server.listen(config.server.port, config.server.host, () => {

    log('INFO', '🌸 丛雨 Live2D v3.1');

    log('INFO', `   http://${config.server.host}:${config.server.port}/`);

    log('INFO', `   TTS: ${config.tts.mode} | GPT-SoVITS: ${config.gpt_sovits.hostname}:${config.gpt_sovits.port}${config.gpt_sovits.endpoint}`);

  });



  await checkTTS();

  healthTimer = setInterval(checkTTS, 10000);

  // 加载 GPT-SoVITS 模型（异步，不阻塞启动流程）
  if (state.ttsReady) {
    setTimeout(() => loadGPTSoVITSModel(), 2000);
  }

  // Ollama 预热

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

  log('INFO', '✅ Server ready');

}



start().catch(e => { log('ERROR', 'Start failed:', e.message); process.exit(1); });

