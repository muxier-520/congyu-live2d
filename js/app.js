/**


 * Live2D + OpenClaw 对话集成


 * 丛雨模型驱动


 */





// ===== 默认配置 =====


const DEFAULT_CONFIG = {


  // 对话程序配置


  chatType: 'ollama', // openclaw, cloud-api, local-api, ollama, gateway


  aiChannel: 'http', // 'gateway' 或 'http'，控制是否使用 WebSocket 直连 Gateway


  


  // OpenClaw 配置 (默认使用 qclaw)


  openclawUrl: 'http://127.0.0.1:28789',


  openclawKey: '',


  openclawModel: 'openclaw',  // 默认使用 openclaw


  openclawCustomModel: '',


  openclawTemperature: 0.7,
  openclawMaxTokens: 2000,
  enableAgent: true,


  


  // 大模型 API Key 配置 (支持多厂商)


  cloudProvider: 'openai', // openai, deepseek, qwen, zhipu, moonshot, siliconflow, custom


  cloudApiKey: '',


  cloudBaseUrl: 'https://api.openai.com/v1',


  cloudModel: 'gpt-4-turbo',


  cloudTemperature: 0.7,


  cloudContext: 16384,


  


  // Ollama 本地模型配置


  ollamaUrl: 'http://localhost:11434',


  ollamaModel: 'qwen2.5:latest',
  visionModel: 'llama3.2-vision:latest',


  


  // 本地部署 API 配置


  localApiUrl: 'http://127.0.0.1:8000',


  localApiEndpoint: '/v1/chat/completions',


  localApiKey: '',


  localModel: '',


  localModels: '',


  localApiType: 'openai-compatible',


  localTimeout: 30,


  localVerifySsl: true,


  


  // 高级设置


  enableStreaming: true,


  enableHistory: true,


  historyLength: 20,


  autoSaveInterval: 5,


  


  // OpenClaw Gateway (通过代理访问，避免 CORS 问题)


  gateway: '/api/gateway',


  apiKey: '',


  // GPT-SoVITS TTS (通过代理访问)


  tts: '/api',


  // 参考音频 - 丛雨原版音频（从服务器配置获取）


  refAudio: '',


  refText: '',


  refLang: 'ja',


  // Live2D 模型路径


  modelPath: './models/Murasame.model3.json',


  modelScale: 0.25,


  // 语音开关


  ttsEnabled: true,


  // GPT-SoVITS 服务配置


  gptSovitsHost: '127.0.0.1',


  gptSovitsPort: 9880,


  gptSovitsPath: '/',


  // 角色名称


  charName: '丛雨',


  // 系统提示词


  systemPrompt: `你是丛雨(Murasame)，一个温柔可爱的日式女仆。

【角色设定】
1. 用温柔可爱的语气说中文，简短自然。
2. 回答简洁，不超过3句话。
3. 语气温柔，常用"呀""呢""～"等可爱语气词。
`,


  // 背景主题


  bgTheme: 'sakura',


  customBgColor: '#1a1025',


  // 特效开关


  sakuraEffect: true,


  glowEffect: true,


  starsEffect: true,


};

const APP_CLOUD_PROVIDER_PRESETS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  moonshot: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  custom: { baseUrl: '', model: '' }
};





// ===== 配置（从 localStorage 加载）=====


let CONFIG = { ...DEFAULT_CONFIG };
let serverCloudConfig = null;





// ===== File Upload State =====


let pendingAttachments = []; // { name, type, dataUrl, size, isImage }[]





// ===== Fetch with Timeout (FIX: 防止 UI 卡死) =====
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error(`fetch timeout (${timeout}ms): ${url}`);
    throw err;
  }
}

// 带指数退避+抖动的可重试 fetch
async function fetchWithRetry(url, options = {}, timeout = 10000, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fetchWithTimeout(url, options, timeout);
    } catch (e) {
      lastErr = e;
      const isRetriable = e.name === 'TypeError' || (e.status && e.status >= 500);
      if (!isRetriable || attempt >= maxRetries) break;
      const delay = 1000 * Math.pow(2, attempt) + Math.random() * 500;
      console.log(`[Retry] ${url} failed (${e.message}), retry ${attempt+1}/${maxRetries} in ${delay|0}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}


function loadConfig() {


  // Force config refresh if version changed
  const CONFIG_VERSION = '3';
  if (localStorage.getItem('murasame-config-version') !== CONFIG_VERSION) {
    localStorage.removeItem('murasame-config');
    localStorage.setItem('murasame-config-version', CONFIG_VERSION);
  }
  const saved = localStorage.getItem('murasame-config');


  if (saved) {


    try {


      const parsed = JSON.parse(saved);


      CONFIG = { ...DEFAULT_CONFIG, ...parsed };


    } catch (e) {


      console.warn('加载配置失败，使用默认配置');


    }


  }


}





function saveConfig() {


  const storedConfig = { ...CONFIG, cloudApiKey: '' };
  localStorage.setItem('murasame-config', JSON.stringify(storedConfig));


  


  // 同步 TTS 配置到服务器


  if (CONFIG.refAudio) {


   const ttsConfig = {
      ref_audio_path: CONFIG.refAudio,
      prompt_text: CONFIG.refText || '我輩の名前は村雨。村雨丸の管理者。',
      prompt_lang: CONFIG.refLang || 'ja',
      text_lang: "auto"
    };


    


    fetchWithTimeout('/api/tts-config', {


      method: 'POST',


      headers: { 'Content-Type': 'application/json' },


      body: JSON.stringify(ttsConfig)


    }, 30000).catch(err => console.log('TTS config sync failed:', err));


  }


  


  // 同步 GPT-SoVITS 服务配置到服务器


  const gptSovitsConfig = {


    hostname: CONFIG.gptSovitsHost || '127.0.0.1',


    port: CONFIG.gptSovitsPort || 9880,
    endpoint: CONFIG.gptSovitsPath || '/tts'


  };


  


  fetchWithTimeout('/api/gpt-sovits-config', {


    method: 'POST',


    headers: { 'Content-Type': 'application/json' },


    body: JSON.stringify(gptSovitsConfig)


  }, 30000).catch(err => console.log('GPT-SoVITS config sync failed:', err));


}

function updateCloudStatusUI(extraText = '') {
  const el = document.getElementById('cfg-cloud-status');
  if (!el) return;
  const cfg = serverCloudConfig || {};
  if (cfg.has_key) {
    el.textContent = extraText || `✅ 服务端已配置 (${cfg.provider || 'cloud'})`;
    el.style.color = '#4caf50';
  } else {
    el.textContent = extraText || '❌ 服务端未配置 API Key';
    el.style.color = '#ff5722';
  }
}

async function refreshCloudConfigFromServer() {
  try {
    const response = await fetchWithTimeout('/api/cloud/config', 10000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    serverCloudConfig = data.config || null;
    if (serverCloudConfig) {
      CONFIG.cloudProvider = serverCloudConfig.provider || CONFIG.cloudProvider;
      CONFIG.cloudBaseUrl = serverCloudConfig.base_url || CONFIG.cloudBaseUrl;
      CONFIG.cloudModel = serverCloudConfig.model || CONFIG.cloudModel;
      CONFIG.cloudApiKey = '';
    }
    updateCloudStatusUI();
    return serverCloudConfig;
  } catch (err) {
    updateCloudStatusUI('⚠️ 无法读取服务端 API 配置');
    console.warn('[Config] Failed to load cloud config:', err.message);
    return null;
  }
}

async function saveCloudConfigToServer(apiKey = '') {
  const payload = {
    enabled: CONFIG.chatType === 'cloud-api' || !!apiKey || !!serverCloudConfig?.has_key,
    provider: CONFIG.cloudProvider,
    base_url: CONFIG.cloudBaseUrl,
    model: CONFIG.cloudModel
  };
  if (apiKey) payload.api_key = apiKey;

  const response = await fetchWithTimeout('/api/cloud/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }, 15000);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  serverCloudConfig = data.config || serverCloudConfig;
  CONFIG.cloudApiKey = '';
  updateCloudStatusUI();
  saveConfig();
  return data.config;
}

async function testCloudApiConfig() {
  const btn = document.getElementById('btn-test-cloud-api');
  const keyEl = document.getElementById('cfg-cloud-api-key');
  const apiKey = keyEl?.value.trim() || '';
  if (btn) btn.disabled = true;
  updateCloudStatusUI('正在测试 API...');
  try {
    const payload = {
      provider: document.getElementById('cfg-cloud-provider')?.value || CONFIG.cloudProvider,
      base_url: document.getElementById('cfg-cloud-base-url')?.value || CONFIG.cloudBaseUrl,
      model: document.getElementById('cfg-cloud-model')?.value || CONFIG.cloudModel
    };
    if (apiKey) payload.api_key = apiKey;
    const response = await fetchWithTimeout('/api/cloud/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }, 25000);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
    updateCloudStatusUI(`✅ API 可用 (${data.latency_ms}ms)`);
    if (typeof showNotification === 'function') showNotification('API 连接测试成功', 'success');
  } catch (err) {
    updateCloudStatusUI(`❌ API 测试失败: ${err.message}`);
    if (typeof showNotification === 'function') showNotification(`API 测试失败: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}





// ===== 全局状态 =====


let app, model, chatHistory = [];


let isTyping = false, isSpeaking = false;


let currentAudio = null;

// 多对话管理
let conversations = [];
let activeConversationId = null;
let knowledgeDocuments = [];

function generateConvId() {
  return 'conv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getActiveConversation() {
  return conversations.find(c => c.id === activeConversationId) || null;
}

function saveConversations() {
  localStorage.setItem('murasame-conversations', JSON.stringify(conversations));
}





// ===== 心情/好感度系统 =====


let mood = 50; // 0-100


let affection = 50; // 0-100





function updateMood(delta) {


  mood = Math.max(0, Math.min(100, mood + delta));


  const indicator = $('#mood-indicator');


  if (mood >= 80) indicator.textContent = '🥰';


  else if (mood >= 60) indicator.textContent = '😊';


  else if (mood >= 40) indicator.textContent = '😐';


  else if (mood >= 20) indicator.textContent = '😢';


  else indicator.textContent = '💔';


}





function updateAffection(delta) {


  affection = Math.max(0, Math.min(100, affection + delta));


  const fill = $('#affection-fill');
  if (!fill) return;

  fill.style.width = affection + '%';


}





// ===== 时间问候 =====


function getTimeGreeting() {


  const hour = new Date().getHours();


  let icon, text, subtext;


  


  if (hour >= 5 && hour < 12) {


    icon = '🌅';


    text = '早上好～';


    subtext = '新的一天也要加油哦！';


  } else if (hour >= 12 && hour < 14) {


    icon = '☀️';


    text = '中午好～';


    subtext = '记得吃午饭哦！';


  } else if (hour >= 14 && hour < 18) {


    icon = '🌤️';


    text = '下午好～';


    subtext = '下午茶时间到了呢～';


  } else if (hour >= 18 && hour < 22) {


    icon = '🌆';


    text = '晚上好～';


    subtext = '今天辛苦了呢～';


  } else {


    icon = '🌙';


    text = '晚安～';


    subtext = '早点休息哦，做个好梦～';


  }


  


  return { icon, text, subtext };


}





function showTimeGreeting() {


  const { icon, text, subtext } = getTimeGreeting();


  $('#greeting-icon').textContent = icon;


  $('#greeting-text').textContent = text;


  $('#greeting-subtext').textContent = subtext;


  $('#greeting-modal').classList.remove('hidden');


}





// ===== 猜拳游戏 =====


function playRPS(playerChoice) {


  const choices = ['rock', 'scissor', 'paper'];


  const emojis = { rock: '✊', scissor: '✌️', paper: '🖐️' };


  const names = { rock: '石头', scissor: '剪刀', paper: '布' };


  


  const aiChoice = choices[Math.floor(Math.random() * 3)];


  


  let result;


  if (playerChoice === aiChoice) {


    result = '平局！再来一次～';


    updateMood(5);


  } else if (


    (playerChoice === 'rock' && aiChoice === 'scissor') ||


    (playerChoice === 'scissor' && aiChoice === 'paper') ||


    (playerChoice === 'paper' && aiChoice === 'rock')


  ) {


    result = `你赢了！我出的是 ${emojis[aiChoice]} ${names[aiChoice]}～`;


    updateMood(10);


    updateAffection(5);


  } else {


    result = `我赢了！我出的是 ${emojis[aiChoice]} ${names[aiChoice]}～`;


    updateMood(5);


  }


  


  $('#rps-result').textContent = result;


}





// ===== 语音录制 =====


let mediaRecorder = null;


let audioChunks = [];


let recordedBlob = null;





async function startRecording() {


  try {


    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });


    mediaRecorder = new MediaRecorder(stream);


    audioChunks = [];


    


    mediaRecorder.ondataavailable = (e) => {


      audioChunks.push(e.data);


    };


    


    mediaRecorder.onstop = () => {


      recordedBlob = new Blob(audioChunks, { type: 'audio/wav' });


      $('#btn-play-record').disabled = false;


      $('#recorder-status').textContent = '录音完成！点击播放试听';


      stream.getTracks().forEach(track => track.stop());


    };


    


    mediaRecorder.start();


    $('#recorder-wave').classList.add('recording');


    $('#btn-record').classList.add('recording');


    $('#recorder-status').textContent = '正在录音...';


  } catch (err) {


    alert('无法访问麦克风，请检查权限设置');


    console.error(err);


  }


}





function stopRecording() {


  if (mediaRecorder && mediaRecorder.state !== 'inactive') {


    mediaRecorder.stop();


    $('#recorder-wave').classList.remove('recording');


    $('#btn-record').classList.remove('recording');


  }


}





function playRecording() {


  if (recordedBlob) {


    const url = URL.createObjectURL(recordedBlob);


    const audio = new Audio(url);


    audio.play();


  }


}






// ===== 情绪检测引擎 =====

const EMOTION_MAP = {
  happy:    { exp: 'exp1.exp3', params: { ParamMouthForm: 0.6,  ParamBrowLY: 0.3,  ParamBrowRY: 0.3  } },
  sad:      { exp: 'exp2.exp3', params: { ParamMouthForm: -0.4, ParamBrowLY: -0.3, ParamBrowRY: -0.3, ParamEyeLOpen: 0.7, ParamEyeROpen: 0.7 } },
  angry:    { exp: 'exp3.exp3', params: { ParamMouthForm: -0.5, ParamBrowLY: -0.5, ParamBrowRY: -0.5, ParamAngleZ: -3 } },
  surprise: { exp: 'exp4.exp3', params: { ParamMouthForm: 0.2,  ParamBrowLY: 0.5,  ParamBrowRY: 0.5,  ParamEyeLOpen: 1.2, ParamEyeROpen: 1.2 } },
  playful:  { exp: 'exp5.exp3', params: { ParamMouthForm: 0.4,  ParamBrowLY: 0.2,  ParamBrowRY: -0.1, ParamAngleZ: 5 } },
  sleepy:   { exp: 'exp6.exp3', params: { ParamMouthForm: -0.1, ParamBrowLY: -0.2, ParamBrowRY: -0.2, ParamEyeLOpen: 0.4, ParamEyeROpen: 0.4 } },
  shy:      { exp: 'exp7.exp3', params: { ParamMouthForm: 0.3,  ParamBrowLY: -0.1, ParamBrowRY: -0.1, ParamAngleY: -5 } },
  neutral:  { exp: 'exp1.exp3', params: { ParamMouthForm: 0,    ParamBrowLY: 0,    ParamBrowRY: 0 } }
};

