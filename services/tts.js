/**
 * TTS 引擎模块
 * - GPT-SoVITS 自动启动/进程管理
 * - 健康检查（端口探测 + HTTP 探测）
 * - TTS 生成、队列管理、音频验证
 * - GPU 缓存管理
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ==================== 工厂函数 ====================
function createTTS(config, state, { appRoot, audioDir, log, utils }) {
  const {
    HTTP_STATUS, httpReq, withRetry, checkPort, waitForPort, killPort, ensureDir, sendAudio
  } = utils;

  let ttsRestartCount = 0;
  const TTS_MAX_RESTARTS = 5;
  let ttsHealFailCount = 0;
  const TTS_HEAL_FAIL_LIMIT = 3;
  const STARTUP_GRACE_MS = 120000; // 120s grace after server start

  // ==================== 熔断器（风险控制）====================
  const CRASH_WINDOW_MS = 600000;   // 10 分钟滑动窗口
  const CRASH_THRESHOLD = 3;        // 窗口内 ≥3 次崩溃 → 熔断
  const BREAKER_RESET_MS = 120000;  // 熔断后 2 分钟自动尝试恢复
  const BREAKER_HARD_RESET_MS = 600000; // 彻底冷却 10 分钟

  function recordCrash() {
    const now = Date.now();
    state.ttsCrashHistory.push(now);
    state.ttsCrashesTotal = (state.ttsCrashesTotal || 0) + 1;
    // 裁剪超时条目
    while (state.ttsCrashHistory.length > 0 && state.ttsCrashHistory[0] < now - CRASH_WINDOW_MS) {
      state.ttsCrashHistory.shift();
    }
    // 检查是否达到熔断阈值
    if (state.ttsCrashHistory.length >= CRASH_THRESHOLD && !state.ttsBreakerTripped) {
      state.ttsBreakerTripped = true;
      state.ttsBreakerTrippedAt = now;
      state.ttsBreakerResetAt = now + BREAKER_RESET_MS;
      log('WARN', `🔴 TTS circuit breaker TRIPPED (${state.ttsCrashHistory.length} crashes in window) — local TTS paused`);
    }
  }

  function isBreakerClosed() {
    if (!state.ttsBreakerTripped) return true;
    const now = Date.now();
    // 首次熔断后 2min 尝试半开恢复
    if (state.ttsBreakerResetAt && now >= state.ttsBreakerResetAt) {
      state.ttsBreakerTripped = false;
      state.ttsBreakerTrippedAt = 0;
      state.ttsBreakerResetAt = 0;
      log('INFO', '🟡 TTS circuit breaker half-open — attempting recovery');
      return true;
    }
    return false;
  }

  // ==================== 文本语言检测 ====================
  function detectTextLang(text) {
    if (!text) return 'auto';
    const cjk = text.match(/[一-鿿]/g);
    const hiragana = text.match(/[぀-ゟ]/g);
    const katakana = text.match(/[゠-ヿ]/g);
    const cjkCount = cjk ? cjk.length : 0;
    const jaCount = (hiragana ? hiragana.length : 0) + (katakana ? katakana.length : 0);
    const total = cjkCount + jaCount;
    if (total === 0) return 'auto';
    return (jaCount / total) > 0.5 ? 'ja' : 'zh';
  }

  function parseWavInfo(audioBuf) {
    if (!audioBuf || audioBuf.length < 44) return null;
    if (audioBuf.toString('ascii', 0, 4) !== 'RIFF' || audioBuf.toString('ascii', 8, 12) !== 'WAVE') {
      return null;
    }

    let offset = 12;
    let fmt = null;
    let data = null;
    while (offset + 8 <= audioBuf.length) {
      const id = audioBuf.toString('ascii', offset, offset + 4);
      const size = audioBuf.readUInt32LE(offset + 4);
      const start = offset + 8;
      const end = start + size;
      if (end > audioBuf.length) break;

      if (id === 'fmt ' && size >= 16) {
        fmt = {
          audioFormat: audioBuf.readUInt16LE(start),
          channels: audioBuf.readUInt16LE(start + 2),
          sampleRate: audioBuf.readUInt32LE(start + 4),
          byteRate: audioBuf.readUInt32LE(start + 8),
          blockAlign: audioBuf.readUInt16LE(start + 12),
          bitsPerSample: audioBuf.readUInt16LE(start + 14)
        };
      } else if (id === 'data') {
        data = { offset: start, size };
      }

      offset = end + (size % 2);
      if (fmt && data) break;
    }

    if (!fmt || !data || !fmt.sampleRate || !fmt.channels || !fmt.bitsPerSample) return null;
    const bytesPerSec = fmt.byteRate || (fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8));
    return {
      ...fmt,
      dataOffset: data.offset,
      dataSize: data.size,
      durationSec: bytesPerSec > 0 ? data.size / bytesPerSec : 0
    };
  }

  function concatWavBuffers(buffers) {
    const valid = (buffers || []).filter(Boolean);
    if (valid.length === 0) throw new Error('no audio chunks to concatenate');
    if (valid.length === 1) return valid[0];

    const first = parseWavInfo(valid[0]);
    if (!first) throw new Error('invalid first WAV chunk');

    const chunks = valid.map((buffer, index) => {
      const info = parseWavInfo(buffer);
      if (!info) throw new Error(`invalid WAV chunk #${index + 1}`);
      const sameFormat = info.audioFormat === first.audioFormat
        && info.channels === first.channels
        && info.sampleRate === first.sampleRate
        && info.bitsPerSample === first.bitsPerSample;
      if (!sameFormat) throw new Error(`WAV chunk format mismatch #${index + 1}`);
      return { buffer, info };
    });

    const dataSize = chunks.reduce((sum, item) => sum + item.info.dataSize, 0);
    const out = Buffer.alloc(44 + dataSize);
    out.write('RIFF', 0);
    out.writeUInt32LE(36 + dataSize, 4);
    out.write('WAVE', 8);
    out.write('fmt ', 12);
    out.writeUInt32LE(16, 16);
    out.writeUInt16LE(first.audioFormat, 20);
    out.writeUInt16LE(first.channels, 22);
    out.writeUInt32LE(first.sampleRate, 24);
    const byteRate = first.sampleRate * first.channels * (first.bitsPerSample / 8);
    out.writeUInt32LE(byteRate, 28);
    out.writeUInt16LE(first.channels * (first.bitsPerSample / 8), 32);
    out.writeUInt16LE(first.bitsPerSample, 34);
    out.write('data', 36);
    out.writeUInt32LE(dataSize, 40);

    let writeOffset = 44;
    for (const { buffer, info } of chunks) {
      buffer.copy(out, writeOffset, info.dataOffset, info.dataOffset + info.dataSize);
      writeOffset += info.dataSize;
    }
    return out;
  }

  function splitTTSChunks(text) {
    const maxChars = config.tts.chunk_chars || 90;
    const minChars = 14;
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxChars) return [normalized];

    const parts = normalized.match(/[^。！？!?；;，,、]+[。！？!?；;，,、]?/g) || [normalized];
    const chunks = [];
    let current = '';

    const pushCurrent = () => {
      const value = current.trim();
      if (value) chunks.push(value);
      current = '';
    };

    for (const part of parts) {
      const item = part.trim();
      if (!item) continue;
      if ((current + item).length <= maxChars || current.length < minChars) {
        current += item;
      } else {
        pushCurrent();
        current = item;
      }

      while (current.length > maxChars * 1.35) {
        chunks.push(current.slice(0, maxChars));
        current = current.slice(maxChars);
      }
    }
    pushCurrent();

    for (let i = 1; i < chunks.length; i++) {
      if (chunks[i].length < minChars && chunks[i - 1].length + chunks[i].length <= maxChars + minChars) {
        chunks[i - 1] += chunks[i];
        chunks.splice(i, 1);
        i--;
      }
    }

    return chunks.length ? chunks : [normalized];
  }

  // ==================== 音频验证 ====================
  function validateAudioBuffer(audioBuf, text, originalLen) {
    if (!audioBuf || audioBuf.length < 1024) return { valid: false, reason: 'audio too small' };

    const wavInfo = parseWavInfo(audioBuf);
    if (!wavInfo) return { valid: false, reason: 'not a valid WAV buffer', size: audioBuf.length };
    const durationSec = wavInfo.durationSec;

    if (durationSec < 0.2) {
      return { valid: false, reason: `audio too short: ${durationSec.toFixed(1)}s`, duration: durationSec, size: audioBuf.length };
    }

    // 文本长度感知截断检测：V2 API 32000Hz 下截断输出 ~0.7-0.9s，
    // 0.06s/字 ≈ 16字/秒，区分正常(0.09-0.16s/字)和截断(0.04-0.06s/字)
    if (originalLen > 0) {
      const expectedMin = originalLen * 0.06;
      if (durationSec >= 0.2 && durationSec < expectedMin) {
        return { valid: false, reason: `truncated: ${durationSec.toFixed(2)}s for ${originalLen}chars (expected >=${expectedMin.toFixed(2)}s)`, duration: durationSec, size: audioBuf.length };
      }
    }

    // 捕获模型幻觉：短文本生成超长音频（如叹息声）
    if (originalLen > 0 && originalLen < 20 && durationSec > 30) {
      return { valid: false, reason: `audio too long for short text: ${durationSec.toFixed(0)}s/${originalLen}chars` };
    }

    // GPT-SoVITS v2pro 已知固定截断尺寸（V1 24000Hz + V2 32000Hz）
    const KNOWN_TRUNCATED = [47404, 65324, 24364, 34604, 37164, 48684, 58924, 61484, 64044, 71724, 76844];
    if (KNOWN_TRUNCATED.includes(audioBuf.length)) {
      return { valid: false, reason: `truncated size: ${audioBuf.length} (v2pro glitch)`, duration: durationSec, size: audioBuf.length };
    }

    if (audioBuf.length > 1000) {
      const dataStart = wavInfo.dataOffset;
      const sampleLen = Math.min(10000, audioBuf.length - dataStart);
      if (sampleLen > 100) {
        let maxAmplitude = 0;
        for (let i = dataStart + Math.floor(sampleLen * 0.3); i < dataStart + Math.floor(sampleLen * 0.7); i += 2) {
          const amp = Math.abs(audioBuf.readInt16LE(i));
          if (amp > maxAmplitude) maxAmplitude = amp;
        }
        if (maxAmplitude < 50) {
          return { valid: false, reason: 'audio is silence', duration: durationSec, size: audioBuf.length };
        }
      }
    }

    return { valid: true, duration: durationSec, size: audioBuf.length };
  }

  // ==================== 短文本补长 ====================
  function padShortText(text) {
    const cleaned = text.trim();
    // 短文本（<13 字）自动补长：模型读短文本快（~0.5s），
    // 补长后强制生成更多语义令牌，音频时长从 ~0.5s 提升到 1.2s+
    if (cleaned.length >= 13) return cleaned;
    return cleaned + '～' + cleaned;
  }

  // ==================== 解析音频路径 ====================
  function resolveAudio(p) {
    if (!p) p = 'models/sounds/congyu_ref.wav';
    const result = path.isAbsolute(p) ? p : path.join(appRoot, p);
    // GPT-SoVITS 是外部 Python 进程，无法读取 asar 内的文件
    let normalized = result;
    if (normalized.includes('.asar')) {
      normalized = normalized.replace('app.asar', 'app_current');
    }
    if (fs.existsSync(normalized)) {
      return normalized;
    }

    const fallbackCandidates = [
      path.join(appRoot, 'models', 'sounds', 'congyu_ref.wav'),
      path.join(appRoot, 'ref_audio', 'congyu_ref.wav')
    ];

    const baseName = path.basename(normalized || '');
    if (baseName) {
      fallbackCandidates.unshift(
        path.join(appRoot, 'ref_audio', baseName),
        path.join(appRoot, 'models', 'sounds', baseName),
        path.join(path.resolve(appRoot, '..', '..'), 'sounds', baseName)
      );
    }

    for (const candidate of fallbackCandidates) {
      if (candidate && fs.existsSync(candidate)) {
        log('WARN', `Resolved missing ref audio to fallback: ${candidate}`);
        return candidate;
      }
    }

    return normalized;
  }

  // ==================== 模型预热 ====================
  // 使用较长文本反复请求直到模型完全加载，超时返回 false
  async function warmupModel(timeoutMs = 120000) {
    const refAudio = resolveAudio(config.tts.ref_audio_path);
    if (!refAudio || !fs.existsSync(refAudio)) {
      log('WARN', 'TTS warmup skipped — ref audio missing');
      return false;
    }
    // 用 prompt_text（~17 字）作为预热文本，比单句「こんにちは」更能触发完整加载
    const warmupText = (config.tts.prompt_text || 'こんにちは。こんにちは。こんにちは。').repeat(2);
    const warmupLang = 'auto';
    const body = () => JSON.stringify({
      ref_audio_path: refAudio,
      prompt_text: config.tts.prompt_text || '',
      prompt_lang: config.tts.prompt_lang || 'ja',
      text_lang: warmupLang, text: warmupText,
      top_k: 15, top_p: 0.6, temperature: 0.8, speed_factor: 1.0,
      text_split_method: 'cut5', media_type: 'wav',
      streaming_mode: false, parallel_infer: true,
      repetition_penalty: 1.5, sample_steps: 32
    });
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt++;
      try {
        const r = await httpReq({
          hostname: config.gpt_sovits.hostname, port: config.gpt_sovits.port,
          path: config.gpt_sovits.endpoint, method: 'POST', timeout: Math.min(30000, deadline - Date.now()),
          headers: { 'Content-Type': 'application/json' }
        }, body(), Math.min(30000, deadline - Date.now()));
        // 验证实际音频时长（短文本正常应 >0.5s），排除模型未完全加载时产生的短音频/噪声
        if (r.status === 200 && r.body.length > 10000) {
          let durationSec = 0;
          if (r.body.length > 44 && r.body.toString('ascii', 0, 4) === 'RIFF') {
            const sampleRate = r.body.readUInt32LE(24);
            const channels = r.body.readUInt16LE(22);
            const bitsPerSample = r.body.readUInt16LE(34);
            const bytesPerSec = sampleRate * channels * (bitsPerSample / 8);
            durationSec = bytesPerSec > 0 ? (r.body.length - 44) / bytesPerSec : 0;
          }
          if (durationSec >= 1.0) {
            if (attempt > 1) log('INFO', `TTS warmup succeeded after ${attempt} attempts (${durationSec.toFixed(1)}s)`);
            return true;
          }
          // 时长过短 → 模型未完全加载，等待后重试
          log('DEBUG', `TTS warmup attempt ${attempt}: too short (${durationSec.toFixed(2)}s), retrying...`);
        }
      } catch {}
      const remaining = deadline - Date.now();
      if (remaining < 5000) break;
      await new Promise(r => setTimeout(r, Math.min(10000, remaining / 2)));
    }
    log('WARN', `TTS warmup failed after ${attempt} attempts`);
    return false;
  }

  // ==================== GPT-SoVITS 自动启动 ====================
  async function autoStartGPT() {
    // 将相对参考音频路径转为绝对路径，外部 Python 进程需要绝对路径
    try {
      if (config.tts.ref_audio_path && !path.isAbsolute(config.tts.ref_audio_path)) {
        const absRef = path.join(appRoot, config.tts.ref_audio_path);
        if (fs.existsSync(absRef)) config.tts.ref_audio_path = absRef;
      }
    } catch (e) {
      log('WARN', 'ref_audio_path absolute resolve failed:', e.message);
    }

    if (!config.gpt_sovits.auto_start) {
      log('INFO', 'GPT-SoVITS auto_start disabled');
      return false;
    }
    if (await checkPort(config.gpt_sovits.port)) {
      log('INFO', `GPT-SoVITS already running on port ${config.gpt_sovits.port}`);
      // 即使端口已开也执行预热，确保模型完全加载（冷启动时模型可能还在加载中）
      const warmed = await warmupModel(120000);
      state.ttsWarmupOk = warmed;
      if (warmed) {
        state.ttsReady = true;
        log('INFO', 'GPT-SoVITS model loaded and ready');
      } else {
        log('WARN', 'GPT-SoVITS warmup failed — model may not be ready');
      }
      return true;
    }

    const searchPaths = config.search_paths?.gpt_sovits || [];

    for (const base of searchPaths) {
      const pythonExe = path.join(base, 'runtime', 'python.exe');
      const apiPy = path.join(base, config.gpt_sovits.api_script || 'api_v2.py');
      if (!fs.existsSync(pythonExe) || !fs.existsSync(apiPy)) continue;

      const yamlConfig = config.gpt_sovits.config_yaml || 'GPT_SoVITS/configs/tts_infer.yaml';

      log('INFO', `Starting GPT-SoVITS V2 from: ${base}`);
      const proc = spawn(pythonExe, [
        apiPy, '-a', '127.0.0.1', '-p', String(config.gpt_sovits.port),
        '-c', yamlConfig,
      ], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

      proc.stdout.on('data', d => log('GPT', d.toString().trim()));
      proc.stderr.on('data', d => log('GPT', d.toString().trim()));
      proc.on('exit', (code, sig) => {
        log('WARN', `GPT-SoVITS exited (code=${code} signal=${sig})`);
        state.gptProcess = null;
        state.ttsReady = false;
        if (code !== 0 && sig !== 'SIGTERM' && sig !== 'SIGKILL' && config.gpt_sovits.auto_start && !state.shuttingDown) {
          log('INFO', 'GPT-SoVITS crashed — restarting in 5s...');
          setTimeout(() => autoStartGPT().then(ok => {
            if (ok) log('INFO', 'GPT-SoVITS restarted');
          }), 5000);
        }
      });

      state.gptProcess = proc;

      const timeout = config.gpt_sovits.startup_timeout_ms || 120000;
      const started = await waitForPort(config.gpt_sovits.port, timeout);
      if (started) {
        log('INFO', 'GPT-SoVITS ready');
        // 发送预热请求触发模型加载，等待真正的就绪
        log('INFO', 'Warming up GPT-SoVITS model (may take 30-90s)...');
        const warmed = await warmupModel(120000);
        state.ttsWarmupOk = warmed;
        if (warmed) {
          // 预热成功，标记就绪（预热导致的退化由 checkGPUCache + restartModel 处理）
          state.ttsReady = true;
          return true;
        }
        log('WARN', 'GPT-SoVITS warmup failed — model not ready');
        return false;
      }
      log('WARN', `GPT-SoVITS at ${base} failed within ${timeout}ms`);
    }

    log('WARN', 'GPT-SoVITS not found — TTS unavailable');
    return false;
  }

  // ==================== 模型热重启 ====================
  // 杀掉旧进程 → 等待端口释放 → 生成新进程
  async function restartModel() {
    const searchPaths = config.search_paths?.gpt_sovits || [];

    // 杀掉旧进程
    if (state.gptProcess) {
      log('INFO', '🧹 Killing old GPT-SoVITS process...');
      try { state.gptProcess.kill('SIGTERM'); } catch {}
      state.gptProcess = null;
    } else {
      log('INFO', `🧹 Clearing GPT-SoVITS port ${config.gpt_sovits.port}...`);
      try { await killPort(config.gpt_sovits.port); } catch {}
    }

    // 等待端口释放（最多 30s）
    log('INFO', '🧹 Waiting for port release...');
    for (let i = 0; i < 30; i++) {
      const inUse = await checkPort(config.gpt_sovits.port);
      if (!inUse) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    // 启动新进程
    for (const base of searchPaths) {
      const pythonExe = path.join(base, 'runtime', 'python.exe');
      const apiPy = path.join(base, config.gpt_sovits.api_script || 'api_v2.py');
      if (!fs.existsSync(pythonExe) || !fs.existsSync(apiPy)) continue;

      const yamlConfig = config.gpt_sovits.config_yaml || 'GPT_SoVITS/configs/tts_infer.yaml';
      log('INFO', `🧹 Starting fresh GPT-SoVITS from: ${base}`);
      const proc = spawn(pythonExe, [
        apiPy, '-a', '127.0.0.1', '-p', String(config.gpt_sovits.port),
        '-c', yamlConfig,
      ], { cwd: base, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

      proc.stdout.on('data', d => log('GPT', d.toString().trim()));
      proc.stderr.on('data', d => log('GPT', d.toString().trim()));
      proc.on('exit', (code, sig) => {
        log('WARN', `GPT-SoVITS exited (code=${code} signal=${sig})`);
        state.gptProcess = null;
        state.ttsReady = false;
        if (code !== 0 && sig !== 'SIGTERM' && sig !== 'SIGKILL' && config.gpt_sovits.auto_start && !state.shuttingDown) {
          setTimeout(() => restartModel().then(ok => {
            if (ok) log('INFO', 'GPT-SoVITS restarted');
          }), 5000);
        }
      });

      state.gptProcess = proc;

      const started = await waitForPort(config.gpt_sovits.port, config.gpt_sovits.startup_timeout_ms || 120000);
      if (started) {
        log('INFO', '🧹 GPT-SoVITS restarted successfully');
        return true;
      }
      log('WARN', `🧹 GPT-SoVITS restart at ${base} failed within timeout`);
    }

    log('WARN', '🧹 GPT-SoVITS restart not found');
    return false;
  }

  // ==================== TTS 健康检查 ====================
  // 只做端口检查：GPT-SoVITS v2pro 的 GET / 会导致 TypeError 崩溃
  async function probeTTS() {
    return await checkPort(config.gpt_sovits.port);
  }

  async function checkTTS() {
    try {
      const portOk = await checkPort(config.gpt_sovits.port);
      if (!portOk) {
        if (state.ttsReady) {
          state.ttsReady = false;
          log('WARN', `TTS disconnected (port ${config.gpt_sovits.port} unreachable)`);
          triggerTTSRestart(true);
        }
        return false;
      }

      const alive = await probeTTS();
      if (!alive) {
        ttsHealFailCount++;
        log('WARN', `TTS probe failed (${ttsHealFailCount}/${TTS_HEAL_FAIL_LIMIT})`);
        if (ttsHealFailCount >= TTS_HEAL_FAIL_LIMIT) {
          state.ttsReady = false;
          ttsHealFailCount = 0;
          triggerTTSRestart();
        }
        return false;
      }

      ttsHealFailCount = 0;
      // 只在预热完成后标记就绪，避免健康探测在模型未完全加载时误报
      if (!state.ttsReady && state.ttsWarmupOk) {
        state.ttsReady = true;
        log('INFO', 'TTS: ✅ ready');
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

  function triggerTTSRestart(force = false) {
    if (ttsRestartCount >= TTS_MAX_RESTARTS || !config.gpt_sovits.auto_start) {
      log('WARN', `TTS restart skipped (${ttsRestartCount}/${TTS_MAX_RESTARTS})`);
      return;
    }
    // 启动后宽限期内探针失败不重启（给模型加载时间），端口断开不受限
    if (!force && Date.now() - state.startTime < STARTUP_GRACE_MS) {
      log('DEBUG', `TTS restart deferred — within ${STARTUP_GRACE_MS}ms grace period`);
      return;
    }
    ttsRestartCount++;
    log('INFO', `Restart GPT-SoVITS #${ttsRestartCount}...`);
    autoStartGPT().then(ok => {
      if (ok) { ttsRestartCount = 0; ttsHealFailCount = 0; }
    });
  }

  // ==================== 本地 TTS 生成 ====================
  async function localTTS(text, customRef) {
    let refAudio = customRef?.ref_audio_path || config.tts.ref_audio_path;
    refAudio = resolveAudio(refAudio);

    const promptText = customRef?.prompt_text !== undefined ? customRef.prompt_text : config.tts.prompt_text;
    const promptLang = customRef?.prompt_lang || config.tts.prompt_lang;
    const textLang = customRef?._text_language || detectTextLang(text);

    if (!refAudio || !fs.existsSync(refAudio)) {
      throw new Error(`ref audio missing: ${refAudio || '(empty)'}`);
    }

    const bodyObj = {
      ref_audio_path: refAudio, prompt_text: promptText || '',
      prompt_lang: promptLang, text_lang: textLang,
      text, top_k: config.tts.top_k || 15,
      top_p: customRef?._top_p || config.tts.top_p || 0.6,
      temperature: customRef?._temperature || config.tts.temperature || 0.8,
      speed_factor: config.tts.speed || 1.0,
      text_split_method: customRef?._cut_punc || config.tts.text_split_method || 'cut5',
      media_type: 'wav', streaming_mode: false, parallel_infer: true,
      repetition_penalty: 1.5, sample_steps: config.tts.sample_steps || 32,
    };

    const body = JSON.stringify(bodyObj);

    return withRetry(async () => {
      const r = await httpReq({
        hostname: config.gpt_sovits.hostname, port: config.gpt_sovits.port,
        path: config.gpt_sovits.endpoint, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }, body, config.tts.timeout_ms);

      if (r.status === 200 && r.body.length > 1024) {
        const firstBytes = r.body.slice(0, 10).toString('ascii').toLowerCase();
        if (firstBytes.includes('<!doctype') || firstBytes.includes('<html')) {
          throw new Error('GPT-SoVITS error page');
        }
        if (r.body.length < 100000) {
          try {
            const jsonErr = JSON.parse(r.body.toString('utf-8'));
            if (jsonErr.error || jsonErr.message) {
              throw new Error(`GPT-SoVITS: ${jsonErr.error || jsonErr.message}`);
            }
          } catch (e) {
            if (e.message.startsWith('GPT-SoVITS:')) throw e;
          }
        }
        if (!parseWavInfo(r.body)) {
          throw new Error(`GPT-SoVITS returned non-WAV audio size=${r.body.length}`);
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

  // ==================== TTS 主入口（带队列）====================
  const TTS_FALLBACK_CONFIGS = [
    { label: 'standard', params: {} },
    { label: 'fallback#1', params: { _text_language: 'zh', _temperature: 0.7, _top_p: 0.7 } },
    { label: 'fallback#2', params: { _text_language: 'auto', _cut_punc: '' } },
  ];

  async function attemptTTSWithFallback(text, customRef, originalLen) {
    let lastError = null;
    for (const [fi, fb] of TTS_FALLBACK_CONFIGS.entries()) {
      const maxAttempts = fi < 2 ? 2 : 1;  // 前两套配置各 2 次，最后 1 次
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const enhancedRef = { ...(customRef || {}), ...fb.params };
          const audioBuf = await localTTS(text, enhancedRef);
          const validation = validateAudioBuffer(audioBuf, text, originalLen);
          if (validation.valid) {
            log('INFO', `TTS ${fb.label} OK: ${(audioBuf.length / 1024).toFixed(0)}KB`);
            return audioBuf;
          }
          log('WARN', `TTS ${fb.label} attempt ${attempt + 1}: ${validation.reason}`);
        } catch (e) {
          log('WARN', `TTS ${fb.label} attempt ${attempt + 1}: ${e.message}`);
          lastError = e;
        }
      }
      // 切换配置前给 VRAM 恢复时间
      await new Promise(r => setTimeout(r, 2000));
    }

    // GPT-SoVITS 崩溃恢复：全部失败且是连接错误时，等待端口恢复再试一次
    if (lastError && (lastError.message.includes('ECONNREFUSED') || lastError.message.includes('ECONNRESET'))) {
      log('WARN', 'GPT-SoVITS connection lost — waiting for recovery...');
      recordCrash(); // 记录崩溃到熔断器
      state.ttsReady = false;
      const recovered = await waitForPort(config.gpt_sovits.port, 20000);
      if (recovered) {
        log('INFO', 'GPT-SoVITS recovered — retrying');
        const audioBuf = await localTTS(text, { ...(customRef || {}), ...TTS_FALLBACK_CONFIGS[0].params });
        const val = validateAudioBuffer(audioBuf, text, originalLen);
        if (val.valid) {
          log('INFO', `TTS recovery OK: ${(audioBuf.length / 1024).toFixed(0)}KB`);
          return audioBuf;
        }
        log('WARN', `TTS recovery validation: ${val.reason}`);
      } else {
        log('WARN', 'GPT-SoVITS recovery timed out');
      }
    }

    throw new Error(`TTS failed after ${TTS_FALLBACK_CONFIGS.length} attempts`);
  }

  async function generateTTSChunks(text, customRef, originalLen) {
    const chunks = splitTTSChunks(text);
    if (chunks.length > 1) {
      log('INFO', `TTS split into ${chunks.length} chunks`);
    }

    const audioChunks = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = padShortText(chunks[i]);
      if (chunks.length > 1) {
        log('INFO', `TTS chunk ${i + 1}/${chunks.length}: "${chunkText.substring(0, 24)}..."`);
      }
      await ensureVRAMHeadroom();
      const chunkAudio = await attemptTTSWithFallback(chunkText, customRef, chunks[i].length);
      audioChunks.push(chunkAudio);
      state.ttsGenerationCount++;
    }

    const combined = concatWavBuffers(audioChunks);
    const validation = validateAudioBuffer(combined, text, originalLen);
    if (!validation.valid) {
      throw new Error(`combined TTS invalid: ${validation.reason}`);
    }
    return combined;
  }

  async function generateTTS(text, customRef) {
    // Remove control characters (U+0000-U+001F, U+007F-U+009F)
    const clean = text.replace(/[\x00-\x1f\x7f-\x9f]/g, '')
                      .replace(/[～~]/g, '')
                      .replace(/\n/g, '。')
                      .trim();
    if (!clean) throw new Error('empty text');

    // 熔断器检查：崩溃太频繁时暂缓本地 TTS
    if (!isBreakerClosed()) {
      const waitMs = state.ttsBreakerResetAt ? state.ttsBreakerResetAt - Date.now() : 0;
      throw new Error(`TTS local unavailable (breaker open, retry in ${Math.max(0, Math.ceil(waitMs / 1000))}s)`);
    }

    // 等待模型重启完成
    if (state.ttsRestarting) {
      log('INFO', 'TTS waiting for model restart...');
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        if (!state.ttsRestarting) break;
        await new Promise(r => setTimeout(r, 500));
      }
      if (state.ttsRestarting) {
        throw new Error('TTS timeout waiting for model restart');
      }
    }

    const originalLen = clean.length;
    const finalText = padShortText(clean);
    log('INFO', `TTS: "${finalText.substring(0, 30)}..." (orig=${originalLen}, padded=${finalText.length})`);

    if (state.ttsLock) {
      log('INFO', `TTS queued: "${finalText.substring(0, 20)}..." (orig=${originalLen})`);
      return new Promise((resolve, reject) => {
        state.ttsQueue.push({ text: finalText, customRef, resolve, reject, originalLen });
      });
    }

    state.ttsLock = true;
    try {
      const result = await generateTTSChunks(finalText, customRef, originalLen);
      checkGPUCache().catch(e => log('WARN', 'GPU cache error:', e.message));
      return result;
    } catch (e) {
      log('WARN', 'TTS all attempts failed:', e.message);
      throw e;
    } finally {
      await processTTSQueue();
    }
  }

  async function processTTSQueue() {
    while (state.ttsQueue.length > 0) {
      const { text, customRef, resolve, reject, originalLen } = state.ttsQueue.shift();
      try {
        const result = await generateTTSChunks(text, customRef, originalLen);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    }
    state.ttsLock = false;
  }

  // ==================== GPU 缓存管理 ====================
  async function getGPUInfo() {
    try {
      const { promisify } = require('util');
      const { exec } = require('child_process');
      const execP = promisify(exec);
      const { stdout } = await execP(
        'nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu --format=csv,noheader',
        { timeout: 5000 }
      );
      const parts = stdout.trim().split(',');
      return {
        name: parts[0]?.trim(), vram_used: parts[1]?.trim(),
        vram_total: parts[2]?.trim(), gpu_util: parts[3]?.trim()
      };
    } catch { return null; }
  }

  async function getVRAMUsagePercent() {
    try {
      const { promisify } = require('util');
      const { exec } = require('child_process');
      const execP = promisify(exec);
      const { stdout } = await execP(
        'nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits',
        { timeout: 3000 }
      );
      const parts = stdout.trim().split(',');
      const used = parseInt(parts[0]?.trim(), 10);
      const total = parseInt(parts[1]?.trim(), 10);
      if (!total) return 0;
      return (used / total) * 100;
    } catch { return -1; }
  }

  async function ensureVRAMHeadroom() {
    if (!config.gpu_cache?.enabled) return;
    const cfg = config.gpu_cache;
    const threshold = cfg.preflight_threshold_percent || Math.max(85, (cfg.vram_threshold_percent || 95) - 5);
    const vramPct = await getVRAMUsagePercent();
    if (vramPct >= 0 && vramPct >= threshold) {
      log('WARN', `TTS preflight: VRAM ${vramPct.toFixed(1)}% >= ${threshold}% — restarting before inference`);
      const ok = await triggerGPUCacheClear(true);
      if (!ok) {
        throw new Error(`TTS skipped: VRAM still high (${vramPct.toFixed(1)}%)`);
      }
      const afterPct = await getVRAMUsagePercent();
      if (afterPct >= 0 && afterPct >= threshold) {
        throw new Error(`TTS skipped: VRAM still high after restart (${afterPct.toFixed(1)}%)`);
      }
    }
  }

  async function triggerGPUCacheClear(force = false) {
    const cfg = config.gpu_cache;
    if (!cfg.enabled) return false;

    const now = Date.now();
    if (!force && now - state.lastGpuGcTime < cfg.cooldown_ms) {
      log('DEBUG', `GPU GC skipped — cooldown (${now - state.lastGpuGcTime}ms)`);
      return false;
    }

    log('INFO', '🧹 GPU cache clearing — restarting GPT-SoVITS...');
    state.lastGpuGcTime = now;
    state.ttsGenerationCount = 0;
    state.ttsReady = false;
    state.ttsRestarting = true;

    try {
      const ok = await restartModel();
      if (ok) {
        // 快速预热确保模型已加载
        log('INFO', '🧹 Warming up model after restart...');
        const warmed = await warmupModel(60000);
        if (warmed) {
          log('INFO', '🧹 GPT-SoVITS restarted and model loaded');
        } else {
          log('WARN', '🧹 Warmup after restart incomplete, continuing optimistically');
        }
        state.ttsReady = true;
      } else {
        log('WARN', '🧹 GPT-SoVITS restart failed');
      }
    } catch (e) {
      log('WARN', `🧹 GPU GC error: ${e.message}`);
    } finally {
      state.ttsRestarting = false;
    }
    return state.ttsReady;
  }

  async function checkGPUCache() {
    if (!config.gpu_cache?.enabled || state.ttsGenerationCount === 0) return;
    const cfg = config.gpu_cache;

    if (state.ttsGenerationCount >= cfg.max_generations) {
      log('INFO', `🧹 GPU GC: ${state.ttsGenerationCount} gens (max=${cfg.max_generations})`);
      await triggerGPUCacheClear();
      return;
    }

    // Don't GC while TTS queue has pending items — prevents killing GPT-SoVITS mid-use
    if (state.ttsQueue && state.ttsQueue.length > 0) return;

    // Enforce longer minimum interval between VRAM-triggered GC cycles
    // (separate from the general cooldown, which is shared with generation-count GC)
    const now = Date.now();
    if (state.lastVramGcTime && now - state.lastVramGcTime < 120000) return;

    const vramPct = await getVRAMUsagePercent();
    if (vramPct >= 0 && vramPct >= cfg.vram_threshold_percent) {
      log('INFO', `🧹 GPU GC: VRAM ${vramPct.toFixed(1)}% (threshold=${cfg.vram_threshold_percent}%)`);
      state.lastVramGcTime = now;
      await triggerGPUCacheClear();
    }
  }

  // ==================== 保存音频文件 ====================
  function saveAudioFile(buffer) {
    if (!parseWavInfo(buffer)) {
      throw new Error('refusing to save invalid TTS audio');
    }
    ensureDir(audioDir);
    const fn = `tts_${Date.now()}.wav`;
    fs.writeFileSync(path.join(audioDir, fn), buffer);
    return fn;
  }

  // ==================== 公共接口 ====================
  function resetBreaker() {
    state.ttsBreakerTripped = false;
    state.ttsBreakerTrippedAt = 0;
    state.ttsBreakerResetAt = 0;
    state.ttsCrashHistory = [];
    log('INFO', '🟢 TTS circuit breaker manually reset');
  }

  return {
    autoStartGPT,
    checkTTS,
    generateTTS,
    saveAudioFile,
    getGPUInfo,
    triggerGPUCacheClear,
    checkGPUCache,
    resetBreaker,
    getStatus: () => ({
      ready: state.ttsReady,
      mode: config.tts.mode,
      generationCount: state.ttsGenerationCount,
      gpt_sovits: config.gpt_sovits,
      breaker: {
        tripped: !!state.ttsBreakerTripped,
        crashesInWindow: state.ttsCrashHistory?.length || 0,
        crashesTotal: state.ttsCrashesTotal || 0,
        resetInMs: state.ttsBreakerResetAt ? Math.max(0, state.ttsBreakerResetAt - Date.now()) : 0
      }
    })
  };
}

module.exports = { createTTS };
