/**
 * 对话程序配置管理
 * 支持三种配置模式：OpenClaw配置、大模型API Key、本地部署API
 */

// 快捷选择器函数（与app.js保持一致）
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== 对话配置事件监听器 =====
function initChatConfigEvents() {
  // 对话类型切换
  $('#cfg-chat-type').addEventListener('change', updateChatConfigVisibility);
  
  // OpenClaw 模型选择切换
  $('#cfg-openclaw-model').addEventListener('change', function() {
    $('.custom-model-row').style.display = this.value === 'custom' ? 'flex' : 'none';
  });
  
  // 温度滑块更新
  $('#cfg-openclaw-temperature').addEventListener('input', function() {
    $('#cfg-openclaw-temp-value').textContent = this.value;
  });
  
  $('#cfg-cloud-temperature').addEventListener('input', function() {
    $('#cfg-cloud-temp-value').textContent = this.value;
  });
  
  // API 提供商切换
  $('#cfg-cloud-provider').addEventListener('change', function() {
    const provider = this.value;
    const baseUrlInput = $('#cfg-cloud-base-url');
    const modelInput = $('#cfg-cloud-model');
    
    switch(provider) {
      case 'openai':
        baseUrlInput.value = 'https://api.openai.com/v1';
        modelInput.value = 'gpt-4-turbo';
        break;
      case 'anthropic':
        baseUrlInput.value = 'https://api.anthropic.com/v1';
        modelInput.value = 'claude-3-opus-20240229';
        break;
      case 'deepseek':
        baseUrlInput.value = 'https://api.deepseek.com/v1';
        modelInput.value = 'deepseek-chat';
        break;
      case 'qwen':
        baseUrlInput.value = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
        modelInput.value = 'qwen-max';
        break;
      case 'zhipu':
        baseUrlInput.value = 'https://open.bigmodel.cn/api/paas/v4';
        modelInput.value = 'glm-4';
        break;
      default:
        baseUrlInput.value = '';
        modelInput.value = '';
    }
  });
  
  // 本地 API 类型切换
  $('#cfg-local-api-type').addEventListener('change', function() {
    const apiType = this.value;
    const urlInput = $('#cfg-local-api-url');
    const endpointInput = $('#cfg-local-api-endpoint');
    
    switch(apiType) {
      case 'openai-compatible':
        urlInput.placeholder = 'http://127.0.0.1:8000';
        endpointInput.value = '/v1/chat/completions';
        break;
      case 'ollama':
        urlInput.placeholder = 'http://127.0.0.1:11434';
        endpointInput.value = '/api/chat';
        break;
      case 'lm-studio':
        urlInput.placeholder = 'http://127.0.0.1:1234';
        endpointInput.value = '/v1/chat/completions';
        break;
      case 'text-generation-webui':
        urlInput.placeholder = 'http://127.0.0.1:5000';
        endpointInput.value = '/v1/chat/completions';
        break;
      default:
        urlInput.placeholder = 'http://127.0.0.1:8000';
        endpointInput.value = '/v1/chat/completions';
    }
  });
}

// 更新对话配置可见性
function updateChatConfigVisibility() {
  const chatType = $('#cfg-chat-type').value;
  
  // 隐藏所有配置区域
  $('#openclaw-config').style.display = 'none';
  $('#cloud-api-config').style.display = 'none';
  $('#local-api-config').style.display = 'none';
  
  // 显示选中的配置区域
  if (chatType === 'openclaw') {
    $('#openclaw-config').style.display = 'block';
  } else if (chatType === 'cloud-api') {
    $('#cloud-api-config').style.display = 'block';
  } else if (chatType === 'local-api') {
    $('#local-api-config').style.display = 'block';
  }
}

// 根据配置类型获取API配置
function getChatApiConfig() {
  const chatType = CONFIG.chatType;
  
  switch(chatType) {
    case 'openclaw':
      return {
        type: 'openclaw',
        url: CONFIG.openclawUrl,
        apiKey: CONFIG.openclawKey,
        model: CONFIG.openclawModel === 'custom' ? CONFIG.openclawCustomModel : CONFIG.openclawModel,
        temperature: CONFIG.openclawTemperature,
        maxTokens: CONFIG.openclawMaxTokens
      };
      
    case 'cloud-api':
      return {
        type: 'cloud-api',
        provider: CONFIG.cloudProvider,
        apiKey: CONFIG.cloudApiKey,
        baseUrl: CONFIG.cloudBaseUrl,
        model: CONFIG.cloudModel,
        temperature: CONFIG.cloudTemperature,
        contextLength: CONFIG.cloudContext
      };
      
    case 'local-api':
      return {
        type: 'local-api',
        url: CONFIG.localApiUrl,
        endpoint: CONFIG.localApiEndpoint,
        apiKey: CONFIG.localApiKey,
        model: CONFIG.localModel,
        apiType: CONFIG.localApiType,
        timeout: CONFIG.localTimeout,
        verifySsl: CONFIG.localVerifySsl
      };
      
    default:
      return {
        type: 'openclaw',
        url: CONFIG.openclawUrl,
        apiKey: CONFIG.openclawKey,
        model: CONFIG.openclawModel
      };
  }
}

// 发送消息到配置的API
async function sendMessageToConfiguredAPI(message) {
  const apiConfig = getChatApiConfig();
  
  try {
    switch(apiConfig.type) {
      case 'openclaw':
        return await sendToOpenClaw(message, apiConfig);
        
      case 'cloud-api':
        return await sendToCloudAPI(message, apiConfig);
        
      case 'local-api':
        return await sendToLocalAPI(message, apiConfig);
        
      default:
        throw new Error(`未知的API类型: ${apiConfig.type}`);
    }
  } catch (error) {
    console.error('发送消息失败:', error);
    throw error;
  }
}

// 发送到OpenClaw
async function sendToOpenClaw(message, config) {
  const response = await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: CONFIG.systemPrompt },
        { role: 'user', content: message }
      ],
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      stream: CONFIG.enableStreaming
    })
  });
  
  if (!response.ok) {
    throw new Error(`OpenClaw API错误: ${response.status}`);
  }
  
  return await response.json();
}

// 发送到云API
async function sendToCloudAPI(message, config) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: CONFIG.systemPrompt },
        { role: 'user', content: message }
      ],
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.contextLength,
      stream: CONFIG.enableStreaming
    })
  });
  
  if (!response.ok) {
    throw new Error(`${config.provider} API错误: ${response.status}`);
  }
  
  return await response.json();
}

// 发送到本地API
async function sendToLocalAPI(message, config) {
  const url = `${config.url}${config.endpoint}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` })
    },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: CONFIG.systemPrompt },
        { role: 'user', content: message }
      ],
      model: config.model,
      stream: CONFIG.enableStreaming
    }),
    signal: AbortSignal.timeout(config.timeout * 1000)
  });
  
  if (!response.ok) {
    throw new Error(`本地API错误: ${response.status}`);
  }
  
  return await response.json();
}
// 初始化对话配置事件
function initChatConfig() {
  // 只需要在页面加载时绑定一次即可，绝对不能放在点击事件里重复绑定！
  initChatConfigEvents();
  // 延迟更新一次可见性即可
  setTimeout(() => {
    updateChatConfigVisibility();
  }, 100);
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initChatConfig();
});