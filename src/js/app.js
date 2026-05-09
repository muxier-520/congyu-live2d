/**


 * Live2D + OpenClaw 对话集成


 * 丛雨模型驱动


 */





// ===== 默认配置 =====


const DEFAULT_CONFIG = {


  // 对话程序配置


  chatType: 'openclaw', // openclaw, cloud-api, local-api, ollama, gateway


  aiChannel: 'http', // 'gateway' 或 'http'，控制是否使用 WebSocket 直连 Gateway


  


  // OpenClaw 配置 (默认使用 qclaw)


  openclawUrl: 'http://127.0.0.1:28789',


  openclawKey: '',


  openclawModel: 'openclaw',  // 默认使用 openclaw


  openclawCustomModel: '',


  openclawTemperature: 0.7,


  openclawMaxTokens: 2000,


  


  // 大模型 API Key 配置 (支持多厂商)


  cloudProvider: 'openai', // openai, deepseek, anthropic, zhipu, minimax, moonshot, ollama


  cloudApiKey: '',


  cloudBaseUrl: 'https://api.openai.com/v1',


  cloudModel: 'gpt-4-turbo',


  cloudTemperature: 0.7,


  cloudContext: 16384,


  


  // Ollama 本地模型配置


  ollamaUrl: 'http://localhost:11434',


  ollamaModel: 'qwen2.5:latest',


  


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





// ===== 配置（从 localStorage 加载）=====


let CONFIG = { ...DEFAULT_CONFIG };





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


function loadConfig() {


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


  localStorage.setItem('murasame-config', JSON.stringify(CONFIG));


  


  // 同步 TTS 配置到服务器


  if (CONFIG.refAudio) {


   const ttsConfig = {
      refer_wav_path: CONFIG.refAudio,
      prompt_text: CONFIG.refText || '我輩の名前は村雨。村雨丸の管理者。',
      prompt_language: CONFIG.refLang || 'ja',
      text_language: "auto"
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


    path: CONFIG.gptSovitsPath || '/'


  };


  


  fetchWithTimeout('/api/gpt-sovits-config', {


    method: 'POST',


    headers: { 'Content-Type': 'application/json' },


    body: JSON.stringify(gptSovitsConfig)


  }, 30000).catch(err => console.log('GPT-SoVITS config sync failed:', err));


}





// ===== 全局状态 =====


let app, model, chatHistory = [];


let isTyping = false, isSpeaking = false;


let currentAudio = null;





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


        CONFIG.gptSovitsPath = data.gpt_sovits.path;


      }


      


      saveConfig();


    }


  } catch (err) {


    console.log('Failed to load TTS config from server:', err);


  }


  


  initLive2D();


  initChat();


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


    const scale = 0.25;  // 减小缩放比例，让模型完整显示


    model.scale.set(scale);


    


    // 定位模型 - 底部居中，向上偏移


    const positionModel = () => {


      // 水平居中


      model.x = app.screen.width / 2;


      // 锚点设置在底部中心


      model.anchor.set(0.5, 1.0);


      // 底部对齐，稍微向上偏移


      model.y = app.screen.height - 20;


    };


    positionModel();


    


    // 窗口 resize 时重新定位


    window.addEventListener('resize', positionModel);


    


    // 启用交互


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


  const animate = () => {


    if (!model) return;


    


    time += 0.02;


    const breath = Math.sin(time) * 0.02;


    model.y += breath;


    


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


  const { x, y } = e.data.global;


  const bounds = model.getBounds();


  


  // 计算相对位置


  const relX = (x - bounds.x) / bounds.width;


  const relY = (y - bounds.y) / bounds.height;


  


  // 判断点击区域


  if (relY < 0.25) {


    // 脸部


    setExpression('exp7.exp3'); // 害羞


    playMotion('tap_head');


    addMessage('bot', '丛雨', 'もう、顔を触るのは恥ずかしいです…');


  } else if (relY < 0.5) {


    // 头发


    setExpression('exp1.exp3'); // 微笑


    playMotion('tap_head');


  } else if (relY < 0.7) {


    // 胸部


    setExpression('exp3.exp3'); // 生气


    playMotion('tap_body');


    addMessage('bot', '丛雨', 'ちょっと！どこを触っているんですか！変態！');


  } else {


    // 裙摆/腿部


    setExpression('exp4.exp3'); // 惊讶


    playMotion('tap_body');


  }


  


  // 说话动画


  startSpeakingAnim();


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


  // 加载历史


  const saved = localStorage.getItem('chat-history');


  if (saved) {


    chatHistory = JSON.parse(saved).map(msg => ({ ...msg, attachments: Array.isArray(msg.attachments) ? msg.attachments : [] }));
    chatHistory.forEach(msg => renderMessage(msg));
  }


}