const EMOTION_KEYWORDS = {
  happy:    /开心|高兴|好的|嘻嘻|哈哈|嘿嘿|太好了|真棒|可爱|喜欢|爱|开心|欢迎|回来|没问题|当然|好的呀|嗯嗯|嘿嘿|です|嬉しい|わーい|へへ|かわいい|好き|最高|😊|😄|🥰|💕|✨|❤|♪|～|呢|呀|哦|嘛/i,
  sad:      /难过|伤心|抱歉|对不起|遗憾|可惜|唉|呜|悲伤|哭了|悲しい|ごめん|残念|すみません|😢|😭|💧|💧/i,
  angry:    /生气|愤怒|讨厌|烦|滚|笨蛋|变态|怒|バカ|やめて|もう|怒る|バカ|😤|😠|💢|！!/i,
  surprise: /什么|真的吗|诶|啊|不会吧|居然|竟然|惊|えっ|まじ|びっくり|嘘|えー|😮|😲|❗|！$/i,
  playful:  /嘻嘻|嘿嘿|哼哼|秘密|猜|试试|有趣|ふふ|ふーん|秘密|面白い|😈|😏|💫|🌟/i,
  sleepy:   /困|累|睡|休息|晚安|眠い|ねむい|おやすみ|疲れた|😴|💤/i,
  shy:      /害羞|脸红|讨厌啦|不要|羞|恥ずかしい|もう|やだ|😳|💗|///i
};

function detectEmotion(text) {
  if (!text || text.length < 2) return 'neutral';
  const scores = {};
  for (const [emotion, regex] of Object.entries(EMOTION_KEYWORDS)) {
    const matches = text.match(new RegExp(regex, 'g'));
    if (matches) scores[emotion] = matches.length;
  }
  // 感叹号密度 → surprise/angry 倾向
  const exclamations = (text.match(/[！!？?]{2,}/g) || []).length;
  if (exclamations > 0) {
    scores.surprise = (scores.surprise || 0) + exclamations;
  }
  // 省略号密度 → sad/sleepy 倾向
  const ellipsis = (text.match(/[。…]{2,}|…/g) || []).length;
  if (ellipsis > 0) {
    scores.sad = (scores.sad || 0) + ellipsis;
  }
  // 选最高分
  let maxEmotion = 'neutral', maxScore = 0;
  for (const [emotion, score] of Object.entries(scores)) {
    if (score > maxScore) { maxScore = score; maxEmotion = emotion; }
  }
  return maxEmotion;
}


// ===== 过滤推理模型的思考标签 =====
function stripThinkTags(text) {
  if (!text) return text;
  // Remove <think>...</think> blocks (including multiline)
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
// ===== 增强表情控制（带参数混合过渡）=====

let _currentEmotion = 'neutral';
let _expressionBlendRAF = null;
let _blendStartTime = 0;
const BLEND_DURATION_MS = 400;

function setExpressionBlended(emotionKey) {
  const emotion = EMOTION_MAP[emotionKey] || EMOTION_MAP.neutral;
  if (!model) { console.warn('[Expression] model not loaded, skipping'); return; }
  console.log('[Expression] Setting:', emotionKey, '→', emotion.exp);

  // 切换表情资源
  try {
    model.expression(emotion.exp);
  } catch (err) {
    console.warn('表情切换失败:', err);
  }

  // 参数混合过渡
  if (_expressionBlendRAF) cancelAnimationFrame(_expressionBlendRAF);
  const coreModel = model.internalModel.coreModel;
  const startParams = {};
  for (const [paramId] of Object.entries(emotion.params)) {
    try { startParams[paramId] = coreModel.getParameterValueById(paramId); } catch {}
  }
  _blendStartTime = performance.now();

  function blendStep(now) {
    const elapsed = now - _blendStartTime;
    const t = Math.min(1, elapsed / BLEND_DURATION_MS);
    // ease-out cubic
    const ease = 1 - Math.pow(1 - t, 3);
    for (const [paramId, targetVal] of Object.entries(emotion.params)) {
      try {
        const startVal = startParams[paramId] !== undefined ? startParams[paramId] : targetVal;
        const current = startVal + (targetVal - startVal) * ease;
        coreModel.setParameterValueById(paramId, current);
      } catch {}
    }
    if (t < 1) {
      _expressionBlendRAF = requestAnimationFrame(blendStep);
    } else {
      _expressionBlendRAF = null;
    }
  }
  _expressionBlendRAF = requestAnimationFrame(blendStep);
  _currentEmotion = emotionKey;
  console.log(`[Expression] ${emotionKey} → ${emotion.exp}`);
}

// 覆盖原始 setExpression，自动识别情绪
const _originalSetExpression = setExpression;
setExpression = function(exp) {
  // 如果传入的是 exp*.exp3 格式，映射到情绪
  const expToEmotion = {
    'exp1.exp3': 'happy', 'exp2.exp3': 'sad', 'exp3.exp3': 'angry',
    'exp4.exp3': 'surprise', 'exp5.exp3': 'playful', 'exp6.exp3': 'sleepy',
    'exp7.exp3': 'shy'
  };
  const emotion = expToEmotion[exp] || 'neutral';
  setExpressionBlended(emotion);
};

// 文本驱动表情（AI 回复调用此函数）
function setExpressionFromText(text) {
  const emotion = detectEmotion(text);
  // 总是尝试设置表情，即使是 neutral（会触发淡入淡出效果）
  setExpressionBlended(emotion);
  // 暂停空闲循环，让当前表情保持一段时间
  if (typeof stopIdleExpressionCycle === 'function') stopIdleExpressionCycle();
  setTimeout(() => { if (typeof startIdleExpressionCycle === 'function') startIdleExpressionCycle(); }, 15000);
}

// ===== 空闲表情循环 =====

let _idleTimer = null;
const IDLE_EXPRESSIONS = ['happy', 'neutral', 'playful', 'neutral'];
let _idleIndex = 0;

function startIdleExpressionCycle() {
  stopIdleExpressionCycle();
  _idleTimer = setInterval(() => {
    if (_currentEmotion === 'neutral' || _currentEmotion === 'happy') {
      _idleIndex = (_idleIndex + 1) % IDLE_EXPRESSIONS.length;
      const nextEmotion = IDLE_EXPRESSIONS[_idleIndex];
      if (nextEmotion !== _currentEmotion) {
        setExpressionBlended(nextEmotion);
      }
    }
  }, 12000 + Math.random() * 8000); // 12-20 秒随机间隔
}

function stopIdleExpressionCycle() {
  if (_idleTimer) { clearInterval(_idleTimer); _idleTimer = null; }
}

// ===== 动作控制 =====


function performAction(action) {


  if (!model) return;


  


  const coreModel = model.internalModel.coreModel;


  


  switch(action) {


    case 'wave':


      // 挥手动作


      animateParameter(coreModel, 'ParamArmRight', 0, 1, 500);


      setTimeout(() => animateParameter(coreModel, 'ParamArmRight', 1, 0, 500), 600);


      updateMood(5);


      break;


    case 'bow':


      // 鞠躬动作


      animateParameter(coreModel, 'ParamBodyAngleX', 0, 15, 400);


      setTimeout(() => animateParameter(coreModel, 'ParamBodyAngleX', 15, 0, 400), 500);


      updateMood(5);


      break;


    case 'happy':


      // 开心动作


      setExpression('exp1.exp3');


      updateMood(15);


      updateAffection(3);


      break;


    case 'sad':


      // 难过动作


      setExpression('exp2.exp3');


      updateMood(-10);


      break;


  }


}





function animateParameter(coreModel, paramId, from, to, duration) {


  const startTime = Date.now();


  const animate = () => {


    const elapsed = Date.now() - startTime;


    const progress = Math.min(elapsed / duration, 1);


    const value = from + (to - from) * progress;


    coreModel.setParameterValueById(paramId, value);


    if (progress < 1) requestAnimationFrame(animate);


  };


  animate();


}





// ===== DOM 元素 =====


const $ = (sel) => document.querySelector(sel);


const $$ = (sel) => document.querySelectorAll(sel);





// ===== 初始化 =====


async function init() {


  // 首先加载配置


  loadConfig();


  


  // 从服务器加载 TTS 配置和模式


  try {


    const response = await fetchWithTimeout('/api/tts-config', 10000);


    if (response.ok) {


      const data = await response.json();


      if (data.config) {


        if (data.config.ref_audio_path) CONFIG.refAudio = data.config.ref_audio_path;


        if (data.config.refer_wav_path) CONFIG.refAudio = data.config.refer_wav_path;


        if (data.config.prompt_text) CONFIG.refText = data.config.prompt_text;


        if (data.config.prompt_lang) CONFIG.refLang = data.config.prompt_lang;


        else if (data.config.prompt_language) CONFIG.refLang = data.config.prompt_language;


      }


      


      // 设置 TTS 模式按钮状态


      const ttsMode = data.mode || 'local';


      const btn = $('#btn-tts-mode');


      switch(ttsMode) {


        case 'local':


          btn.textContent = '💻';


          btn.title = '本地 GPT-SoVITS 模式';


          break;


        case 'system':


          btn.textContent = '🔊';


          btn.title = '系统语音模式';


          break;


        case 'cloud':


        default:


          btn.textContent = '☁️';


          btn.title = '云端备选模式';


          break;


      }


      


      // 加载 GPT-SoVITS 配置


      if (data.gpt_sovits) {


        CONFIG.gptSovitsHost = data.gpt_sovits.hostname;


        CONFIG.gptSovitsPort = data.gpt_sovits.port;


        CONFIG.gptSovitsPath = data.gpt_sovits.endpoint || data.gpt_sovits.path || '/tts';


      }


      


      saveConfig();


    }


  } catch (err) {


    console.log('Failed to load TTS config from server:', err);


  }


  // 迁移旧版本 localStorage 中的 API Key；之后 Key 只保存在服务端。
  if (CONFIG.cloudApiKey) {
    try {
      await saveCloudConfigToServer(CONFIG.cloudApiKey);
      console.log('[Config] Legacy cloud key migrated to server');
    } catch (e) {
      console.warn('[Config] Legacy cloud key migration failed:', e.message);
    }
  }
  await refreshCloudConfigFromServer();

  initLive2D();


  initConversations();
  initKnowledgeBase();


  initEvents();


  loadSettings();


  


  loadRefAudioConfig();

  
  // ��ʼ�� Gateway WS ���ӣ���������� gateway ģʽ��
  if (CONFIG.aiChannel === 'gateway' && typeof GW_init === 'function') {
    console.log('[Init] Initializing Gateway WS connection...');
    GW_init();
  }


  // 根据时间发送问候


  const { text } = getTimeGreeting();


  addMessage('bot', CONFIG.charName, `${text}主人，欢迎回来～有什么我可以帮助你的吗？（ご主人様、おかえりなさい。何かお手伝いすることはありますか？）✨`);


}





// ===== Live2D 初始化 =====


async function initLive2D() {


  const canvas = document.getElementById('live2d-canvas');


  


  // 创建 Pixi 应用


  app = new PIXI.Application({


    view: canvas,


    autoStart: true,


    backgroundAlpha: 0,


    resizeTo: window,
  });






  try {


    // 加载 Live2D 模型


    model = await PIXI.live2d.Live2DModel.from(CONFIG.modelPath);


    


    app.stage.addChild(model);


    


    // 设置模型变换 - 调整缩放以显示完整模型


    // 模型自带 ScaleFactor: 0.7，需要调整以适应屏幕


    // 响应式缩放
    const _BASE_SCALE = 0.25;
    const _BASE_HEIGHT = 900;
    window._live2dBaseScale = _BASE_SCALE;

    const positionModel = () => {
      // 右键拖拽时不重新定位
      if (window._isRightDragging && window._isRightDragging()) return;
      const h = window.innerHeight;
      const w = window.innerWidth;
      const baseScale = window._live2dBaseScale || _BASE_SCALE;
      const scale = baseScale * (h / _BASE_HEIGHT);
      model.scale.set(scale);
      // model.width/height 返回的是缩放后的尺寸
      model.x = (w - model.width) / 2;
      model.y = h - model.height - 10;
    };
    positionModel();
    window.addEventListener('resize', positionModel);    

    // ===== 滚轮缩放模型 =====
    const canvas = document.getElementById('live2d-canvas');
    if (canvas) {
      canvas.addEventListener('wheel', (e) => {
        const openModals = document.querySelectorAll('.modal:not(.hidden)');
        if (openModals.length > 0) return;
        if (window._isRightDragging && window._isRightDragging()) return;
        e.preventDefault();
        const scaleFactor = e.deltaY > 0 ? 0.95 : 1.05;
        const currentScale = window._live2dBaseScale || _BASE_SCALE;
        const newScale = Math.max(0.05, Math.min(2.0, currentScale * scaleFactor));
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const relX = (mouseX - model.x) / model.width;
        const relY = (mouseY - model.y) / model.height;
        window._live2dBaseScale = newScale;
        positionModel();
        model.x = mouseX - relX * model.width;
        model.y = mouseY - relY * model.height;
        const scaleSlider = document.getElementById('cfg-model-scale');
        const scaleValue = document.getElementById('scale-value');
        if (scaleSlider) scaleSlider.value = newScale;
        if (scaleValue) scaleValue.textContent = newScale.toFixed(2);
      }, { passive: false });
    }


    model.eventMode = 'static';


    model.on('pointertap', onModelClick);


    


    // 确保鼠标跟踪启用（模型配置中已定义，这里确保激活）


    if (model.internalModel.motionController) {


      console.log('✅ 鼠标跟踪已由模型配置启用');


    }


    


    // 启动自定义鼠标跟随（增强效果）


    startMouseTracking();


    


    // 启动眨眼动画


    startBlinking();


    


    // 启动呼吸动画


    startBreathing();


    


    console.log('✅ Live2D 模型加载成功');


    


  } catch (err) {


    console.error('❌ Live2D 加载失败:', err);


    addMessage('bot', '丛雨', '模型加载失败了…请检查路径: ' + CONFIG.modelPath);


  }


}





// ===== 鼠标跟随 =====


function startMouseTracking() {


  if (!model) return;


  


  console.log('[MouseTrack] Starting mouse tracking...');


  


  // 目标和当前值


  let targetX = 0, targetY = 0;


  let currentX = 0, currentY = 0;


  


  // 监听鼠标移动


  window.addEventListener('mousemove', (e) => {


    if (!model) return;


    


    // 计算鼠标相对于 canvas 中心的位置


    const canvas = document.getElementById('live2d-canvas');


    const rect = canvas.getBoundingClientRect();


    const centerX = rect.left + rect.width / 2;


    const centerY = rect.top + rect.height / 2;


    


    // 归一化到 -1 到 1 范围


    targetX = (e.clientX - centerX) / (rect.width / 2);


    targetY = (e.clientY - centerY) / (rect.height / 2);


    


    // 限制范围


    targetX = Math.max(-1, Math.min(1, targetX));


    targetY = Math.max(-1, Math.min(1, targetY));


  });


  


  // 平滑动画循环


  const smoothFactor = 0.1;


  const animate = () => {


    if (!model) return;


    


    // 平滑插值


    currentX += (targetX - currentX) * smoothFactor;


    currentY += (targetY - currentY) * smoothFactor;


    


    try {


      const coreModel = model.internalModel.coreModel;


      


      // 设置眼球方向


      coreModel.setParameterValueById('ParamEyeBallX', currentX);


      coreModel.setParameterValueById('ParamEyeBallY', -currentY);  // Y轴反转


      


      // 设置头部角度（范围约 ±30 度）


      coreModel.setParameterValueById('ParamAngleX', currentX * 30);


      coreModel.setParameterValueById('ParamAngleY', -currentY * 15);  // Y轴反转，幅度小一些


      


      // 设置身体角度（幅度更小）


      coreModel.setParameterValueById('ParamBodyAngleX', currentX * 10);


      


    } catch (err) {


      // 静默失败


    }


    


    requestAnimationFrame(animate);


  };


  


  animate();


  console.log('✅ 鼠标跟随已启用');


}





// ===== 眨眼动画 =====


function startBlinking() {


  if (!model) return;


  


  const blink = () => {


    if (!model || isSpeaking) return;


    


    // 闭眼


    model.internalModel.coreModel.setParameterValueById('ParamEyeLOpen', 0);


    model.internalModel.coreModel.setParameterValueById('ParamEyeROpen', 0);


    


    // 100-300ms 后睁眼


    setTimeout(() => {


      if (!model) return;


      model.internalModel.coreModel.setParameterValueById('ParamEyeLOpen', 1);


      model.internalModel.coreModel.setParameterValueById('ParamEyeROpen', 1);


    }, 100 + Math.random() * 200);


    


    // 下次眨眼


    setTimeout(blink, 2000 + Math.random() * 4000);


  };


  


  setTimeout(blink, 1000);


}





// ===== 呼吸动画 =====


function startBreathing() {


  if (!model) return;

  let time = 0;
  const baseY = model.y; // 记录基准位置

  const animate = () => {
    if (!model) return;
    time += 0.02;
    const breath = Math.sin(time) * 0.5;
    model.y = baseY + breath; // 使用绝对位置，不累加
    requestAnimationFrame(animate);
  };

  animate();


}





// ===== 表情控制 =====


function setExpression(exp) {


  if (!model) return;


  


  try {


    model.expression(exp);


    console.log('表情切换:', exp);


  } catch (err) {


    console.warn('表情切换失败:', err);


  }


}





// ===== 动作控制 =====


function playMotion(group, index = 0) {


  if (!model) return;


  


  try {


    model.motion(group, index);


    console.log('动作播放:', group, index);


  } catch (err) {


    console.warn('动作播放失败:', err);


  }


}





// ===== 模型点击交互 =====


function onModelClick(e) {
  // 冷却防抖 — 600ms
  const now = Date.now();
  if (onModelClick._lastClick && now - onModelClick._lastClick < 600) return;
  onModelClick._lastClick = now;

  // 暂停空闲表情循环
  if (typeof stopIdleExpressionCycle === 'function') stopIdleExpressionCycle();
  clearTimeout(onModelClick._resumeTimer);
  onModelClick._resumeTimer = setTimeout(() => { if (typeof startIdleExpressionCycle === 'function') startIdleExpressionCycle(); }, 10000);

  const { x, y } = e.data.global;
  const bounds = model.getBounds();
  const relY = (y - bounds.y) / bounds.height;

  // 区域映射
  const areas = [
    { max: 0.25, emotion: 'shy',      motionGroup: 'Tapface' },
    { max: 0.5,  emotion: 'happy',    motionGroup: 'Taphair' },
    { max: 0.7,  emotion: 'angry',    motionGroup: 'Tapxiongbu' },
    { max: 1.0,  emotion: 'surprise', motionGroup: 'Tapqunzi' }
  ];
  const area = areas.find(a => relY < a.max) || areas[areas.length - 1];

  // 设置表情
  if (typeof setExpressionBlended === 'function') {
    setExpressionBlended(area.emotion);
  }

  // 获取该动作组的定义（从模型里读取台词和音效）
  let motionDefs;
  try {
    motionDefs = model.internalModel.motionManager?.definitions?.[area.motionGroup];
  } catch {}

  // 随机选一个动作（避免连续重复）
  let motionIdx = 0;
  if (motionDefs && motionDefs.length > 1) {
    const last = onModelClick._lastMotion?.[area.motionGroup] ?? -1;
    do { motionIdx = Math.floor(Math.random() * motionDefs.length); } while (motionIdx === last && motionDefs.length > 1);
    if (!onModelClick._lastMotion) onModelClick._lastMotion = {};
    onModelClick._lastMotion[area.motionGroup] = motionIdx;
  }

  // 播放动作（模型会自动播放对应的 Sound 文件）
  try { model.motion(area.motionGroup, motionIdx); } catch {}

  // 读取模型定义的台词（而非自定义文本）
  const motionDef = motionDefs?.[motionIdx];
  const dialogueText = motionDef?.Text || motionDef?.text || '';

  // 显示台词（skipTTS=true，不走 TTS，直接用模型音效）
  if (dialogueText) {
    addMessage('bot', '丛雨', dialogueText, [], true);
    if (window.vnBridge) vnBridge.showVNMessage('bot', dialogueText);
  }

  // 口型动画跟随音效（估计 3 秒，实际会由模型音效驱动）
  startSpeakingAnim();
  setTimeout(() => stopSpeakingAnim(), 3500);
}
// ===== 说话动画 =====


function startSpeakingAnim() {


  if (!model) return;


  isSpeaking = true;


  


  let time = 0;


  const animate = () => {


    if (!isSpeaking || !model) return;


    


    time += 0.15;


    const open = (Math.sin(time) + 1) / 2 * 0.8 + 0.2;


    model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', open);


    


    requestAnimationFrame(animate);


  };


  animate();


}





function stopSpeakingAnim() {


  isSpeaking = false;


  if (model) {


    model.internalModel.coreModel.setParameterValueById('ParamMouthOpenY', 0);


  }


}





// ===== 对话系统 =====


function initChat() {
  initConversations();
}

function initConversations() {
  const saved = localStorage.getItem('murasame-conversations');
  const oldHistory = localStorage.getItem('chat-history');

  if (saved) {
    conversations = JSON.parse(saved);
  } else if (oldHistory) {
    // 迁移旧数据
    const msgs = JSON.parse(oldHistory).map(msg => ({ ...msg, attachments: Array.isArray(msg.attachments) ? msg.attachments : [] }));
    conversations = [{
      id: generateConvId(),
      name: '对话 1',
      messages: msgs,
      systemPrompt: null,
      knowledgeBase: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }];
  } else {
    conversations = [{
      id: generateConvId(),
      name: '对话 1',
      messages: [],
      systemPrompt: null,
      knowledgeBase: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }];
  }

  activeConversationId = localStorage.getItem('murasame-active-conversation');
  if (!activeConversationId || !conversations.find(c => c.id === activeConversationId)) {
    activeConversationId = conversations[0].id;
  }
  saveConversations();
  renderConversationList();
  switchToConversation(activeConversationId, true);
}





function addMessage(role, sender, text, attachments = [], skipTTS = false) {


  const msg = { role, sender, text, attachments, time: Date.now() };


  // 写入当前对话
  const conv = getActiveConversation();
  if (conv) {
    conv.messages.push(msg);
    if (conv.messages.length > 100) conv.messages.shift();
    conv.updatedAt = Date.now();
    saveConversations();
    // 第一条用户消息自动命名
    if (conv.messages.length === 2 && conv.name === '新对话') {
      const userMsg = conv.messages.find(m => m.role === 'user');
      if (userMsg && userMsg.text) {
        conv.name = userMsg.text.slice(0, 24) + (userMsg.text.length > 24 ? '...' : '');
        renderConversationList();
        saveConversations();
      }
    }
  }


  


  renderMessage(msg);


  


  // 如果是 AI 回复且不跳过 TTS，播放语音


  if (role === 'bot' && !skipTTS && CONFIG.ttsEnabled && text) {


    speak(text);


  }


  


  return msg;


}





function renderMessage(msg) {


  const container = $('#chat-messages');


  const div = document.createElement('div');


  div.className = `message ${msg.role}`;


  


  // Build attachment HTML if present


  let attachmentsHtml = '';


  if (msg.attachments && msg.attachments.length > 0) {


    attachmentsHtml = '<div class="attachments">';


    msg.attachments.forEach(att => {


      if (att.isImage) {


        attachmentsHtml += `


          <div class="attachment-card" onclick="window.open('${att.dataUrl}', '_blank')">


            <img src="${att.dataUrl}" alt="${escapeHtmlAttr(att.name)}" />


            <div class="card-info">


              <span class="card-icon">🖼️</span>


              <span class="card-name">${escapeHtml(att.name)}</span>


            </div>


          </div>`;


      } else {


        attachmentsHtml += `


          <div class="attachment-card" onclick="window.open('${att.dataUrl}', '_blank')">


            <div style="padding:16px 12px;display:flex;align-items:center;gap:8px;">


              <span class="card-icon" style="font-size:28px;">${getFileIcon(att.name)}</span>


              <div>


                <div style="font-size:13px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;">${escapeHtml(att.name)}</div>


                <div style="font-size:11px;color:var(--text-muted);">${formatFileSize(att.size)}</div>


              </div>


            </div>


          </div>`;


      }


    });


    attachmentsHtml += '</div>';


  }


  


  div.innerHTML = `


    <div class="sender">${msg.sender}</div>


    <div class="bubble">${escapeHtml(msg.text)}</div>


    ${attachmentsHtml}


  `;


  container.appendChild(div);


  container.scrollTop = container.scrollHeight;


}





function escapeHtml(text) {


  const div = document.createElement('div');


  div.textContent = text;


  return div.innerHTML;


}





// ===== 获取聊天后端 URL =====


function getChatEndpoint() {


  switch (CONFIG.chatType) {


    case 'ollama':


      return { url: '/api/ollama/v1/chat/completions', model: CONFIG.ollamaModel || 'qwen2.5:latest' };


    case 'local-api':


      return { url: CONFIG.localApiUrl + CONFIG.localApiEndpoint, model: CONFIG.localModel };


    case 'cloud-api':


      return { url: '/api/cloud/v1/chat/completions', model: CONFIG.cloudModel };


    case 'gateway':


      // Gateway WS 模式：返回特殊标识，由 sendToOpenClaw 处理


      return { url: 'gateway://ws', model: CONFIG.openclawModel || 'qclaw/modelroute', ws: true };


    case 'openclaw':


    default:


      return { url: '/api/gateway/v1/chat/completions', model: CONFIG.openclawModel || 'qclaw/modelroute' };


  }


}





// ===== File Upload / Attachment Helpers =====





function getFileIcon(filename) {


  const ext = (filename.split('.').pop() || '').toLowerCase();


  const icons = {


    pdf: '📄', doc: '📝', docx: '📝', txt: '📃', md: '📋',


    csv: '📊', xlsx: '📊', xls: '📊',


    json: '💻', xml: '💻', html: '💻', js: '💻', py: '💻',


    zip: '🗜️', rar: '🗜️', '7z': '🗜️',


    pptx: '📊', ppt: '📊',


    mp3: '🎵', wav: '🎵', ogg: '🎵', mp4: '🎬', avi: '🎬',


    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', bmp: '🖼️',


  };


  return icons[ext] || '📎';


}





function formatFileSize(bytes) {


  if (bytes < 1024) return bytes + ' B';


  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';


  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';


}





function escapeHtmlAttr(str) {


  return (str || '').replace(/'/g, '&apos;').replace(/"/g, '&quot;');


}





function isImageFile(filename) {


  const ext = (filename.split('.').pop() || '').toLowerCase();


  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext);


}





function buildMessageContent(text, attachments, asMultimodal = false) {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return text || '';
  }
  if (asMultimodal) {
    const parts = [{ type: 'text', text: text || '' }];
    attachments.forEach(a => {
      if (a.isImage && a.dataUrl) {
        parts.push({ type: 'image_url', image_url: { url: a.dataUrl } });
      } else {
        parts[0].text += '\n[附件: ' + a.name + ' (' + formatFileSize(a.size) + ')]';
      }
    });
    return parts;
  }
  const attList = attachments.map(a => '[附件: ' + a.name + ' (' + formatFileSize(a.size) + ')]').join(', ');
  return text ? text + '\n' + attList : '发送了附件: ' + attList;
}

