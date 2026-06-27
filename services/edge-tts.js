/**
 * Edge TTS 服务模块
 * 使用微软 Edge TTS 引擎（通过 edge-tts CLI）
 * 免费、无需安装额外依赖
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 可用语音列表
const VOICES = {
  'zh-CN-XiaoxiaoNeural': { name: '晓晓', lang: 'zh-CN', gender: 'Female' },
  'zh-CN-YunxiNeural':    { name: '云希', lang: 'zh-CN', gender: 'Male' },
  'zh-CN-XiaoyiNeural':   { name: '晓依', lang: 'zh-CN', gender: 'Female' },
  'zh-CN-YunjianNeural':  { name: '云健', lang: 'zh-CN', gender: 'Male' },
  'ja-JP-NanamiNeural':   { name: '七海', lang: 'ja-JP', gender: 'Female' },
  'ja-JP-KeitaNeural':    { name: '圭太', lang: 'ja-JP', gender: 'Male' },
  'en-US-AriaNeural':     { name: 'Aria', lang: 'en-US', gender: 'Female' },
  'en-US-GuyNeural':      { name: 'Guy', lang: 'en-US', gender: 'Male' },
};

// 查找 edge-tts 可执行文件
function findEdgeTTS() {
  const candidates = [
    'edge-tts',
    path.join(process.env.USERPROFILE || '', '.venv', 'Scripts', 'edge-tts.exe'),
    path.join(process.env.USERPROFILE || '', 'Desktop', 'weiban-tool-1.7.2', '.venv', 'Scripts', 'edge-tts.exe'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return 'edge-tts'; // fallback to PATH
}

const EDGE_TTS_CMD = findEdgeTTS();

/**
 * 使用 Edge TTS 合成语音
 * @param {string} text - 要合成的文本
 * @param {object} options - 配置项
 * @param {string} options.voice - 语音名称
 * @param {string} options.rate - 语速 (如 '+10%')
 * @returns {Promise<Buffer>} - 音频数据 (MP3)
 */
function synthesize(text, options = {}) {
  const voice = options.voice || 'zh-CN-XiaoxiaoNeural';
  const rate = options.rate || '+0%';

  return new Promise((resolve, reject) => {
    // 写入临时文本文件避免编码问题
    const tmpTextFile = path.join(os.tmpdir(), `edge-tts-in-${Date.now()}.txt`);
    const tmpAudioFile = path.join(os.tmpdir(), `edge-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);

    fs.writeFileSync(tmpTextFile, text, 'utf-8');

    const args = [
      '--voice', voice,
      '--rate', rate,
      '--file', tmpTextFile,
      '--write-media', tmpAudioFile,
    ];

    const proc = spawn(EDGE_TTS_CMD, args, {
      windowsHide: true,
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
      // 强制使用 UTF-8 编码
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      // 清理临时文本文件
      try { fs.unlinkSync(tmpTextFile); } catch {}

      if (code !== 0) {
        try { if (fs.existsSync(tmpAudioFile)) fs.unlinkSync(tmpAudioFile); } catch {}
        return reject(new Error(`Edge TTS exit code ${code}: ${stderr.slice(0, 200)}`));
      }

      try {
        if (!fs.existsSync(tmpAudioFile)) {
          return reject(new Error('Edge TTS did not produce output file'));
        }
        const audio = fs.readFileSync(tmpAudioFile);
        fs.unlinkSync(tmpAudioFile);

        if (audio.length < 500) {
          return reject(new Error('Edge TTS produced empty audio'));
        }

        resolve(audio);
      } catch (e) {
        reject(new Error('Edge TTS output read failed: ' + e.message));
      }
    });

    proc.on('error', (err) => {
      try { fs.unlinkSync(tmpTextFile); } catch {}
      reject(new Error('Edge TTS spawn failed: ' + err.message));
    });
  });
}

/**
 * 检查 Edge TTS 是否可用
 */
function isAvailable() {
  return new Promise((resolve) => {
    const proc = spawn(EDGE_TTS_CMD, ['--version'], { windowsHide: true, timeout: 5000 });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', () => resolve(out.includes('edge-tts')));
    proc.on('error', () => resolve(false));
  });
}

module.exports = { synthesize, VOICES, isAvailable };
