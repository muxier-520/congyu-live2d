/**
 * 配置管理模块
 * - 加载/合并/保存/热重载 config.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const _rawRoot = path.resolve(__dirname, '..');
const _isAsar = _rawRoot.includes('.asar');
const APP_ROOT = _rawRoot;  // always points to actual files (asar or not)
const DATA_DIR = _isAsar ? path.join(process.env.APPDATA || require('os').tmpdir(), 'murasame-live2d') : _rawRoot;
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

// ==================== 默认配置 ====================
const DEFAULTS = {
  server: { port: 8888, host: '127.0.0.1' },
  gpt_sovits: {
    hostname: '127.0.0.1', port: 9880, endpoint: '/tts', startup_timeout_ms: 120000,
    enabled: true, auto_start: true, api_script: 'api_v2.py',
    config_yaml: 'GPT_SoVITS/configs/tts_infer_congyu.yaml'
  },
  ollama: {
    model: 'qwen2.5:latest', port: 11434,
    search_paths: [
      '%LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe',
      '%PROGRAMFILES%\\Ollama\\ollama.exe'
    ],
    models_dir: '%USERPROFILE%\\.ollama\\models',
    cuda_enabled: true, flash_attention: true,
    enabled: true, auto_start: true, hostname: '127.0.0.1', startup_timeout_ms: 60000
  },
  gateway: { url: 'http://127.0.0.1:28789', token: '' },
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
    enabled: true, max_generations: 8, vram_threshold_percent: 95, cooldown_ms: 30000
  },
  search: {
    enabled: true, provider: 'duckduckgo', max_results: 5
  },
  vision: {
    enabled: true, model: 'llama3.2-vision:latest', default_prompt: '请详细描述这张图片的内容'
  },
  cloud_api: {
    enabled: false,
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    model: 'gpt-4o-mini'
  }
};

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

function expandEnvString(value) {
  return typeof value === 'string' ? value.replace(/%([^%]+)%/g, (_, name) => process.env[name] || '') : value;
}

function expandEnvDeep(obj) {
  if (obj == null) return obj;
  if (Array.isArray(obj)) return obj.map(expandEnvDeep);
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = expandEnvDeep(v);
    return out;
  }
  return expandEnvString(obj);
}

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return expandEnvDeep(deepMerge(DEFAULTS, saved));
    }
  } catch (e) {
    console.warn('config.json load failed:', e.message);
  }
  return expandEnvDeep({ ...DEFAULTS });
}

function saveConfig(cfg) {
  try {
    let base = {};
    try { if (fs.existsSync(CONFIG_PATH)) base = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')); } catch {}
    const merged = deepMerge(base, cfg);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save config:', e.message);
  }
}

module.exports = { DEFAULTS, APP_ROOT, DATA_DIR, CONFIG_PATH, loadConfig, saveConfig, deepMerge };