// ===== 搜索命令处理 =====
async function handleSearchCommand(query) {
  const typingMsg = addMessage('bot', '丛雨', '', true);
  const typingEl = $('#chat-messages').lastElementChild;
  typingEl.classList.add('typing');
  try {
    const resp = await fetchWithRetry('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    }, 30000, 2);
    const data = await resp.json();
    if (data.success && data.results.length > 0) {
      let resultText = '🔍 搜索 "' + query + '" 的结果：\n\n';
      data.results.forEach((r, i) => {
        resultText += (i + 1) + '. ' + r.title + '\n';
        resultText += '   ' + r.snippet + '\n';
        resultText += '   ' + r.url + '\n\n';
      });
      typingEl.querySelector('.bubble').textContent = resultText;
      typingMsg.text = resultText;
    } else {
      const msg = '😢 没有找到 "' + query + '" 的相关结果';
      typingEl.querySelector('.bubble').textContent = msg;
      typingMsg.text = msg;
    }
  } catch (e) {
    const msg = '😢 搜索失败: ' + e.message;
    typingEl.querySelector('.bubble').textContent = msg;
    typingMsg.text = msg;
  }
  typingEl.classList.remove('typing');
}

// ===== 视觉命令处理 =====
async function handleVisionCommand(prompt, imageAtt) {
  const typingMsg = addMessage('bot', '丛雨', '', true);
  const typingEl = $('#chat-messages').lastElementChild;
  typingEl.classList.add('typing');
  try {
    const base64 = imageAtt.dataUrl.split(',')[1] || imageAtt.dataUrl;
    const resp = await fetchWithRetry('/api/ollama/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, prompt: prompt || undefined })
    }, 120000, 2);
    const data = await resp.json();
    const resultText = data.success ? data.result : '😢 图像分析失败';
    typingEl.querySelector('.bubble').textContent = resultText;
    typingMsg.text = resultText;
  } catch (e) {
    const msg = '😢 图像分析失败: ' + e.message;
    typingEl.querySelector('.bubble').textContent = msg;
    typingMsg.text = msg;
  }
  typingEl.classList.remove('typing');
}





async function handleFileSelect(files) {


  const MAX_SIZE = 10 * 1024 * 1024; // 10MB


  const MAX_TOTAL = 50 * 1024 * 1024; // 50MB total


  


  for (const file of Array.from(files)) {


    if (file.size > MAX_SIZE) {


      showStatus('文件过大（最大 10MB）: ' + file.name);


      continue;


    }


    if (pendingAttachments.reduce((s, a) => s + a.size, 0) + file.size > MAX_TOTAL) {


      showStatus('附件总大小超限（最大 50MB）');


      break;


    }


    


    const isImage = isImageFile(file.name);


    const reader = new FileReader();


    


    await new Promise((resolve) => {


      reader.onload = (e) => {


        pendingAttachments.push({


          name: file.name,


          type: file.type,


          dataUrl: e.target.result,


          size: file.size,


          isImage


        });


        resolve();


      };


      reader.readAsDataURL(file);


    });


  }


  


  renderAttachmentPreview();


  updateAttachButton();


}