function addMessage(role, sender, text, attachments = [], skipTTS = false) {


  const msg = { role, sender, text, attachments, time: Date.now() };


  chatHistory.push(msg);


  


  // 保存历史 (保留最近 100 条)


  if (chatHistory.length > 100) chatHistory.shift();


  localStorage.setItem('chat-history', JSON.stringify(chatHistory));


  


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


      return { url: CONFIG.cloudBaseUrl + '/chat/completions', model: CONFIG.cloudModel };


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





function buildMessageContent(text, attachments) {


  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return text || '';
  }
  const attList = attachments.map(a => `[附件: ${a.name} (${formatFileSize(a.size)})]`).join(', ');


  return text ? `${text}





${attList}` : `发送了附件: ${attList}`;


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


    const historyMessages = chatHistory.slice(-10).map(m => ({


      role: m.role === 'user' ? 'user' : 'assistant',


      content: buildMessageContent(m.text, m.attachments)


    }));


    


    // Step 1: Upload attachments first


    const uploadedFiles = [];


    if (attachments && attachments.length > 0) {


      for (const att of attachments) {


        try {


          // Convert dataUrl to blob for upload


          const resp = await fetchWithTimeout(att.dataUrl, 10000);


          const blob = await resp.blob();


          const upResp = await fetchWithTimeout('/api/upload-file', {


            method: 'POST',


            headers: { 'Content-Type': att.type || 'application/octet-stream' },


            body: blob


          }, 10000);


          const data = await upResp.json();


          if (data.success) {


            uploadedFiles.push({ name: att.name, url: data.url, size: att.size, type: att.type,


              dataUrl: att.dataUrl, isImage: att.isImage });


            console.log('[Upload] OK:', att.name, '->', data.url);


          } else {


            console.error('[Upload] Failed:', data.error);


          }


        } catch (e) {


          console.error('[Upload] Error:', e.message);


        }


      }


    }


    const currentAttachments = uploadedFiles.length > 0 ? uploadedFiles : attachments;


    


    // 构建请求体（含附件描述）


    const requestBody = {


      model: endpoint.model,


      messages: [


        { role: 'system', content: rolePrompt },


        ...historyMessages,


        { role: 'user', content: buildMessageContent(text, currentAttachments) }


      ],


      stream: true


    };


    


    // ===== Gateway WS 模式 =====
    if (endpoint.ws) {
      console.log('[Chat] Using Gateway WS mode');
      
      try {
        // 确保 gateway_ws.js 已加载
        if (typeof GW_chat !== 'function') {
          throw new Error('Gateway WS module not loaded. Please check gateway_ws.js');
        }
        
        // 构建消息数组
        const messages = [
          { role: 'system', content: rolePrompt },
          ...historyMessages,
          { role: 'user', content: buildMessageContent(text, currentAttachments) }
        ];
        
        // 调用 Gateway WS 发送
        await GW_chat(messages, (chunk) => {
          // chunk 格式: {done: boolean, content?: string}
          if (chunk.done) return; // 流结束，不处理
          
          const deltaText = chunk.content || '';
          if (!deltaText) return;
          
          // 流式回调：逐字更新 UI
          fullText += deltaText;
          typingEl.querySelector('.bubble').textContent = fullText;
          if (window.vnBridge) vnBridge.updateDialogText(fullText, 'bot');
          $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
          
          // 预生成 TTS（持续更新，防抖控制触发频率）
          if (fullText.length >= 5 && CONFIG.ttsEnabled && !isGeneratingTTS) {
            startPreGenerateTTS(fullText);
          }
        });
        
        // 更新最终消息
        typingMsg.text = fullText;
        typingEl.classList.remove('typing');
        
        // 保存到历史
        const idx = chatHistory.findIndex(m => m === typingMsg);
        if (idx >= 0) chatHistory[idx].text = fullText;
        localStorage.setItem('chat-history', JSON.stringify(chatHistory));
        
        // 播放语音
        if (fullText && CONFIG.ttsEnabled) {
          speak(fullText);
        }
        
        isTyping = false;
        $('#btn-send').disabled = false;
        $('#chat-input').disabled = false;
        $('#chat-input').focus();
        return;
        
      } catch (gwErr) {
        console.error('[Chat] Gateway WS error:', gwErr);
        // 降级到 HTTP 代理模式
        console.log('[Chat] Falling back to HTTP proxy mode');
        endpoint.url = '/api/gateway/v1/chat/completions';
        endpoint.ws = false;
      }
    }
    // ==========================

    // 调用对应后端


    const response = await fetchWithTimeout(endpoint.url, {


      method: 'POST',


      headers: { 


        'Content-Type': 'application/json'


      },


      body: JSON.stringify(requestBody) }, 120000)


    


    if (!response.ok) {


      const errorText = await response.text();


      console.error('[Chat] HTTP Error:', response.status, errorText);


      throw new Error(`HTTP ${response.status}: ${errorText}`);


    }


    


    console.log('[Chat] Response received, processing stream...');


    


    // 处理流式响应


    const reader = response.body.getReader();


    const decoder = new TextDecoder();


    


    while (true) {


      const { done, value } = await reader.read();


      if (done) break;


      


      const chunk = decoder.decode(value);


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


              typingEl.querySelector('.bubble').textContent = fullText;
              if (window.vnBridge) vnBridge.updateDialogText(fullText, 'bot');

              $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;


              


              // 当文本达到一定长度时，开始预生成语音


              if (fullText.length >= 5 && CONFIG.ttsEnabled && !isGeneratingTTS) {


                startPreGenerateTTS(fullText);


              }


            }


          } catch (e) {}


        }


      }


    }


    


    // 更新最终消息


    typingMsg.text = fullText;


    typingEl.classList.remove('typing');


    


    // 保存到历史


    const idx = chatHistory.findIndex(m => m === typingMsg);


    if (idx >= 0) chatHistory[idx].text = fullText;


    localStorage.setItem('chat-history', JSON.stringify(chatHistory));


    


    // 流式完成后播放语音


    if (fullText && CONFIG.ttsEnabled) {


      speak(fullText);


    }


    


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





