/**
 * TTS 相关 API 路由
 */
'use strict';

const fs = require('fs');
const path = require('path');

function createTTSRoutes(tts, config, state, { log, utils, audioDir, appRoot }) {
  const { HTTP_STATUS, sendJSON, sendError, sendAudio, collectBody, ensureDir, safeJSON } = utils;

  const MAX_TTS_TEXT_LENGTH = 500;
  const MAX_TTS_TEXT_BYTES = 2048;

  function normalizeRefAudioPath(inputPath) {
    if (!inputPath) return inputPath;

    const candidates = [];
    if (path.isAbsolute(inputPath)) {
      candidates.push(inputPath);
      candidates.push(path.join(appRoot, 'ref_audio', path.basename(inputPath)));
      candidates.push(path.join(appRoot, 'models', 'sounds', path.basename(inputPath)));
    } else {
      candidates.push(path.join(appRoot, inputPath));
      candidates.push(path.join(appRoot, 'ref_audio', inputPath));
      candidates.push(path.join(appRoot, 'models', 'sounds', inputPath));
      candidates.push(path.join(appRoot, 'ref_audio', path.basename(inputPath)));
      candidates.push(path.join(appRoot, 'models', 'sounds', path.basename(inputPath)));
    }

    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return path.isAbsolute(inputPath) ? inputPath : path.join(appRoot, inputPath);
  }

  function register(handlers) {

    // POST /api/tts — TTS 生成，返回原始音频
    handlers['POST /api/tts'] = (req, res) => collectBody(req, async body => {
      try {
        const d = JSON.parse(body);
        const text = (d.text || '').trim();
        if (!text) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'missing text');
        if (text.length > MAX_TTS_TEXT_LENGTH) {
          return sendError(res, HTTP_STATUS.BAD_REQUEST,
            `TTS text too long: ${text.length} chars (max ${MAX_TTS_TEXT_LENGTH})`);
        }
        if (Buffer.byteLength(text, 'utf-8') > MAX_TTS_TEXT_BYTES) {
          return sendError(res, HTTP_STATUS.BAD_REQUEST,
            `TTS text too large: ${Buffer.byteLength(text, 'utf-8')} bytes (max ${MAX_TTS_TEXT_BYTES})`);
        }

        const customRef = {};
        if (d.ref_audio_path || d.refer_wav_path) customRef.ref_audio_path = normalizeRefAudioPath(d.ref_audio_path || d.refer_wav_path);
        if (d.prompt_text !== undefined) customRef.prompt_text = d.prompt_text;
        if (d.prompt_lang || d.prompt_language) customRef.prompt_lang = d.prompt_lang || d.prompt_language;
        if (d.text_lang || d.text_language) customRef._text_language = d.text_lang || d.text_language;

        const buf = await tts.generateTTS(text, Object.keys(customRef).length > 0 ? customRef : null);

        if (!buf || buf.length <= 500) throw new Error(`invalid audio size=${buf ? buf.length : 'null'}`);
        const firstBytes = buf.slice(0, 10).toString('ascii').toLowerCase();
        if (firstBytes.includes('<!doctype') || firstBytes.includes('<html')) throw new Error('GPT-SoVITS error page');

        tts.saveAudioFile(buf);
        sendAudio(res, buf);
      } catch (e) {
        log('ERROR', 'TTS fail:', e.message);
        if (e.message && (e.message.includes('timeout') || e.message.includes('ECONNREFUSED') || e.message.includes('ECONNRESET'))) {
          setImmediate(() => tts.checkTTS());
        }
        sendError(res, HTTP_STATUS.SERVER_ERROR, 'TTS failed');
      }
    });

    // POST /api/tts-generate — TTS 生成，返回 JSON
    handlers['POST /api/tts-generate'] = (req, res) => collectBody(req, async body => {
      try {
        const { text } = JSON.parse(body);
        if (!text) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'missing text');
        if (text.length > MAX_TTS_TEXT_LENGTH) {
          return sendError(res, HTTP_STATUS.BAD_REQUEST,
            `TTS text too long: ${text.length} chars (max ${MAX_TTS_TEXT_LENGTH})`);
        }
        if (Buffer.byteLength(text, 'utf-8') > MAX_TTS_TEXT_BYTES) {
          return sendError(res, HTTP_STATUS.BAD_REQUEST,
            `TTS text too large: ${Buffer.byteLength(text, 'utf-8')} bytes (max ${MAX_TTS_TEXT_BYTES})`);
        }

        const buf = await tts.generateTTS(text);
        if (!buf || buf.length <= 500) throw new Error(`invalid audio size=${buf ? buf.length : 'null'}`);
        const firstBytes = buf.slice(0, 10).toString('ascii').toLowerCase();
        if (firstBytes.includes('<!doctype') || firstBytes.includes('<html')) throw new Error('GPT-SoVITS error page');

        const fn = tts.saveAudioFile(buf);
        sendJSON(res, { success: true, audio_url: `/audio/${fn}` });
      } catch (e) {
        log('ERROR', 'TTS generate fail:', e.message);
        sendError(res, HTTP_STATUS.SERVER_ERROR, e.message);
      }
    });

    // GET /api/tts-config
    handlers['GET /api/tts-config'] = (req, res) => sendJSON(res, {
      config: {
        ref_audio_path: config.tts.ref_audio_path,
        refer_wav_path: config.tts.ref_audio_path,
        prompt_text: config.tts.prompt_text,
        prompt_lang: config.tts.prompt_lang,
        prompt_language: config.tts.prompt_lang,
        text_lang: config.tts.text_lang,
        text_language: config.tts.text_lang,
        top_k: config.tts.top_k, top_p: config.tts.top_p,
        temperature: config.tts.temperature, speed: config.tts.speed,
        text_split_method: config.tts.text_split_method || 'cut5'
      },
      mode: config.tts.mode,
      ready: state.ttsReady,
      gpt_sovits: config.gpt_sovits
    });

    // POST /api/tts-config
    handlers['POST /api/tts-config'] = (req, res) => collectBody(req, body => {
      try {
        const d = JSON.parse(body);
        if (d.prompt_text !== undefined) config.tts.prompt_text = d.prompt_text;
        if (d.prompt_lang !== undefined || d.prompt_language !== undefined) {
          config.tts.prompt_lang = d.prompt_lang !== undefined ? d.prompt_lang : d.prompt_language;
        }
        if (d.text_lang !== undefined || d.text_language !== undefined) {
          config.tts.text_lang = d.text_lang !== undefined ? d.text_lang : d.text_language;
        }
        if (d.ref_audio_path !== undefined || d.refer_wav_path !== undefined) {
          config.tts.ref_audio_path = normalizeRefAudioPath(
            d.ref_audio_path !== undefined ? d.ref_audio_path : d.refer_wav_path
          );
        }
        if (d.top_k !== undefined) config.tts.top_k = d.top_k;
        if (d.top_p !== undefined) config.tts.top_p = d.top_p;
        if (d.temperature !== undefined) config.tts.temperature = d.temperature;
        if (d.speed !== undefined) config.tts.speed = d.speed;
        if (d.text_split_method !== undefined) config.tts.text_split_method = d.text_split_method;
        const { saveConfig } = require('../lib/config');
        saveConfig(config);
        sendJSON(res, { success: true, config: { ref_audio_path: config.tts.ref_audio_path } });
      } catch (e) {
        sendError(res, HTTP_STATUS.BAD_REQUEST, e.message);
      }
    });

    // GET /api/tts-mode
    handlers['GET /api/tts-mode'] = (req, res) => sendJSON(res, { mode: config.tts.mode, ready: state.ttsReady });

    // POST /api/tts-mode
    handlers['POST /api/tts-mode'] = (req, res) => collectBody(req, body => {
      try {
        const { mode } = JSON.parse(body);
        if (!['local', 'system', 'cloud'].includes(mode)) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'invalid');
        config.tts.mode = mode;
        const { saveConfig } = require('../lib/config');
        saveConfig(config);
        sendJSON(res, { success: true, mode });
      } catch (e) { sendError(res, HTTP_STATUS.BAD_REQUEST, e.message); }
    });

    // GET /api/gpt-sovits-config
    handlers['GET /api/gpt-sovits-config'] = (req, res) => sendJSON(res, { config: config.gpt_sovits });

    // POST /api/gpt-sovits-config
    handlers['POST /api/gpt-sovits-config'] = (req, res) => collectBody(req, body => {
      try {
        const d = JSON.parse(body);
        if (d.hostname) config.gpt_sovits.hostname = d.hostname;
        if (d.port) config.gpt_sovits.port = d.port;
        if (d.endpoint || d.path) config.gpt_sovits.endpoint = d.endpoint || d.path;
        const { saveConfig } = require('../lib/config');
        saveConfig(config);
        sendJSON(res, { success: true });
      } catch (e) { sendError(res, HTTP_STATUS.BAD_REQUEST, e.message); }
    });

    // GET /api/ref-audio-list
    handlers['GET /api/ref-audio-list'] = (req, res) => {
      const refDir = path.join(appRoot, 'ref_audio');
      const files = [];
      [refDir, audioDir].forEach(dir => {
        if (fs.existsSync(dir)) {
          fs.readdirSync(dir).filter(f => f.endsWith('.wav') || f.endsWith('.mp3')).forEach(f => {
            const p = path.join(dir, f);
            const stat = fs.statSync(p);
            files.push({
              name: f, path: p, size: stat.size, mtime: stat.mtimeMs,
              dir: dir === refDir ? 'ref_audio' : 'audio'
            });
          });
        }
      });
      sendJSON(res, {
        files,
        current: {
          ref_audio_path: config.tts.ref_audio_path,
          prompt_text: config.tts.prompt_text,
          prompt_lang: config.tts.prompt_lang,
          text_lang: config.tts.text_lang
        }
      });
    };

    // GET /api/tts-latest
    handlers['GET /api/tts-latest'] = (req, res) => {
      try {
        if (!fs.existsSync(audioDir)) {
          return sendJSON(res, { audio_url: null, error: 'No audio generated yet' });
        }
        const files = fs.readdirSync(audioDir)
          .filter(f => f.startsWith('tts_') && f.endsWith('.wav'))
          .map(f => ({ name: f, path: path.join(audioDir, f), mtime: fs.statSync(path.join(audioDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length === 0) {
          return sendJSON(res, { audio_url: null, error: 'No audio generated yet' });
        }
        sendJSON(res, { audio_url: '/audio/' + files[0].name });
      } catch (e) {
        log('ERROR', 'TTS latest error:', e.message);
        sendJSON(res, { audio_url: null, error: e.message });
      }
    };

    // POST /api/tts-gc
    handlers['POST /api/tts-gc'] = async (req, res) => {
      try {
        const ok = await tts.triggerGPUCacheClear();
        sendJSON(res, {
          success: ok,
          message: ok ? 'GPU cache clearing triggered' : 'GPU cache disabled',
          generation_count: state.ttsGenerationCount
        });
      } catch (e) {
        log('ERROR', 'TTS GC error:', e.message);
        sendError(res, HTTP_STATUS.SERVER_ERROR, e.message);
      }
    };

    // GET /api/tts-gc-status
    handlers['GET /api/tts-gc-status'] = (req, res) => {
      sendJSON(res, {
        generation_count: state.ttsGenerationCount,
        max_generations: config.gpu_cache?.max_generations || 8,
        vram_threshold: config.gpu_cache?.vram_threshold_percent || 85,
        enabled: config.gpu_cache?.enabled || false,
        last_gc_ms: state.lastGpuGcTime ? Date.now() - state.lastGpuGcTime : -1,
        cooldown_ms: config.gpu_cache?.cooldown_ms || 30000
      });
    };
  }

  return { register };
}

module.exports = { createTTSRoutes };