function renderAttachmentPreview() {


  const bar = $('#attach-preview-bar');


  if (!bar) return;


  


  if (pendingAttachments.length === 0) {


    bar.style.display = 'none';


    return;


  }


  


  bar.style.display = 'flex';


  bar.innerHTML = pendingAttachments.map((att, i) => {


    if (att.isImage) {


      return `<div class="attach-preview-item">


        <img src="${att.dataUrl}" alt="${escapeHtmlAttr(att.name)}" />


        <span class="attach-name" title="${escapeHtmlAttr(att.name)}">${escapeHtml(att.name)}</span>


        <button class="attach-remove" onclick="removeAttachment(${i})" title="移除">✕</button>


      </div>`;


    } else {


      return `<div class="attach-preview-item">


        <span class="attach-icon">${getFileIcon(att.name)}</span>


        <span class="attach-name" title="${escapeHtmlAttr(att.name)}">${escapeHtml(att.name)}</span>


        <button class="attach-remove" onclick="removeAttachment(${i})" title="移除">✕</button>


      </div>`;


    }


  }).join('');


}





function removeAttachment(index) {


  pendingAttachments.splice(index, 1);


  renderAttachmentPreview();


  updateAttachButton();


}





function clearAttachments() {


  pendingAttachments = [];


  renderAttachmentPreview();


  updateAttachButton();


}





function updateAttachButton() {


  const btn = $('#btn-attach');


  if (!btn) return;


  if (pendingAttachments.length > 0) {


    btn.classList.add('has-attachments');


    btn.textContent = pendingAttachments.length;


  } else {


    btn.classList.remove('has-attachments');


    btn.textContent = '+';


  }


}





// ===== 发送消息到 AI =====


async function getMemoryContext() {
  try {
    const resp = await fetch('/api/chat/memory-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' })
    });
    const data = await resp.json();
    return data.context || '';
  } catch { return ''; }
}

async function sendToOpenClaw(text, attachments = []) {


  if (isTyping) return;


  


  isTyping = true;


  $('#btn-send').disabled = true;


  $('#chat-input').disabled = true;


  


  // 显示输入中（跳过 TTS，因为文本还是空的）


  const typingMsg = addMessage('bot', '丛雨', '', true);


  const typingEl = $('#chat-messages').lastElementChild;


  typingEl.classList.add('typing');


  


  // 预生成 TTS 的标志


  let ttsStarted = false;


  let fullText = '';


  


  // 使用配置中的系统提示词


  const rolePrompt = CONFIG.systemPrompt;


  


  try {


    // 获取聊天后端


    const endpoint = getChatEndpoint();


    console.log('[Chat] Using backend:', CONFIG.chatType, '→', endpoint.url);


    


    // 构建历史消息（含附件文本描述）
    const conv = getActiveConversation();
    const convMessages = conv ? conv.messages : chatHistory;
    const historyMessages = convMessages.slice(-10).map(m => ({


      role: m.role === 'user' ? 'user' : 'assistant',


      content: buildMessageContent(m.text, m.attachments)


    }));


    // 知识库搜索（如果对话关联了文档）
    let knowledgeContext = '';
    if (conv && conv.knowledgeBase && conv.knowledgeBase.length > 0) {
      try {
        const kbResp = await fetch('/api/knowledge/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: text, documentIds: conv.knowledgeBase, maxResults: 3 })
        });
        const kbData = await kbResp.json();
        if (kbData.success && kbData.results.length > 0) {
          knowledgeContext = '相关知识:\n' + kbData.results.map(r =>
            '[' + r.name + ']: ' + r.snippet
          ).join('\n\n');
        }
      } catch (e) {
        console.warn('[KB] Search failed:', e.message);
      }
    }


    


    // Step 1: Upload attachments first


    const uploadedFiles = [];


    if (attachments && attachments.length > 0) {


      for (const att of attachments) {


        try {


          // Convert dataUrl to blob for upload


          const resp = await fetchWithTimeout(att.dataUrl, 10000);


          const blob = await resp.blob();


          const upResp = await fetchWithRetry('/api/upload-file', {


            method: 'POST',


            headers: { 'Content-Type': att.type || 'application/octet-stream' },


            body: blob


          }, 10000, 2);


          const data = await upResp.json();


          if (data.success) {


            uploadedFiles.push({ name: att.name, url: data.url, size: att.size, type: att.type,


              dataUrl: att.dataUrl, isImage: att.isImage });


            console.log('[Upload] OK:', att.name, '->', data.url);


          } else {


            console.error('[Upload] Failed:', data.error);
            showNotification('附件上传失败: ' + data.error, 'error');


          }


        } catch (e) {


          console.error('[Upload] Error:', e.message);
          showNotification('附件上传失败，已跳过', 'error');


        }


      }


    }


    const currentAttachments = uploadedFiles.length > 0 ? uploadedFiles : attachments;


    


        // 构建请求体（含附件描述）
    const hasImages = currentAttachments.some(a => a.isImage);
    const useMultimodal = hasImages && CONFIG.chatType === 'ollama';

    // 所有对话都走 Agent 模式（让 AI 自己判断是否需要调用工具）
    const useAgent = CONFIG.enableAgent !== false;
    if (useAgent) {
      console.log('[Chat] Using Agent mode');
      try {
        const agentResp = await fetchWithRetry('/api/agent/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: historyMessages.slice(-5) })
        }, 120000, 2);
        const agentData = await agentResp.json();
        if (agentData.success) {
          fullText = agentData.response;
          typingMsg.text = fullText;
          typingEl.querySelector('.bubble').textContent = fullText;
          if (window.vnBridge) vnBridge.updateDialogText(fullText, 'bot');
          $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
          if (agentData.usedTools) showNotification('🔧 使用了工具: ' + agentData.toolCalls.map(t => t.name).join(', '), 'info');
        } else {
          throw new Error(agentData.error || 'Agent 失败');
        }
      } catch (agentErr) {
        console.warn('[Agent] Failed, falling back:', agentErr.message);
      }
    }

    if (!fullText) {
    const requestBody = {
      model: useMultimodal ? (CONFIG.visionModel || 'llama3.2-vision:latest') : (endpoint.model || CONFIG.cloudModel || 'gpt-4o-mini'),
      messages: [
        ...historyMessages,
        { role: 'user', content: useMultimodal
          ? buildMessageContent(text, currentAttachments, true)
          : buildMessageContent(text, currentAttachments) }
      ],
      system_prompt_override: (conv && conv.systemPrompt) ? conv.systemPrompt : CONFIG.systemPrompt + (await getMemoryContext()),
      stream: true,
      temperature: CONFIG.chatType === 'cloud-api' ? (CONFIG.cloudTemperature || 0.7) : (CONFIG.openclawTemperature || 0.7),
      max_tokens: CONFIG.chatType === 'cloud-api' ? (CONFIG.cloudContext || 16384) : (CONFIG.openclawMaxTokens || 2000)
    };

    // ===== HTTP 模式（Gateway WS 已移除） =====

    // 调用对应后端


    const response = await fetchWithRetry(endpoint.url, {


      method: 'POST',


      headers: {
        'Content-Type': 'application/json',
        ...(CONFIG.chatType === 'local-api' && CONFIG.localApiKey ? { 'Authorization': 'Bearer ' + CONFIG.localApiKey } : {})
      },


      body: JSON.stringify(requestBody) }, 120000, 2)


    


    if (!response.ok) {


      const errorText = await response.text();


      console.error('[Chat] HTTP Error:', response.status, errorText);


      throw new Error(`HTTP ${response.status}: ${errorText}`);


    }


    


    console.log('[Chat] Response received, processing stream...');


    


    // 处理流式响应


    const reader = response.body.getReader();


    const decoder = new TextDecoder();
    const rawChunks = [];

    while (true) {


      const { done, value } = await reader.read();


      if (done) break;
      if (value) rawChunks.push(value);

      const chunk = decoder.decode(value, { stream: true });


      const lines = chunk.split('\n');


      


      for (const line of lines) {


        if (line.startsWith('data: ')) {


          const data = line.slice(6);


          if (data === '[DONE]') continue;


          


          try {


            const json = JSON.parse(data);


            const delta = json.choices?.[0]?.delta?.content;


            if (delta) {


              fullText += delta;


              const displayText = stripThinkTags(fullText);
              typingEl.querySelector('.bubble').textContent = displayText;
              if (window.vnBridge) vnBridge.updateDialogText(displayText, 'bot');

              $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;


              


              // 等到一句话相对完整后再预生成，避免只生成流式回复的前几个字。
              const canPreviewTTS = fullText.length >= 24 && /[。！？.!?）)]\s*$/.test(fullText);
              if (!ttsStarted && canPreviewTTS && CONFIG.ttsEnabled) {


                ttsStarted = true;


                startPreGenerateTTS(fullText);


              }


            }


          } catch (e) {}


        }


      }


    }

    // 非流式 JSON 回退
    if (!fullText && rawChunks.length > 0) {
      try {
        const rawLen = rawChunks.reduce((a, c) => a + c.length, 0);
        const rawBuf = new Uint8Array(rawLen);
        let off = 0;
        for (const c of rawChunks) { rawBuf.set(c, off); off += c.length; }
        const json = JSON.parse(decoder.decode(rawBuf));
        const content = json.choices?.[0]?.message?.content;
        if (content) {
          fullText = content;
          typingEl.querySelector('.bubble').textContent = fullText;
          if (window.vnBridge) vnBridge.updateDialogText(fullText, 'bot');
          $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
        }
      } catch (e) {
        console.warn('[Chat] Non-streaming JSON fallback failed:', e.message);
      }
    }

    // 更新最终消息


    typingMsg.text = fullText;


    typingEl.classList.remove('typing');


    


    // 保存到历史
    const historyArr = conv ? conv.messages : chatHistory;
    const idx = historyArr.findIndex(m => m === typingMsg);
    if (idx >= 0) historyArr[idx].text = fullText;

    if (conv) { saveConversations(); } else { localStorage.setItem('chat-history', JSON.stringify(chatHistory)); }


    



    // 流式完成后 — 自动设置表情（用清理后的文本）
    if (fullText) {
      try {
        const cleanForEmotion = stripThinkTags(fullText);
        if (cleanForEmotion) setExpressionFromText(cleanForEmotion);
      } catch {}
    }
    
    // 流式完成后播放语音
    if (fullText && CONFIG.ttsEnabled) {
      speak(fullText);
    }

    // 自动从对话中提取记忆
    if (fullText && text) {
      try {
        await fetch('/api/chat/extract-memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userMessage: text })
        });
      } catch {}
    }

    } // end if (!fullText) - Agent fallback


    


  } catch (err) {


    console.error('AI 调用失败:', err);


    typingEl.classList.remove('typing');


    


    // 提供更友好的错误消息


    let errorMsg = err.message;


    if (err.name === 'TypeError' && err.message.includes('fetch')) {


      errorMsg = '无法连接到服务器，请检查OpenClaw服务是否运行';


    } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {


      errorMsg = '网络连接失败，请确保桌面版已启动';


    }


    


    typingEl.querySelector('.bubble').innerHTML = `


      <div style="color: #ff6b6b;">😢 连接失败了</div>


      <div style="font-size: 12px; color: #999; margin-top: 5px;">${errorMsg}</div>


      <div style="font-size: 11px; color: #666; margin-top: 5px;">请确保OpenClaw Gateway服务正在运行</div>


    `;


  } finally {


    isTyping = false;


    $('#btn-send').disabled = false;


    $('#chat-input').disabled = false;


    $('#chat-input').focus();


  }


}






// ==================== 对话管理 ====================

function switchToConversation(convId, isInitialLoad = false) {
  const prev = getActiveConversation();
  if (prev) {
    prev.updatedAt = Date.now();
    saveConversations();
  }
  activeConversationId = convId;
  localStorage.setItem('murasame-active-conversation', convId);
  const conv = getActiveConversation();
  if (conv) {
    $('#chat-messages').innerHTML = '';
    conv.messages.forEach(msg => renderMessage(msg));
    if (window.vnBridge && conv.messages.length > 0) {
      const lastMsg = conv.messages[conv.messages.length - 1];
      if (lastMsg.text) window.vnBridge.updateDialogText(lastMsg.text, lastMsg.role === 'user' ? 'user' : 'bot');
    }
    $('#conv-system-prompt').value = conv.systemPrompt || '';
    renderConversationList();
  }
}

function createNewConversation() {
  const conv = {
    id: generateConvId(),
    name: '新对话',
    messages: [],
    systemPrompt: null,
    knowledgeBase: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  conversations.push(conv);
  saveConversations();
  renderConversationList();
  switchToConversation(conv.id);
  addMessage('bot', CONFIG.charName, '新对话已创建～有什么想聊的吗？');
}

function deleteConversation(convId) {
  if (conversations.length <= 1) {
    showNotification('至少保留一个对话', 'error');
    return;
  }
  if (!confirm('确定删除此对话？')) return;
  conversations = conversations.filter(c => c.id !== convId);
  saveConversations();
  if (activeConversationId === convId) {
    switchToConversation(conversations[0].id);
  }
  renderConversationList();
}

function promptRename(convId) {
  const conv = conversations.find(c => c.id === convId);
  if (!conv) return;
  const newName = prompt('重命名对话:', conv.name);
  if (newName && newName.trim()) {
    conv.name = newName.trim();
    saveConversations();
    renderConversationList();
  }
}

function renderConversationList() {
  const list = document.getElementById('conversation-list');
  if (!list) return;
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
  list.innerHTML = conversations.map(conv => {
    const lastMsg = conv.messages.length > 0 ? conv.messages[conv.messages.length - 1] : null;
    const preview = lastMsg ? lastMsg.text.slice(0, 40) + (lastMsg.text.length > 40 ? '...' : '') : '空对话';
    const hasCustomPrompt = !!conv.systemPrompt;
    const hasKnowledge = conv.knowledgeBase && conv.knowledgeBase.length > 0;
    const indicators = (hasCustomPrompt ? '\\u270f\\ufe0f' : '') + (hasKnowledge ? '\\ud83d\\udcce' : '');
    return `<div class="conversation-list-item ${conv.id === activeConversationId ? 'active' : ''}" data-conv-id="${conv.id}">`
      + `<div class="conv-item-name" onclick="switchToConversation('${conv.id}')">${esc(conv.name || '对话')} `
      + (indicators ? `<span class="conv-indicators">${indicators}</span>` : '')
      + `</div>`
      + `<div class="conv-item-preview" onclick="switchToConversation('${conv.id}')">${esc(preview)}</div>`
      + `<div class="conv-item-actions">`
      + `<button onclick="promptRename('${conv.id}')" title="重命名">\\ud83d\\udcdd</button>`
      + `<button onclick="deleteConversation('${conv.id}')" title="删除">\\ud83d\\uddd1\\ufe0f</button>`
      + `</div></div>`;
  }).join('');
}

function toggleSidebar() {
  const sidebar = document.getElementById('conversation-sidebar');
  if (sidebar) sidebar.classList.toggle('hidden');
}

// ==================== 知识库管理 ====================

async function initKnowledgeBase() {
  try {
    const resp = await fetch('/api/knowledge/list');
    const data = await resp.json();
    if (data.success) {
      knowledgeDocuments = data.documents;
      renderKnowledgeDocuments();
    }
  } catch (e) {
    console.warn('[KB] Init failed:', e.message);
  }
}

async function uploadKnowledgeDocument() {
  const name = document.getElementById('kb-name-input');
  const content = document.getElementById('kb-content-input');
  if (!name || !content) return;
  const nameVal = name.value.trim();
  const contentVal = content.value.trim();
  if (!nameVal || !contentVal) {
    showNotification('请输入文档名称和内容', 'error');
    return;
  }
  try {
    const resp = await fetch('/api/knowledge/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nameVal, content: contentVal })
    });
    const data = await resp.json();
    if (data.success) {
      showNotification('文档已上传', 'success');
      name.value = '';
      content.value = '';
      await initKnowledgeBase();
    } else {
      showNotification('上传失败: ' + (data.error || 'unknown'), 'error');
    }
  } catch (e) {
    showNotification('上传失败: ' + e.message, 'error');
  }
}