// 预生成 TTS（流式输出过程中）


let pendingTTS = null;


let pendingTTSText = '';


let ttsDebounceTimer = null;


let isGeneratingTTS = false;


let isPlayingTTS = false;  // 新增：正在播放标志





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


  


  // 如果正在生成或正在播放，跳过


  if (isGeneratingTTS || isPlayingTTS) return;


  


  // 清除之前的定时器


  if (ttsDebounceTimer) {


    clearTimeout(ttsDebounceTimer);


  }


  


  // 200ms 后开始生成（增加防抖时间）


  ttsDebounceTimer = setTimeout(() => {


    doPreGenerateTTS(pendingTTSText);


  }, 200);


}





// 实际执行预生成


async function doPreGenerateTTS(text) {


  if (isGeneratingTTS) return;


  isGeneratingTTS = true;


  


  try {


    showStatus('正在生成语音…');


    


    // 提取日语部分用于 TTS


    const japaneseText = extractJapanese(text);


    


    const response = await fetchWithTimeout(`${CONFIG.tts}/tts`, {


      method: 'POST',


      headers: { 'Content-Type': 'application/json' },


      body: JSON.stringify({


        text: japaneseText,


        text_lang: CONFIG.refLang,


        ref_audio_path: CONFIG.refAudio,


        prompt_text: CONFIG.refText,


        prompt_lang: CONFIG.refLang


      }) }, 30000)


    


    if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);


    


    const blob = await response.blob();


    pendingTTS = { blob, text: text };


    console.log('[TTS] Pre-generated audio ready, text length:', text.length);


    


  } catch (err) {


    console.error('预生成 TTS 失败:', err);


    pendingTTS = null;
    hideStatus();
    stopSpeakingAnim();
    showStatus("GPT-SoVITS 无响应，正在重试…");

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


    


    // 检查是否有预生成的 TTS 且文本匹配


    if (pendingTTS && text.startsWith(pendingTTS.text) && pendingTTS.text.length >= 5) {


      // 使用预生成的音频


      blob = pendingTTS.blob;


      pendingTTS = null;


      console.log('[TTS] Using pre-generated audio');


    } else {


      // 需要重新生成


      // 提取日语部分用于 TTS


      const japaneseText = extractJapanese(text);


      console.log('[TTS] Generating new audio for:', japaneseText.substring(0, 30));


      


      const ttsBody = {


        text: japaneseText,


        text_lang: CONFIG.refLang || 'ja'


      };


      // Pass custom reference audio params if configured


      if (CONFIG.refAudio) ttsBody.ref_audio_path = CONFIG.refAudio;


      if (CONFIG.refText) ttsBody.prompt_text = CONFIG.refText;


      if (CONFIG.refLang) ttsBody.prompt_lang = CONFIG.refLang;


      


      const response = await fetchWithTimeout(`${CONFIG.tts}/tts`, {


        method: 'POST',


        headers: { 'Content-Type': 'application/json' },


        body: JSON.stringify(ttsBody) }, 30000)


      


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


    hideStatus();


    stopSpeakingAnim();


    isPlayingTTS = false;
    showStatus("TTS 播放失败，请检查 GPT-SoVITS");


  }


}