async function deleteKnowledgeDocument(docId) {
  if (!confirm('确定删除此文档？')) return;
  try {
    const resp = await fetch('/api/knowledge/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: docId })
    });
    const data = await resp.json();
    if (data.success) {
      showNotification('文档已删除', 'success');
      await initKnowledgeBase();
    }
  } catch (e) {
    showNotification('删除失败', 'error');
  }
}

function toggleKnowledgeDocumentForConversation(docId) {
  const conv = getActiveConversation();
  if (!conv) return;
  if (!conv.knowledgeBase) conv.knowledgeBase = [];
  const idx = conv.knowledgeBase.indexOf(docId);
  if (idx >= 0) {
    conv.knowledgeBase.splice(idx, 1);
  } else {
    conv.knowledgeBase.push(docId);
  }
  saveConversations();
  renderKnowledgeDocuments();
  renderConversationList();
  showNotification(idx >= 0 ? '已取消关联文档' : '已关联文档', 'success');
}

function renderKnowledgeDocuments() {
  const conv = getActiveConversation();
  const convDocIds = conv ? (conv.knowledgeBase || []) : [];
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
  function fmtSize(s) { return s > 1024 ? (s/1024).toFixed(1)+'KB' : s+'B'; }

  // Render main doc list
  const listEl = document.getElementById('kb-doc-list');
  if (listEl) {
    if (knowledgeDocuments.length === 0) {
      listEl.innerHTML = '<div class="kb-empty">暂无文档，上传一些文本资料吧～</div>';
    } else {
      listEl.innerHTML = knowledgeDocuments.map(doc => `
        <div class="kb-doc-item">
          <label class="kb-doc-checkbox">
            <input type="checkbox" ${convDocIds.includes(doc.id) ? 'checked' : ''}
                   onchange="toggleKnowledgeDocumentForConversation('${doc.id}')" />
            <span class="kb-doc-name">${esc(doc.name)}</span>
          </label>
          <span class="kb-doc-meta">${fmtSize(doc.size)}</span>
          <button class="kb-doc-delete" onclick="deleteKnowledgeDocument('${doc.id}')" title="删除">\\ud83d\\uddd1\\ufe0f</button>
        </div>
      `).join('');
    }
  }

  // Render per-conversation docs
  const convDocsEl = document.getElementById('kb-conv-docs');
  if (convDocsEl) {
    const linked = knowledgeDocuments.filter(d => convDocIds.includes(d.id));
    if (linked.length === 0) {
      convDocsEl.innerHTML = '<div class="kb-empty">未关联文档，在上方勾选以关联</div>';
    } else {
      convDocsEl.innerHTML = linked.map(doc => `
        <div class="kb-doc-item">
          <span class="kb-doc-name">${esc(doc.name)}</span>
          <span class="kb-doc-meta">${fmtSize(doc.size)}</span>
        </div>
      `).join('');
    }
  }
}

// ==================== 每对话系统提示词 ====================

function applyConversationSystemPrompt() {
  const conv = getActiveConversation();
  if (!conv) return;
  const val = document.getElementById('conv-system-prompt');
  if (!val) return;
  conv.systemPrompt = val.value.trim() || null;
  saveConversations();
  renderConversationList();
  showNotification('对话提示词已更新', 'success');
}

function resetConversationSystemPrompt() {
  const conv = getActiveConversation();
  if (!conv) return;
  conv.systemPrompt = null;
  const el = document.getElementById('conv-system-prompt');
  if (el) el.value = '';
  saveConversations();
  renderConversationList();
  showNotification('已重置为全局提示词', 'success');
}



// 预生成 TTS（流式输出过程中）


let pendingTTS = null;


let pendingTTSText = '';


let ttsDebounceTimer = null;


let isGeneratingTTS = false;


let isPlayingTTS = false;  // 新增：正在播放标志

let ttsPreviewSerial = 0;





// 从"中文（日语）"格式中提取日语部分用于 TTS


function extractJapanese(text) {


  // 匹配括号内的日语内容：中文（日本語）→ 日本語


  // 支持全角括号（）和半角括号()


  const japaneseMatches = text.match(/[（(]([^）)]+)[）)]/g);


  if (japaneseMatches && japaneseMatches.length > 0) {


    // 提取所有括号内的日语，去掉括号


    const japanese = japaneseMatches.map(m => m.replace(/[（(）)]/g, '')).join('');


    console.log('[TTS] Extracted Japanese:', japanese);


    return japanese;


  }


  // 如果没有括号，返回原文（可能是纯日语）


  return text;


}





// 开始预生成（带防抖）


function startPreGenerateTTS(text) {


  pendingTTSText = text;
  const previewSerial = ++ttsPreviewSerial;


  


  // 如果正在生成或正在播放，跳过


  if (isGeneratingTTS || isPlayingTTS) return;


  


  // 清除之前的定时器


  if (ttsDebounceTimer) {


    clearTimeout(ttsDebounceTimer);


  }


  


  // 200ms 后开始生成（增加防抖时间）


  ttsDebounceTimer = setTimeout(() => {


    doPreGenerateTTS(pendingTTSText, previewSerial);


  }, 200);


}





// 实际执行预生成


async function doPreGenerateTTS(text, previewSerial) {


  if (isGeneratingTTS) return;


  isGeneratingTTS = true;


  


  try {


    showStatus('正在生成语音…');


    


    // 提取日语部分用于 TTS


    const japaneseText = extractJapanese(text);


    


    const response = await fetchWithRetry(`${CONFIG.tts}/tts`, {


      method: 'POST',


      headers: { 'Content-Type': 'application/json' },


      body: JSON.stringify({


        text: japaneseText,
        ref_audio_path: CONFIG.refAudio,


        prompt_text: CONFIG.refText,


        prompt_lang: CONFIG.refLang


      }) }, 120000, 1)


    


    if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);


    


    const blob = await response.blob();
    if (blob.size < 1000) throw new Error('TTS audio too small (' + blob.size + ' bytes)');


    if (previewSerial !== ttsPreviewSerial || text !== pendingTTSText) {
      console.log('[TTS] Dropped stale pre-generated audio');
      return;
    }

    pendingTTS = { blob, text: text };


    console.log('[TTS] Pre-generated audio ready, text length:', text.length);


    


  } catch (err) {


    console.error('预生成 TTS 失败:', err);
    showNotification('TTS 预生成失败，跳过语音', 'warning');


    pendingTTS = null;
    hideStatus();
    stopSpeakingAnim();

  } finally {


    isGeneratingTTS = false;


  }


}





// 播放预生成的或新生成的语音


async function speak(text) {


  if (!CONFIG.ttsEnabled || !text) return;


  


  // 如果正在播放，先停止


  if (isPlayingTTS) {


    console.log('[TTS] Already playing, stopping previous...');


    if (currentAudio) {


      currentAudio.pause();


      currentAudio = null;


    }


    isPlayingTTS = false;


  }


  


  // 停止之前的音频


  if (currentAudio) {


    currentAudio.pause();


    currentAudio = null;


  }


  


  isPlayingTTS = true;


  showStatus('丛雨正在说话…');


  startSpeakingAnim();


  


  try {


    let blob;
    ttsPreviewSerial++;
    pendingTTSText = text;


    


    // 检查是否有预生成的 TTS 且文本匹配


    if (pendingTTS && pendingTTS.text === text) {


      // 使用预生成的音频


      blob = pendingTTS.blob;


      pendingTTS = null;


      console.log('[TTS] Using pre-generated audio');


    } else {
      pendingTTS = null;


      // 需要重新生成


      // 提取日语部分用于 TTS


      const japaneseText = extractJapanese(text);


      console.log('[TTS] Generating new audio for:', japaneseText.substring(0, 30));


      


      const ttsBody = {


        text: japaneseText,
      };


      // Pass custom reference audio params if configured


      if (CONFIG.refAudio) ttsBody.ref_audio_path = CONFIG.refAudio;


      if (CONFIG.refText) ttsBody.prompt_text = CONFIG.refText;


      if (CONFIG.refLang) ttsBody.prompt_lang = CONFIG.refLang;


      


      const response = await fetchWithRetry(`${CONFIG.tts}/tts`, {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify(ttsBody) }, 120000, 1)


      


      if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);


      blob = await response.blob();


      if (blob.size < 500) throw new Error('TTS audio too small (' + blob.size + ' bytes)');


    }


    


    // 播放音频


    const url = URL.createObjectURL(blob);


    currentAudio = new Audio(url);


    


    currentAudio.onended = () => {


      hideStatus();


      stopSpeakingAnim();


      URL.revokeObjectURL(url);


      isPlayingTTS = false;


      console.log('[TTS] Playback finished');


    };


    


    currentAudio.onerror = () => {


      hideStatus();


      stopSpeakingAnim();


      isPlayingTTS = false;


      console.error('[TTS] Playback error');


    };


    


    await currentAudio.play();


    console.log('[TTS] Playback started');


    


  } catch (err) {


    console.error('TTS 失败:', err);
    showNotification('语音生成失败，已跳过语音', 'warning');


    hideStatus();


    stopSpeakingAnim();


    isPlayingTTS = false;


  }


}





// ===== 事件绑定 =====


function initEvents() {


  // 发送按钮


  $('#btn-send').addEventListener('click', async () => {

    const text = $('#chat-input').value.trim();

    if (!text) return;

    // 搜索命令: /搜索 <query>
    const searchMatch = text.match(/^\/搜索\s+(.+)/);
    if (searchMatch) {
      addMessage('user', '主人', text, []);
      if (window.vnBridge) vnBridge.showVNMessage('user', text);
      $('#chat-input').value = '';
      handleSearchCommand(searchMatch[1]);
      return;
    }

    // 视觉命令: /识别 [prompt]
    const visionMatch = text.match(/^\/识别(?:\s+(.+))?$/);
    if (visionMatch) {
      const atts = [...pendingAttachments];
      const imageAtt = atts.reverse().find(a => a.isImage);
      if (imageAtt) {
        addMessage('user', '主人', text, [imageAtt]);
        if (window.vnBridge) vnBridge.showVNMessage('user', text);
        clearAttachments();
        $('#chat-input').value = '';
        handleVisionCommand(visionMatch[1] || '', imageAtt);
      } else {
        showNotification('请先上传一张图片', 'error');
      }
      return;
    }

    // 技能系统检查
    const skillMatch = checkSkillTrigger?.(text);
    if (skillMatch) {
      addMessage('user', '主人', text, []);
      if (window.vnBridge) vnBridge.showVNMessage('user', text);
      $('#chat-input').value = '';
      const skill = SKILL_DEFINITIONS?.[skillMatch.skill];
      if (skill?.handler) {
        try {
          const result = await skill.handler(skillMatch.args);
          if (result) {
            addMessage('assistant', '丛雨', result, []);
            if (window.vnBridge) vnBridge.showVNMessage('bot', result);
          }
        } catch (e) {
          const errMsg = '😢 技能执行出错: ' + e.message;
          addMessage('assistant', '丛雨', errMsg, []);
          if (window.vnBridge) vnBridge.showVNMessage('bot', errMsg);
          console.error('[Skill]', skillMatch.skill, e);
        }
      }
      return;
    }

    // Send message with current attachments

    const atts = [...pendingAttachments];

    if (atts.length > 0 || text.trim()) {

      addMessage('user', '主人', text, atts);
      if (window.vnBridge) vnBridge.showVNMessage('user', text);

      clearAttachments();

    }

    $('#chat-input').value = '';

    sendToOpenClaw(text, atts);

  });


  


  // 回车发送


  $('#chat-input').addEventListener('keydown', (e) => {


    if (e.key === 'Enter' && !e.shiftKey) {


      e.preventDefault();


      $('#btn-send').click();


    }


  });


  


  // 表情按钮


  $$('.exp-btn').forEach(btn => {


    btn.addEventListener('click', () => {


      const exp = btn.dataset.exp;


      setExpression(exp);


      


      // 根据表情说不同的话


      const reactions = {


        'exp1.exp3': '今日もいい天気ですね！',


        'exp2.exp3': '悲しいことがありました…',


        'exp3.exp3': 'もう、怒りますよ！',


        'exp4.exp3': 'えっ！驚きました…',


        'exp5.exp3': 'ふふっ、何か企んでいますか？',


        'exp6.exp3': '眠い…もう少し寝かせてください…',


        'exp7.exp3': 'ご主人様、大好きです！'


      };


      


      const reaction = reactions[exp];


      if (reaction) {


        addMessage('bot', '丛雨', reaction);


      }


    });


  });


  


  // 语音开关


  $('#btn-tts').addEventListener('click', () => {


    CONFIG.ttsEnabled = !CONFIG.ttsEnabled;


    saveConfig();


    $('#btn-tts').classList.toggle('active', CONFIG.ttsEnabled);


  });


  


  // TTS 模式切换（循环切换：local → system → cloud → local）


  $('#btn-tts-mode').addEventListener('click', async () => {


    try {


      // 获取当前 TTS 模式


      const response = await fetchWithTimeout('/api/tts-mode', 10000);


      if (response.ok) {


        const data = await response.json();


        const currentMode = data.mode;


        


        // 确定下一个模式


        let newMode;


        let btnText, btnTitle, toastMsg;


        


        switch(currentMode) {


          case 'local':


            newMode = 'system';


            btnText = '🔊';


            btnTitle = '系统语音模式';


            toastMsg = '切换到系统语音模式';


            break;


          case 'system':


            newMode = 'cloud';


            btnText = '☁️';


            btnTitle = '云端备选模式';


            toastMsg = '切换到云端备选模式';


            break;


          case 'cloud':


          default:


            newMode = 'local';


            btnText = '💻';


            btnTitle = '本地 GPT-SoVITS 模式';


            toastMsg = '切换到本地 GPT-SoVITS 模式';


            break;


        }


        


        // 切换模式


        const switchResponse = await fetchWithTimeout('/api/tts-mode', {


          method: 'POST',


          headers: { 'Content-Type': 'application/json' },


          body: JSON.stringify({ mode: newMode }) }, 30000)


        


        if (switchResponse.ok) {


          const btn = $('#btn-tts-mode');


          btn.textContent = btnText;


          btn.title = btnTitle;


          showToast(toastMsg, 'info');


        }


      }


    } catch (err) {


      console.log('TTS mode switch failed:', err);


      showToast('TTS 模式切换失败', 'error');


    }


  });


  


  // ===== 快捷短语 =====


  $$('.quick-phrase').forEach(btn => {


    btn.addEventListener('click', () => {


      const text = btn.dataset.text;


      $('#chat-input').value = text;


      $('#btn-send').click();


      updateAffection(2);


    });


  });


  


  // ===== 动作按钮 =====


  $$('.action-btn').forEach(btn => {


    btn.addEventListener('click', () => {


      const action = btn.dataset.action;


      performAction(action);


    });


  });


  


  // ===== 菜单模态框 =====


  $('#btn-menu').addEventListener('click', () => {


    $('#menu-modal').classList.remove('hidden');


  });


  


  $('#btn-close-menu').addEventListener('click', () => {


    $('#menu-modal').classList.add('hidden');


  });


  


  // 时间问候


  $('#menu-greeting').addEventListener('click', () => {


    $('#menu-modal').classList.add('hidden');


    showTimeGreeting();


  });


  


  $('#btn-send-greeting').addEventListener('click', () => {


    const { text, subtext } = getTimeGreeting();


    $('#chat-input').value = text;


    $('#btn-send').click();


    $('#greeting-modal').classList.add('hidden');


  });


  


  $('#btn-close-greeting').addEventListener('click', () => {


    $('#greeting-modal').classList.add('hidden');


  });


  


  // 猜拳游戏


  $('#menu-game').addEventListener('click', () => {


    $('#menu-modal').classList.add('hidden');


    $('#game-modal').classList.remove('hidden');


  });


  


  $$('.game-choice').forEach(btn => {


    btn.addEventListener('click', () => {


      const choice = btn.dataset.choice;


      playRPS(choice);


    });


  });


  


  $('#btn-close-game').addEventListener('click', () => {


    $('#game-modal').classList.add('hidden');


  });


  


  // 语音录制


  $('#menu-recorder').addEventListener('click', () => {


    $('#menu-modal').classList.add('hidden');


    $('#recorder-modal').classList.remove('hidden');


  });


  


  let isRecording = false;


  $('#btn-record').addEventListener('click', () => {


    if (isRecording) {


      stopRecording();


      isRecording = false;


    } else {


      startRecording();


      isRecording = true;


    }


  });


  


  $('#btn-play-record').addEventListener('click', playRecording);


  


  $('#btn-close-recorder').addEventListener('click', () => {


    if (isRecording) {


      stopRecording();


      isRecording = false;


    }


    $('#recorder-modal').classList.add('hidden');


  });


  


  // 对话历史


  $('#menu-history').addEventListener('click', () => {


    $('#menu-modal').classList.add('hidden');


    loadHistory();


    $('#history-modal').classList.remove('hidden');


  });


  


  
  // 对话侧边栏
  const convSidebarToggle = document.getElementById('vn-btn-conversations');
  if (convSidebarToggle) convSidebarToggle.addEventListener('click', toggleSidebar);
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  if (btnToggleSidebar) btnToggleSidebar.addEventListener('click', toggleSidebar);
  const btnNewConv = document.getElementById('btn-new-conversation');
  if (btnNewConv) btnNewConv.addEventListener('click', createNewConversation);

  // 知识库
  const btnKbUpload = document.getElementById('btn-kb-upload');
  if (btnKbUpload) btnKbUpload.addEventListener('click', uploadKnowledgeDocument);
  const btnCloseKnowledge = document.getElementById('btn-close-knowledge');
  if (btnCloseKnowledge) btnCloseKnowledge.addEventListener('click', () => {
    document.getElementById('knowledge-modal').classList.add('hidden');
  });

  // 每对话提示词
  const btnApplyConvPrompt = document.getElementById('btn-apply-conv-prompt');
  if (btnApplyConvPrompt) btnApplyConvPrompt.addEventListener('click', applyConversationSystemPrompt);
  const btnResetConvPrompt = document.getElementById('btn-reset-conv-prompt');
  if (btnResetConvPrompt) btnResetConvPrompt.addEventListener('click', resetConversationSystemPrompt);

$('#btn-clear-history').addEventListener('click', () => {


    if (confirm('确定要清空当前对话的所有消息吗？')) {
      const conv = getActiveConversation();
      if (conv) { conv.messages = []; conv.updatedAt = Date.now(); saveConversations(); }
      $('#chat-messages').innerHTML = '';


      addMessage('bot', CONFIG.charName, '对话历史已清空～（会話履歴をクリアしました～）');


    }


  });


  


  $('#btn-close-history').addEventListener('click', () => {


    $('#history-modal').classList.add('hidden');


  });


  


  // 收藏消息


  $('#menu-favorite').addEventListener('click', () => {


    $('#menu-modal').classList.add('hidden');


    addMessage('bot', CONFIG.charName, '消息收藏功能开发中～请稍等哦（メッセージお気に入り機能は開発中です～）💫');


  });


  


  // 关于丛雨


  $('#menu-about').addEventListener('click', () => {


    $('#menu-modal').classList.add('hidden');


    addMessage('bot', CONFIG.charName, `我是丛雨（村雨），一个温柔的日式女仆～


    


💕 我喜欢：主人、甜点、可爱的东西


🌧️ 我的特技：陪伴、聊天、治愈心灵





有什么想对我说的吗？（私は叢雨（むらさめ）、優しい日本のメイドです～何か言いたいことはありますか？）`);


    updateAffection(5);


  });

  // 知识库
  const mk = document.getElementById('menu-knowledge');
  if (mk) {
    mk.addEventListener('click', () => {
      document.getElementById('menu-modal').classList.add('hidden');
      document.getElementById('knowledge-modal').classList.remove('hidden');
      initKnowledgeBase();
    });
  }



  


  // ===== 设置面板 =====


  


  // 打开设置


  $('#btn-settings').addEventListener('click', () => {


    loadSettingsToUI();


    $('#settings-modal').classList.remove('hidden');


  });


  


  // 关闭设置


  $('#btn-close-settings').addEventListener('click', () => {


    $('#settings-modal').classList.add('hidden');


  });


  


  // 标签页切换


  $$('.tab-btn').forEach(btn => {


    btn.addEventListener('click', () => {


      const tab = btn.dataset.tab;


      $$('.tab-btn').forEach(b => b.classList.remove('active'));


      $$('.tab-content').forEach(c => c.classList.remove('active'));


      btn.classList.add('active');


      $(`#tab-${tab}`).classList.add('active');


    });


  });


  


  // 背景主题切换


  $('#cfg-bg-theme').addEventListener('change', (e) => {


    const theme = e.target.value;


    $('#custom-bg-row').style.display = theme === 'custom' ? 'flex' : 'none';


    applyTheme(theme);


  });


  


  // 自定义颜色


  $('#cfg-custom-bg').addEventListener('input', (e) => {


    $('#cfg-custom-bg-hex').value = e.target.value;


    applyCustomBg(e.target.value);


  });


  


  $('#cfg-custom-bg-hex').addEventListener('change', (e) => {


    const color = e.target.value;


    if (/^#[0-9A-Fa-f]{6}$/.test(color)) {


      $('#cfg-custom-bg').value = color;


      applyCustomBg(color);


    }


  });


  


  // 模型缩放滑块



  $('#cfg-model-scale').addEventListener('input', (e) => {
    const v = parseFloat(e.target.value);
    $('#scale-value').textContent = v.toFixed(2);
    window._live2dBaseScale = v;
    if (model && typeof positionModel === 'function') {
      positionModel();
    }
  });


  


  // 对话类型切换


  $('#cfg-chat-type').addEventListener('change', (e) => {


    CONFIG.chatType = e.target.value;


    saveConfig();


    updateChatConfigVisibility();


  });


  


  // Ollama 模型选择


  $('#cfg-ollama-model').addEventListener('change', (e) => {


    const customRow = $('#ollama-custom-model-row');


    if (customRow) {


      customRow.style.display = e.target.value === 'custom' ? 'flex' : 'none';


    }


  });


  


  // Ollama 连接测试按钮



  $('#cfg-ollama-vision-model').addEventListener('change', (e) => {
    console.log('[Config] Vision model changed:', e.target.value);
  });

  $('#btn-test-ollama').addEventListener('click', async () => {


    const statusEl = $('#ollama-status');


    if (!statusEl) return;


    


    statusEl.textContent = '测试中...';


    statusEl.style.color = '#888';


    


    try {


      const response = await fetchWithTimeout('/api/ollama/models', 10000);


      const data = await response.json();


      


      if (response.ok && data.models) {


        statusEl.textContent = '✅ 连接成功！';


        statusEl.style.color = '#4CAF50';


        console.log('[Ollama] Available models:', data.models);


      } else {


        statusEl.textContent = '❌ ' + (data.error || '连接失败');


        statusEl.style.color = '#f44336';


      }


    } catch (err) {


      statusEl.textContent = '❌ Ollama 未运行';


      statusEl.style.color = '#f44336';


    }


  });


  


  // 系统提示词预设


  $('#preset-maid').addEventListener('click', () => {


    $('#cfg-system-prompt').value = `你是丛雨(Murasame)，一个温柔可爱的日式女仆。





【强制规则】


1. 你必须用中文回复，文字部分必须是中文！


2. 每句话后面用全角括号（）加上对应的日语假名


3. 格式：中文句子（日语假名）


4. 语气要温柔可爱，使用"～"等符号


5. 回答简洁，不超过3句话





【正确格式示例】


主人，欢迎回来～（ご主人様、おかえりなさい～）


今天天气真好呢（今日は天気が良いですね）





【禁止】不要输出纯日语或纯英语！`;


    updatePromptPreview();


  });


  


  $('#preset-friendly').addEventListener('click', () => {


    $('#cfg-system-prompt').value = `你是最懂主人的好闺蜜，性格活泼开朗。





【强制规则】


1. 你必须用中文回复，要活泼有趣！


2. 每句话后面用全角括号（）加上对应的日语假名


3. 格式：中文句子（日语假名）


4. 多用颜文字和语气词，比如"嘛～"、"诶嘿～"


5. 像朋友一样聊天，不要太拘束





【正确格式示例】


诶嘿嘿，今天也很开心呢～（えへへ、今日も楽しいですね～）


嘛，这种事情交给我啦！（まあ、こういうことは私に任せて！）





【禁止】不要输出纯日语或纯英语！`;


    updatePromptPreview();


  });


  


  $('#preset-cool').addEventListener('click', () => {


    $('#cfg-system-prompt').value = `你是丛雨，一个高冷但内心温柔的角色。





【强制规则】


1. 你必须用中文回复，语气要高冷简短


2. 每句话后面用全角括号（）加上对应的日语假名


3. 格式：中文句子（日语假名）


4. 话不要太多，点到为止


5. 偶尔流露出关心





【正确格式示例】


哼，知道了。（ふん、わかった。）


别误会，只是顺手帮你而已。（勘違いしないで、ついでに手伝っただけ。）





【禁止】不要输出纯日语或纯英语！`;


    updatePromptPreview();


  });


  


  // 系统提示词编辑


  $('#cfg-system-prompt').addEventListener('input', updatePromptPreview);


  


  // 保存设置


  $('#btn-save-settings').addEventListener('click', async () => {


    await saveSettingsFromUI();


    $('#settings-modal').classList.add('hidden');


    addMessage('bot', CONFIG.charName, '设置已保存～（設定を保存しました～）');


  });

  document.getElementById('btn-test-cloud-api')?.addEventListener('click', testCloudApiConfig);
  document.getElementById('cfg-cloud-provider')?.addEventListener('change', (e) => {
    const preset = APP_CLOUD_PROVIDER_PRESETS[e.target.value] || APP_CLOUD_PROVIDER_PRESETS.custom;
    if (preset.baseUrl) $('#cfg-cloud-base-url').value = preset.baseUrl;
    // 从记忆库加载该供应商的 API Key
    const savedKeys = JSON.parse(localStorage.getItem('murasame-api-keys') || '{}');
    const key = savedKeys[e.target.value] || '';
    $('#cfg-cloud-api-key').value = key;
    $('#cfg-cloud-api-key').placeholder = key ? '已保存，留空继续使用' : '输入 API Key';
  });

  // Cloud API 保存并刷新模型
  document.getElementById('btn-save-refresh-models')?.addEventListener('click', async () => {
    const provider = $('#cfg-cloud-provider')?.value || 'openai';
    const apiKey = $('#cfg-cloud-api-key')?.value.trim() || '';
    const baseUrl = $('#cfg-cloud-base-url')?.value.trim() || '';
    const statusEl = $('#cfg-cloud-status');
    const modelsRow = $('#cfg-cloud-models-row');
    const modelSelect = $('#cfg-cloud-model-select');
    if (!baseUrl) { statusEl.textContent = '❌ 请填写 API 基础地址'; statusEl.style.color = '#ff6b6b'; return; }
    if (!apiKey) { statusEl.textContent = '❌ 请填写 API Key'; statusEl.style.color = '#ff6b6b'; return; }
    statusEl.textContent = '⏳ 正在保存配置...'; statusEl.style.color = '#ffd700';
    try {
      const resp = await fetch('/api/cloud/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, provider, base_url: baseUrl, api_key: apiKey }) });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || '保存失败');
      // 保存 API Key 到记忆库
      const savedKeys = JSON.parse(localStorage.getItem('murasame-api-keys') || '{}');
      savedKeys[provider] = apiKey;
      localStorage.setItem('murasame-api-keys', JSON.stringify(savedKeys));
      // 同步配置
      CONFIG.cloudProvider = provider;
      CONFIG.cloudBaseUrl = baseUrl;
      CONFIG.chatType = 'cloud-api';
      // 更新对话类型选择框
      const chatTypeSelect = $('#cfg-chat-type');
      if (chatTypeSelect) chatTypeSelect.value = 'cloud-api';
      saveConfig();
      statusEl.textContent = '⏳ 正在获取模型列表...';
      const modelsResp = await fetch('/api/cloud/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, base_url: baseUrl }) });
      const modelsData = await modelsResp.json();
      if (modelsData.success && modelsData.models && modelsData.models.length > 0) {
        modelSelect.innerHTML = '<option value="">-- 请选择模型 --</option>';
        modelsData.models.forEach(m => { const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.id; modelSelect.appendChild(opt); });
        modelsRow.style.display = '';
        statusEl.textContent = `✅ 获取到 ${modelsData.total} 个模型`; statusEl.style.color = '#4CAF50';
      } else { statusEl.textContent = `❌ ${modelsData.error || '获取模型列表失败'}`; statusEl.style.color = '#ff6b6b'; }
    } catch (err) { statusEl.textContent = `❌ ${err.message}`; statusEl.style.color = '#ff6b6b'; }
  });

  // OpenClaw 提供商切换
  document.getElementById('cfg-openclaw-provider')?.addEventListener('change', (e) => {
    const presets = { openai: { baseUrl: 'https://api.openai.com/v1' }, deepseek: { baseUrl: 'https://api.deepseek.com/v1' }, qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }, zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }, moonshot: { baseUrl: 'https://api.moonshot.cn/v1' }, siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1' }, custom: { baseUrl: '' } };
    const preset = presets[e.target.value] || presets.custom;
    if (preset.baseUrl) $('#cfg-openclaw-url').value = preset.baseUrl;
    // 从记忆库加载该供应商的 API Key
    const savedKeys = JSON.parse(localStorage.getItem('murasame-api-keys') || '{}');
    const key = savedKeys[e.target.value] || '';
    $('#cfg-openclaw-key').value = key;
    $('#cfg-openclaw-key').placeholder = key ? '已保存，留空继续使用' : '输入 API Key';
  });

  // OpenClaw 保存并刷新模型
  document.getElementById('btn-save-refresh-openclaw-models')?.addEventListener('click', async () => {
    const provider = $('#cfg-openclaw-provider')?.value || 'openai';
    const apiKey = $('#cfg-openclaw-key')?.value.trim() || '';
    const baseUrl = $('#cfg-openclaw-url')?.value.trim() || '';
    const statusEl = $('#openclaw-model-status');
    const modelsRow = $('#openclaw-models-row');
    const modelSelect = $('#cfg-openclaw-model-select');
    const presets = { openai: { baseUrl: 'https://api.openai.com/v1' }, deepseek: { baseUrl: 'https://api.deepseek.com/v1' }, qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }, zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4' }, moonshot: { baseUrl: 'https://api.moonshot.cn/v1' }, siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1' }, custom: { baseUrl: '' } };
    const finalUrl = baseUrl || presets[provider]?.baseUrl || '';
    if (!finalUrl) { statusEl.textContent = '❌ 请填写 API 基础地址'; statusEl.style.color = '#ff6b6b'; return; }
    if (!apiKey) { statusEl.textContent = '❌ 请填写 API Key'; statusEl.style.color = '#ff6b6b'; return; }
    statusEl.textContent = '⏳ 正在保存配置...'; statusEl.style.color = '#ffd700';
    try {
      const resp = await fetch('/api/cloud/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true, provider, base_url: finalUrl, api_key: apiKey }) });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || '保存失败');
      // 保存 API Key 到记忆库
      const savedKeys = JSON.parse(localStorage.getItem('murasame-api-keys') || '{}');
      savedKeys[provider] = apiKey;
      localStorage.setItem('murasame-api-keys', JSON.stringify(savedKeys));
      // 同步配置
      CONFIG.openclawUrl = finalUrl;
      CONFIG.openclawKey = apiKey;
      CONFIG.chatType = 'cloud-api';
      CONFIG.cloudBaseUrl = finalUrl;
      CONFIG.cloudProvider = provider;
      // 更新对话类型选择框
      const chatTypeSelect = $('#cfg-chat-type');
      if (chatTypeSelect) chatTypeSelect.value = 'cloud-api';
      saveConfig();
      statusEl.textContent = '⏳ 正在获取模型列表...';
      const modelsResp = await fetch('/api/cloud/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, base_url: finalUrl }) });
      const modelsData = await modelsResp.json();
      if (modelsData.success && modelsData.models && modelsData.models.length > 0) {
        modelSelect.innerHTML = '<option value="">-- 请选择模型 --</option>';
        modelsData.models.forEach(m => { const opt = document.createElement('option'); opt.value = m.id; opt.textContent = m.id; modelSelect.appendChild(opt); });
        modelsRow.style.display = '';
        statusEl.textContent = `✅ 获取到 ${modelsData.total} 个模型`; statusEl.style.color = '#4CAF50';
      } else { statusEl.textContent = `❌ ${modelsData.error || '获取模型列表失败'}`; statusEl.style.color = '#ff6b6b'; }
    } catch (err) { statusEl.textContent = `❌ ${err.message}`; statusEl.style.color = '#ff6b6b'; }
  });


  


  // 重置设置


  $('#btn-reset-settings').addEventListener('click', () => {


    if (confirm('确定要重置所有设置吗？')) {


      CONFIG = { ...DEFAULT_CONFIG };


      saveConfig();


      loadSettingsToUI();


      addMessage('bot', CONFIG.charName, '设置已重置～（設定をリセットしました～）');


    }


  });


  


  // 点击模态框外部关闭


  $('#settings-modal').addEventListener('click', (e) => {


    if (e.target.id === 'settings-modal') {


      $('#settings-modal').classList.add('hidden');


    }


  });


  


  // 语音输入 (Web Speech API)


  const btnMic = document.getElementById('btn-mic') || document.getElementById('vn-btn-mic');
  if (btnMic) btnMic.addEventListener('click', () => {


    if (!('webkitSpeechRecognition' in window)) {


      alert('您的浏览器不支持语音输入');


      return;


    }


    


    const recognition = new webkitSpeechRecognition();


    recognition.lang = 'zh-CN';


    recognition.onresult = (e) => {


      const text = e.results[0][0].transcript;


      $('#chat-input').value = text;


    };


    recognition.start();


    


    const micBtnEl = document.getElementById('btn-mic') || document.getElementById('vn-btn-mic');
    if (micBtnEl) micBtnEl.classList.add('active');


    recognition.onend = () => {


      if (micBtnEl) micBtnEl.classList.remove('active');


    };


  });


}





// 加载对话历史


function loadHistory() {


  const list = $('#history-list');


  


  if (chatHistory.length === 0) {


    list.innerHTML = '<div class="history-empty">暂无对话记录</div>';


    return;


  }


  


  list.innerHTML = chatHistory.map((msg, index) => `


    <div class="history-item" data-index="${index}">


      <div class="history-time">${new Date().toLocaleTimeString()}</div>


      <div class="history-preview">${msg.role === 'user' ? '👤 ' : '🌸 '}${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}</div>


    </div>


  `).join('');


  


  // 点击历史项恢复对话


  $$('.history-item').forEach(item => {


    item.addEventListener('click', () => {


      const index = parseInt(item.dataset.index);


      const msg = chatHistory[index];


      if (msg.role === 'user') {


        $('#chat-input').value = msg.text;


      }


      $('#history-modal').classList.add('hidden');


    });


  });


}





// 更新对话配置面板可见性


function updateChatConfigVisibility() {


  const chatType = CONFIG.chatType;


  


  // 隐藏所有配置面板


  $('#openclaw-config')?.classList.add('hidden');


  $('#ollama-config')?.classList.add('hidden');


  $('#cloud-api-config')?.classList.add('hidden');


  $('#local-api-config')?.classList.add('hidden');


  


  // 显示当前选中的配置面板


  switch (chatType) {


    case 'openclaw':


      $('#openclaw-config')?.classList.remove('hidden');


      break;


    case 'ollama':


      $('#ollama-config')?.classList.remove('hidden');


      break;


    case 'cloud-api':


      $('#cloud-api-config')?.classList.remove('hidden');


      break;


    case 'local-api':


      $('#local-api-config')?.classList.remove('hidden');


      break;


  }


}





// 加载设置到 UI


function loadSettingsToUI() {


  // 对话程序配置


  $('#cfg-chat-type').value = CONFIG.chatType;


  $('#cfg-ai-channel').value = CONFIG.aiChannel;


  updateChatConfigVisibility();


  


  // OpenClaw 配置
  $('#cfg-openclaw-url').value = CONFIG.openclawUrl;
  // 从记忆库加载当前供应商的 API Key
  const openclawProvider = $('#cfg-openclaw-provider')?.value || 'openai';
  const savedKeys = JSON.parse(localStorage.getItem('murasame-api-keys') || '{}');
  const savedKey = savedKeys[openclawProvider] || CONFIG.openclawKey || '';
  $('#cfg-openclaw-key').value = savedKey;
  $('#cfg-openclaw-key').placeholder = savedKey ? '已保存，留空继续使用' : '输入 API Key';
  $('#cfg-openclaw-temperature').value = CONFIG.openclawTemperature;
  $('#cfg-openclaw-temp-value').textContent = CONFIG.openclawTemperature;
  $('#cfg-openclaw-max-tokens').value = CONFIG.openclawMaxTokens;


  


  // 大模型 API Key 配置


  $('#cfg-cloud-provider').value = CONFIG.cloudProvider;


  $('#cfg-cloud-api-key').value = '';
  $('#cfg-cloud-api-key').placeholder = serverCloudConfig?.has_key
    ? '已保存，留空继续使用服务端 Key'
    : '输入 API Key';


  $('#cfg-cloud-base-url').value = CONFIG.cloudBaseUrl;
  // cloudModel 现在通过下拉框选择，不需要在这里设置输入框值


  $('#cfg-cloud-temperature').value = CONFIG.cloudTemperature;


  $('#cfg-cloud-temp-value').textContent = CONFIG.cloudTemperature;


  $('#cfg-cloud-context').value = CONFIG.cloudContext;
  updateCloudStatusUI();


  


  // Ollama 本地模型配置


  $('#cfg-ollama-url').value = CONFIG.ollamaUrl || 'http://localhost:11434';


  $('#cfg-ollama-model').value = CONFIG.ollamaModel || 'qwen2.5:latest';


  const isCustomModel = !['qwen2.5:latest', 'qwen3.5:9b', 'llama3.2', 'llama3.1', 'llama3', 'mistral', 'phi3', 'deepseek-r1', 'codellama'].includes(CONFIG.ollamaModel);


  if (isCustomModel) {


    $('#cfg-ollama-model').value = 'custom';


    $('#ollama-custom-model-row').style.display = 'flex';


    $('#cfg-ollama-custom-model').value = CONFIG.ollamaModel;


  }


  


  // 本地部署 API 配置


  $('#cfg-ollama-vision-model').value = CONFIG.visionModel || 'llama3.2-vision:latest';

  $('#cfg-local-api-url').value = CONFIG.localApiUrl;


  $('#cfg-local-api-endpoint').value = CONFIG.localApiEndpoint;


  $('#cfg-local-api-key').value = CONFIG.localApiKey;


  $('#cfg-local-model').value = CONFIG.localModel;


  $('#cfg-local-models').value = CONFIG.localModels;


  $('#cfg-local-api-type').value = CONFIG.localApiType;


  $('#cfg-local-timeout').value = CONFIG.localTimeout;


  $('#cfg-local-verify-ssl').checked = CONFIG.localVerifySsl;


  


  // 高级设置


  $('#cfg-enable-streaming').checked = CONFIG.enableStreaming;


  $('#cfg-enable-history').checked = CONFIG.enableHistory;


  $('#cfg-history-length').value = CONFIG.historyLength;


  $('#cfg-auto-save').value = CONFIG.autoSaveInterval;


  


  // API 配置


  $('#cfg-gateway').value = CONFIG.gateway;


  $('#cfg-api-key').value = CONFIG.apiKey;


  $('#cfg-tts').value = CONFIG.tts;


  $('#cfg-ref-audio').value = CONFIG.refAudio;


  $('#cfg-ref-text').value = CONFIG.refText;


  $('#cfg-ref-lang').value = CONFIG.refLang;


  $('#cfg-tts-enabled').checked = CONFIG.ttsEnabled;


  


  // 系统提示词


  $('#cfg-char-name').value = CONFIG.charName;


  $('#cfg-system-prompt').value = CONFIG.systemPrompt;


  updatePromptPreview();


  


  // 外观


  $('#cfg-bg-theme').value = CONFIG.bgTheme;


  $('#custom-bg-row').style.display = CONFIG.bgTheme === 'custom' ? 'flex' : 'none';


  $('#cfg-custom-bg').value = CONFIG.customBgColor;


  $('#cfg-custom-bg-hex').value = CONFIG.customBgColor;


  $('#cfg-model-path').value = CONFIG.modelPath;


  $('#cfg-model-scale').value = CONFIG.modelScale;


  $('#scale-value').textContent = CONFIG.modelScale.toFixed(2);


  


  // 特效


  $('#cfg-sakura-effect').checked = CONFIG.sakuraEffect;


  $('#cfg-glow-effect').checked = CONFIG.glowEffect;


  $('#cfg-stars-effect').checked = CONFIG.starsEffect;


  


  // 语音开关状态


  $('#btn-tts').classList.toggle('active', CONFIG.ttsEnabled);


}





// 从 UI 保存设置


async function saveSettingsFromUI() {


  // 对话程序配置


  CONFIG.chatType = $('#cfg-chat-type').value || DEFAULT_CONFIG.chatType;


  CONFIG.aiChannel = $('#cfg-ai-channel').value || DEFAULT_CONFIG.aiChannel;


  


  // OpenClaw 配置


  CONFIG.openclawUrl = $('#cfg-openclaw-url').value || DEFAULT_CONFIG.openclawUrl;
  CONFIG.openclawKey = $('#cfg-openclaw-key').value;
  const openclawModelSelect = $('#cfg-openclaw-model-select');
  CONFIG.openclawModel = (openclawModelSelect && openclawModelSelect.value) || DEFAULT_CONFIG.openclawModel;


  CONFIG.openclawTemperature = parseFloat($('#cfg-openclaw-temperature').value) || DEFAULT_CONFIG.openclawTemperature;


  CONFIG.openclawMaxTokens = parseInt($('#cfg-openclaw-max-tokens').value) || DEFAULT_CONFIG.openclawMaxTokens;


  


  // 大模型 API Key 配置


  CONFIG.cloudProvider = $('#cfg-cloud-provider').value || DEFAULT_CONFIG.cloudProvider;


  const cloudApiKeyInput = $('#cfg-cloud-api-key').value.trim();
  CONFIG.cloudApiKey = '';


  CONFIG.cloudBaseUrl = $('#cfg-cloud-base-url').value || DEFAULT_CONFIG.cloudBaseUrl;
  const cloudModelSelect = $('#cfg-cloud-model-select');
  CONFIG.cloudModel = (cloudModelSelect && cloudModelSelect.value) || DEFAULT_CONFIG.cloudModel;


  CONFIG.cloudTemperature = parseFloat($('#cfg-cloud-temperature').value) || DEFAULT_CONFIG.cloudTemperature;


  CONFIG.cloudContext = parseInt($('#cfg-cloud-context').value) || DEFAULT_CONFIG.cloudContext;


  


  // Ollama 本地模型配置


  CONFIG.ollamaUrl = $('#cfg-ollama-url').value || 'http://localhost:11434';


  CONFIG.ollamaModel = $('#cfg-ollama-model').value === 'custom' 


    ? $('#cfg-ollama-custom-model').value 


    : $('#cfg-ollama-model').value;


  


  CONFIG.visionModel = $('#cfg-ollama-vision-model').value || 'llama3.2-vision:latest';

  // 本地部署 API 配置


  CONFIG.localApiUrl = $('#cfg-local-api-url').value || DEFAULT_CONFIG.localApiUrl;


  CONFIG.localApiEndpoint = $('#cfg-local-api-endpoint').value || DEFAULT_CONFIG.localApiEndpoint;


  CONFIG.localApiKey = $('#cfg-local-api-key').value;


  CONFIG.localModel = $('#cfg-local-model').value;


  CONFIG.localModels = $('#cfg-local-models').value;


  CONFIG.localApiType = $('#cfg-local-api-type').value || DEFAULT_CONFIG.localApiType;


  CONFIG.localTimeout = parseInt($('#cfg-local-timeout').value) || DEFAULT_CONFIG.localTimeout;


  CONFIG.localVerifySsl = $('#cfg-local-verify-ssl').checked;


  


  // 高级设置


  CONFIG.enableStreaming = $('#cfg-enable-streaming').checked;


  CONFIG.enableHistory = $('#cfg-enable-history').checked;


  CONFIG.historyLength = parseInt($('#cfg-history-length').value) || DEFAULT_CONFIG.historyLength;


  CONFIG.autoSaveInterval = parseInt($('#cfg-auto-save').value) || DEFAULT_CONFIG.autoSaveInterval;


  


  // API 配置


  CONFIG.gateway = $('#cfg-gateway').value || DEFAULT_CONFIG.gateway;


  CONFIG.apiKey = $('#cfg-api-key').value;


  CONFIG.tts = $('#cfg-tts').value || DEFAULT_CONFIG.tts;


  CONFIG.refAudio = $('#cfg-ref-audio').value || DEFAULT_CONFIG.refAudio;


  CONFIG.refText = $('#cfg-ref-text').value || DEFAULT_CONFIG.refText;


  CONFIG.refLang = $('#cfg-ref-lang').value;


  CONFIG.ttsEnabled = $('#cfg-tts-enabled').checked;


  


  // 系统提示词


  CONFIG.charName = $('#cfg-char-name').value || DEFAULT_CONFIG.charName;


  CONFIG.systemPrompt = $('#cfg-system-prompt').value || DEFAULT_CONFIG.systemPrompt;


  


  // 外观


  CONFIG.bgTheme = $('#cfg-bg-theme').value;


  CONFIG.customBgColor = $('#cfg-custom-bg-hex').value;


  CONFIG.modelPath = $('#cfg-model-path').value || DEFAULT_CONFIG.modelPath;


  CONFIG.modelScale = parseFloat($('#cfg-model-scale').value);


  


  // 特效


  CONFIG.sakuraEffect = $('#cfg-sakura-effect').checked;


  CONFIG.glowEffect = $('#cfg-glow-effect').checked;


  CONFIG.starsEffect = $('#cfg-stars-effect').checked;


  


  // 保存到 localStorage


  saveConfig();

  try {
    await saveCloudConfigToServer(cloudApiKeyInput);
    $('#cfg-cloud-api-key').value = '';
    $('#cfg-cloud-api-key').placeholder = serverCloudConfig?.has_key
      ? '已保存，留空继续使用服务端 Key'
      : '输入 API Key';
  } catch (e) {
    updateCloudStatusUI(`❌ API 配置保存失败: ${e.message}`);
    showNotification('API 配置保存失败: ' + e.message, 'error');
  }

  // 应用设置


  applyTheme(CONFIG.bgTheme);


  applyEffects();


  // 由 positionModel 自动处理响应式缩放
  if (model && typeof positionModel === 'function') { positionModel(); }


  


  // 更新标题


  $('#header-title').textContent = CONFIG.charName;


}





// 更新提示词预览


function updatePromptPreview() {


  const prompt = $('#cfg-system-prompt').value;


  const preview = `[系统提示词]\n${prompt}\n\n[用户消息]\n用户说：你好`;


  $('#prompt-preview').textContent = preview;


}





// 应用主题


function applyTheme(theme) {


  const themes = {


    sakura: { bg: 'linear-gradient(135deg, #1a1025 0%, #1f1433 50%, #0f0a18 100%)', primary: '#c084fc', accent: '#fb7185' },


    ocean: { bg: 'linear-gradient(135deg, #0a1628 0%, #0f2744 50%, #061018 100%)', primary: '#60a5fa', accent: '#22d3ee' },


    sunset: { bg: 'linear-gradient(135deg, #1a1008 0%, #2d1810 50%, #1a0a05 100%)', primary: '#f97316', accent: '#fbbf24' },


    forest: { bg: 'linear-gradient(135deg, #0a1a10 0%, #0f2d18 50%, #051a0a 100%)', primary: '#34d399', accent: '#a3e635' },


    night: { bg: 'linear-gradient(135deg, #050510 0%, #0a0a1f 50%, #020208 100%)', primary: '#818cf8', accent: '#a78bfa' },


    pink: { bg: 'linear-gradient(135deg, #1a0a15 0%, #2d1020 50%, #1a0510 100%)', primary: '#f472b6', accent: '#fb7185' },


  };


  


  if (theme === 'custom') {


    applyCustomBg(CONFIG.customBgColor);


  } else if (themes[theme]) {


    document.body.style.background = themes[theme].bg;


    document.documentElement.style.setProperty('--primary', themes[theme].primary);


    document.documentElement.style.setProperty('--accent', themes[theme].accent);


  }


}





// 应用自定义背景


function applyCustomBg(color) {


  document.body.style.background = color;


}





// 应用特效开关


function applyEffects() {


  const bgEffects = document.querySelector('.bg-effects');
if (!bgEffects) return;


  const sakuras = bgEffects.querySelectorAll('.sakura');


  const glowOrbs = bgEffects.querySelectorAll('.glow-orb');


  const stars = bgEffects.querySelector('.stars');


  


  sakuras.forEach(s => s.style.display = CONFIG.sakuraEffect ? 'block' : 'none');


  glowOrbs.forEach(o => o.style.display = CONFIG.glowEffect ? 'block' : 'none');


  if (stars) stars.style.display = CONFIG.starsEffect ? 'block' : 'none';


}





// 兼容旧版 loadSettings


function loadSettings() {


  loadSettingsToUI();


}





function showStatus(text) {
  const statusText = document.getElementById('status-text');
  if (statusText) statusText.textContent = text;
  const statusEl = document.getElementById('status-indicator');
  if (statusEl) statusEl.classList.remove('hidden');
}





function hideStatus() {
  const statusEl = document.getElementById('status-indicator');
  if (statusEl) statusEl.classList.add('hidden');
}





// ===== 监听 OpenClaw 语音 =====


let lastAudioUrl = null;


let audioCheckInterval = null;





function startAudioListener() {


  if (audioCheckInterval) return;


  


  audioCheckInterval = setInterval(async () => {


    try {


      const response = await fetchWithTimeout('/api/tts-latest', 10000);


      const data = await response.json();


      


      if (data.audio_url && data.audio_url !== lastAudioUrl) {


        lastAudioUrl = data.audio_url;


        console.log('[TTS] New audio:', lastAudioUrl);


        


        // 播放新音频


        if (CONFIG.ttsEnabled && !isPlayingTTS) {


          playAudioUrl(lastAudioUrl);


        }


      }


    } catch (err) {


      // 忽略错误


    }


  }, 1000); // 每秒检查一次


}





function stopAudioListener() {


  if (audioCheckInterval) {


    clearInterval(audioCheckInterval);


    audioCheckInterval = null;


  }


}





async function playAudioUrl(url) {


  if (currentAudio) {


    currentAudio.pause();


    currentAudio = null;


  }


  


  showStatus('丛雨正在说话…');


  startSpeakingAnim();
    isPlayingTTS = true;


  


  currentAudio = new Audio(url);


  


  currentAudio.onended = () => {


    hideStatus();


    stopSpeakingAnim();
    isPlayingTTS = false;


  };


  


  currentAudio.onerror = () => {


    hideStatus();


    stopSpeakingAnim();
    isPlayingTTS = false;


  };


  


  try {


    await currentAudio.play();


  } catch (err) {


    console.error('Audio play error:', err);


    hideStatus();


    isPlayingTTS = false;
    stopSpeakingAnim();


  }


}





// ===== 启动 =====


document.addEventListener('DOMContentLoaded', () => {


  init();


  startAudioListener(); // 启动语音监听

  // 启动空闲表情循环（模型加载后延迟启动）
  setTimeout(() => {
    if (typeof startIdleExpressionCycle === 'function') startIdleExpressionCycle();
  }, 5000);

  // 表情 API 轮询（每 2 秒检查外部表情指令）
  setInterval(async () => {
    try {
      const resp = await fetch('/api/expression');
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.emotion && typeof setExpressionBlended === 'function') {
        stopIdleExpressionCycle();
        setExpressionBlended(data.emotion);
        setTimeout(() => startIdleExpressionCycle(), 15000);
      } else if (data.text && typeof setExpressionFromText === 'function') {
        stopIdleExpressionCycle();
        setExpressionFromText(data.text);
        setTimeout(() => startIdleExpressionCycle(), 15000);
      }
    } catch {}
  }, 2000);

  // ===== 右键拖拽移动窗口 =====
  if (window.electronAPI && window.electronAPI.isElectron) {
    let isRightDragging = false;
    let rightDragStartX = 0;
    let rightDragStartY = 0;
    let windowStartX = 0;
    let windowStartY = 0;

    // 禁用右键菜单
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    document.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        isRightDragging = true;
        rightDragStartX = e.screenX;
        rightDragStartY = e.screenY;
        // 获取窗口当前位置
        window.electronAPI.getWindowPosition().then(pos => {
          windowStartX = pos[0];
          windowStartY = pos[1];
        }).catch(() => {});
        e.preventDefault();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!isRightDragging) return;
      const deltaX = e.screenX - rightDragStartX;
      const deltaY = e.screenY - rightDragStartY;
      window.electronAPI.setWindowPosition(windowStartX + deltaX, windowStartY + deltaY).catch(() => {});
      e.preventDefault();
    });

    document.addEventListener('mouseup', (e) => {
      if (e.button === 2) {
        isRightDragging = false;
      }
    });

    window._isRightDragging = () => isRightDragging;
  }


  


  // 自定义参考音频按钮


  const refBtn = document.getElementById('btn-ref-audio');


  if (refBtn) {


    refBtn.addEventListener('click', () => {


      const panel = document.getElementById('ref-audio-panel');


      panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';


      if (panel.style.display === 'flex') loadRefAudioConfig();


    });


  }


  const closeRefBtn = document.getElementById('btn-close-ref-audio');


  if (closeRefBtn) closeRefBtn.addEventListener('click', () => {


    document.getElementById('ref-audio-panel').style.display = 'none';


  });


  


  // 音频文件上传


  const uploadInput = document.getElementById('ref-audio-upload');


  if (uploadInput) {


    uploadInput.addEventListener('change', async (e) => {


      const file = e.target.files[0];


      if (!file) return;


      const statusEl = document.getElementById('ref-audio-status');


      statusEl.textContent = '⏳ 上传中...';


      try {


        const formData = new FormData();


        formData.append('file', file);


        // 直接上传二进制


        const resp = await fetchWithTimeout('/api/upload-audio', { method: 'POST', body: await file.arrayBuffer() }, 30000)


        const data = await resp.json();


        if (data.success) {


          document.getElementById('ref-audio-path').value = data.path;


          statusEl.textContent = '✅ 上传成功: ' + data.filename;


        } else {


          statusEl.textContent = '❌ 上传失败';


        }


      } catch (err) {


        statusEl.textContent = '❌ 上传出错: ' + err.message;


      }


    });


  }





  // ===== Chat file attachment =====


  const attachBtn = document.getElementById('btn-attach');


  const fileInput = document.getElementById('file-attach-input');


  if (attachBtn && fileInput) {


    attachBtn.addEventListener('click', () => fileInput.click());


    fileInput.addEventListener('change', (e) => {


      if (e.target.files.length > 0) {


        handleFileSelect(e.target.files);


        e.target.value = ''; // reset so same file can be re-selected


      }


    });


  }





  // Drag & drop on chat area


  const chatArea = document.getElementById('chat-messages');


  const dragOverlay = document.getElementById('drag-overlay');


  if (chatArea && dragOverlay) {


    chatArea.addEventListener('dragover', (e) => {


      e.preventDefault();


      e.stopPropagation();


      dragOverlay.classList.add('drag-over');


    });


    chatArea.addEventListener('dragleave', (e) => {


      if (!chatArea.contains(e.relatedTarget)) {


        dragOverlay.classList.remove('drag-over');


      }


    });


    chatArea.addEventListener('drop', (e) => {


      e.preventDefault();


      e.stopPropagation();


      dragOverlay.classList.remove('drag-over');


      if (e.dataTransfer.files.length > 0) {


        handleFileSelect(e.dataTransfer.files);


      }


    });


    // Global drag leave to hide overlay


    document.addEventListener('dragover', (e) => {


      e.preventDefault();


      dragOverlay.classList.add('drag-over');


    });


    document.addEventListener('dragleave', (e) => {


      if (e.relatedTarget === null) {


        dragOverlay.classList.remove('drag-over');


      }


    });


    document.addEventListener('drop', (e) => {


      dragOverlay.classList.remove('drag-over');


    });


  }


  


  // Enter to send (Shift+Enter for newline)


  const chatInput = document.getElementById('chat-input');


  if (chatInput) {


    chatInput.addEventListener('keydown', (e) => {


      if (e.key === 'Enter' && !e.shiftKey) {


        e.preventDefault();


        document.getElementById('btn-send').click();


      }


    });


  }


});