// ===== 事件绑定 =====


function initEvents() {


  // 发送按钮


  $('#btn-send').addEventListener('click', () => {


    const text = $('#chat-input').value.trim();


    if (!text) return;


    


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


  


  $('#btn-clear-history').addEventListener('click', () => {


    if (confirm('确定要清空所有对话历史吗？')) {


      chatHistory = [];


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


    const scale = parseFloat(e.target.value);


    $('#scale-value').textContent = scale.toFixed(2);


    if (model) {


      model.scale.set(scale);


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


  $('#btn-save-settings').addEventListener('click', () => {


    saveSettingsFromUI();


    $('#settings-modal').classList.add('hidden');


    addMessage('bot', CONFIG.charName, '设置已保存～（設定を保存しました～）');


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


  $('#btn-mic').addEventListener('click', () => {


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


    


    $('#btn-mic').classList.add('active');


    recognition.onend = () => {


      $('#btn-mic').classList.remove('active');


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


  $('#cfg-openclaw-key').value = CONFIG.openclawKey;


  $('#cfg-openclaw-model').value = CONFIG.openclawModel;


  $('#cfg-openclaw-custom-model').value = CONFIG.openclawCustomModel;


  $('.custom-model-row').style.display = CONFIG.openclawModel === 'custom' ? 'flex' : 'none';


  $('#cfg-openclaw-temperature').value = CONFIG.openclawTemperature;


  $('#cfg-openclaw-temp-value').textContent = CONFIG.openclawTemperature;


  $('#cfg-openclaw-max-tokens').value = CONFIG.openclawMaxTokens;


  


  // 大模型 API Key 配置


  $('#cfg-cloud-provider').value = CONFIG.cloudProvider;


  $('#cfg-cloud-api-key').value = CONFIG.cloudApiKey;


  $('#cfg-cloud-base-url').value = CONFIG.cloudBaseUrl;


  $('#cfg-cloud-model').value = CONFIG.cloudModel;


  $('#cfg-cloud-temperature').value = CONFIG.cloudTemperature;


  $('#cfg-cloud-temp-value').textContent = CONFIG.cloudTemperature;


  $('#cfg-cloud-context').value = CONFIG.cloudContext;


  


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


function saveSettingsFromUI() {


  // 对话程序配置


  CONFIG.chatType = $('#cfg-chat-type').value || DEFAULT_CONFIG.chatType;


  CONFIG.aiChannel = $('#cfg-ai-channel').value || DEFAULT_CONFIG.aiChannel;


  


  // OpenClaw 配置


  CONFIG.openclawUrl = $('#cfg-openclaw-url').value || DEFAULT_CONFIG.openclawUrl;


  CONFIG.openclawKey = $('#cfg-openclaw-key').value;


  CONFIG.openclawModel = $('#cfg-openclaw-model').value || DEFAULT_CONFIG.openclawModel;


  CONFIG.openclawCustomModel = $('#cfg-openclaw-custom-model').value;


  CONFIG.openclawTemperature = parseFloat($('#cfg-openclaw-temperature').value) || DEFAULT_CONFIG.openclawTemperature;


  CONFIG.openclawMaxTokens = parseInt($('#cfg-openclaw-max-tokens').value) || DEFAULT_CONFIG.openclawMaxTokens;


  


  // 大模型 API Key 配置


  CONFIG.cloudProvider = $('#cfg-cloud-provider').value || DEFAULT_CONFIG.cloudProvider;


  CONFIG.cloudApiKey = $('#cfg-cloud-api-key').value;


  CONFIG.cloudBaseUrl = $('#cfg-cloud-base-url').value || DEFAULT_CONFIG.cloudBaseUrl;


  CONFIG.cloudModel = $('#cfg-cloud-model').value || DEFAULT_CONFIG.cloudModel;


  CONFIG.cloudTemperature = parseFloat($('#cfg-cloud-temperature').value) || DEFAULT_CONFIG.cloudTemperature;


  CONFIG.cloudContext = parseInt($('#cfg-cloud-context').value) || DEFAULT_CONFIG.cloudContext;


  


  // Ollama 本地模型配置


  CONFIG.ollamaUrl = $('#cfg-ollama-url').value || 'http://localhost:11434';


  CONFIG.ollamaModel = $('#cfg-ollama-model').value === 'custom' 


    ? $('#cfg-ollama-custom-model').value 


    : $('#cfg-ollama-model').value;


  


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


  


  // 应用设置


  applyTheme(CONFIG.bgTheme);


  applyEffects();


  if (model) {


    model.scale.set(CONFIG.modelScale);


  }


  


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


  $('#status-text').textContent = text;


  $('#status-indicator').classList.remove('hidden');


}





function hideStatus() {


  $('#status-indicator').classList.add('hidden');


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


        if (CONFIG.ttsEnabled) {


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


  // 如果 speak() 已经在播放语音，跳过轮询播放避免冲突
  console.log("[TTS] playAudioUrl skipped: isPlayingTTS=true");
  if (isPlayingTTS) return;


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
    console.log("[TTS] Audio started:", url);


  } catch (err) {


    console.error('Audio play error:', err);


    hideStatus();


    stopSpeakingAnim();
    isPlayingTTS = false;


  }


}





// ===== 启动 =====


document.addEventListener('DOMContentLoaded', () => {


  init();


  startAudioListener(); // 启动语音监听


  


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


      }) }, 30000)


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


      body: JSON.stringify(testBody) }, 30000)


    


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