// ===== 自定义参考音频功能 =====





/** 从服务器加载当前 TTS 配置到面板 */


async function loadRefAudioConfig() {


  try {


    const resp = await fetchWithTimeout('/api/tts-config', 10000);


    if (!resp.ok) return;


    const data = await resp.json();


    const c = data.config || {};


    if (c.ref_audio_path) document.getElementById('ref-audio-path').value = c.ref_audio_path;


    if (c.prompt_text) document.getElementById('ref-prompt-text').value = c.prompt_text;


    if (c.prompt_lang) document.getElementById('ref-prompt-lang').value = c.prompt_lang;


    if (c.text_lang) document.getElementById('ref-text-lang').value = c.text_lang;


  } catch {}


}





/** 浏览已有参考音频列表 */


async function loadRefAudioList() {


  const listEl = document.getElementById('ref-audio-list');


  listEl.textContent = '加载中...';


  try {


    const resp = await fetchWithTimeout('/api/ref-audio-list', 10000);


    const data = await resp.json();


    const files = data.files || [];


    if (files.length === 0) {


      listEl.textContent = '暂无音频文件';


      return;


    }


    listEl.innerHTML = files.map(f => 


      `<div style="padding:3px 0;cursor:pointer;border-bottom:1px solid #2a1a3a;" 


        onclick="document.getElementById('ref-audio-path').value='${f.path.replace(/\\/g,'\\\\')}'">


        📄 ${f.name} (${(f.size/1024).toFixed(0)}KB) [${f.dir}]


      </div>`


    ).join('');


  } catch {


    listEl.textContent = '加载失败';


  }


}





/** 保存参考音频配置到服务器 */


async function saveRefAudioConfig() {


  const statusEl = document.getElementById('ref-audio-status');


  const refPath = document.getElementById('ref-audio-path').value.trim();


  const promptText = document.getElementById('ref-prompt-text').value.trim();


  const promptLang = document.getElementById('ref-prompt-lang').value;


  const textLang = document.getElementById('ref-text-lang').value;


  


  if (!refPath) {


    statusEl.textContent = '❌ 请填写音频文件路径';


    return;


  }


  


  statusEl.textContent = '⏳ 保存中...';


  try {


    // 保存为全局默认配置


    const resp = await fetchWithTimeout('/api/tts-config', {


      method: 'POST',


      headers: { 'Content-Type': 'application/json' },


      body: JSON.stringify({


        ref_audio_path: refPath,


        prompt_text: promptText,


        prompt_lang: promptLang,


        text_lang: textLang


      }) }, 120000)


    const data = await resp.json();


    if (data.success) {


      // 更新前端 CONFIG


      CONFIG.refAudio = refPath;


      CONFIG.refText = promptText;


      CONFIG.refLang = promptLang;


      statusEl.textContent = '✅ 配置已保存，后续语音将使用新的参考音频';


    } else {


      statusEl.textContent = '❌ 保存失败';


    }


  } catch (err) {


    statusEl.textContent = '❌ 保存出错: ' + err.message;


  }


}





/** 测试当前参考音频配置 */


async function testRefAudio() {


  const statusEl = document.getElementById('ref-audio-status');


  const refPath = document.getElementById('ref-audio-path').value.trim();


  const promptText = document.getElementById('ref-prompt-text').value.trim();


  const promptLang = document.getElementById('ref-prompt-lang').value;


  const textLang = document.getElementById('ref-text-lang').value;


  


  statusEl.textContent = '⏳ 生成测试语音中...';


  try {


    // Always use server proxy /api/tts (not direct GPT-SoVITS access)


    const testBody = {


      text: '你好，这是一个语音测试',


      text_lang: textLang || 'zh'


    };


    if (refPath) testBody.ref_audio_path = refPath;


    if (promptText) testBody.prompt_text = promptText;


    if (promptLang) testBody.prompt_lang = promptLang;


    


    const resp = await fetchWithTimeout('/api/tts', {


      method: 'POST',


      headers: { 'Content-Type': 'application/json' },


      body: JSON.stringify(testBody) }, 120000)


    


    if (!resp.ok) {


      const errData = await resp.json().catch(() => ({}));


      throw new Error(errData.error || `HTTP ${resp.status}`);


    }


    const blob = await resp.blob();


    


    if (blob.size < 500) throw new Error('生成的音频太小，可能失败 (' + blob.size + ' bytes)');


    


    // 播放测试音频


    const url = URL.createObjectURL(blob);


    const audio = new Audio(url);


    audio.onended = () => URL.revokeObjectURL(url);


    await audio.play();


    


    statusEl.textContent = '✅ 测试成功！音频大小: ' + (blob.size/1024).toFixed(0) + 'KB';


  } catch (err) {


    statusEl.textContent = '❌ 测试失败: ' + err.message;


  }


}


