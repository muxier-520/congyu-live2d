// ===== Gateway WebSocket Client =====
const GW_PORT = 28789;
const GW_TOKEN = '8e98b884e9a91f6b8689a98a631024b75a2e748dcb31edba';

let _ws = null;
let _pendingRequests = {};
let _reqId = 0;
let _sessionKey = null;
let _wsConnected = false;
let _wsConnecting = false;
let _reconnectTimer = null;
let _subscribedSessions = new Set();

function GW_getUrl() {
  return 'ws://127.0.0.1:28789';
}

function GW_genId() {
  return 'req_' + Date.now() + '_' + (++_reqId);
}

function GW_init() {
  if (_wsConnecting || (_ws && _ws.readyState === WebSocket.OPEN)) return;
  _wsConnecting = true;
  _ws = new WebSocket(GW_getUrl());
  _ws.onopen = GW_onOpen;
  _ws.onmessage = GW_onMessage;
  _ws.onerror = GW_onError;
  _ws.onclose = GW_onClose;
}

function GW_onOpen() {
  console.log('[GW] Connected, waiting for challenge...');
}

function GW_onMessage(evt) {
  let msg;
  try { msg = JSON.parse(evt.data); } catch { return; }
  if (msg.type === 'event' && msg.event === 'connect.challenge') {
    GW_sendConnect(msg.payload.nonce);
  } else if (msg.type === 'res') {
    const cb = _pendingRequests[msg.id];
    if (cb) { delete _pendingRequests[msg.id]; cb(msg); }
  } else if (msg.type === 'event') {
    GW_handleEvent(msg.event, msg.payload, msg.seq);
  }
}

function GW_handleEvent(event, payload, seq) {
  if (event === 'session.message' || event.startsWith('session.')) {
    GW_dispatchSessionEvent(event, payload, seq);
  } else if (event === 'tick') {
    // keepalive, ignore
  }
  // Update status indicator
  const el = document.getElementById('gateway-status');
  if (el) el.textContent = _wsConnected ? '已连接' : '连接中...';
}

function GW_onError(err) {
  console.error('[GW] Error:', err);
  GW_updateStatus('连接错误');
}

function GW_onClose() {
  _wsConnected = false;
  _wsConnecting = false;
  _ws = null;
  GW_updateStatus('已断开');
  // Auto-reconnect after 5s
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => { if (CONFIG.aiChannel === 'gateway') GW_init(); }, 5000);
}

function GW_updateStatus(text) {
  const el = document.getElementById('gateway-status');
  if (el) el.textContent = text;
}

function GW_sendRaw(msg) {
  return new Promise((resolve, reject) => {
    if (!_ws || _ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WS not connected'));
      return;
    }
    _pendingRequests[msg.id] = (res) => {
      if (res.ok) resolve(res.payload); else reject(new Error(res.error || 'Request failed'));
    };
    _ws.send(JSON.stringify(msg));
  });
}

async function GW_sendConnect(nonce) {
  try {
    const resp = await GW_sendRaw({
      type: 'req', id: GW_genId(), method: 'connect',
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'murasame-web', version: '1.0', platform: 'web', mode: 'operator' },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        caps: [], commands: [], permissions: {},
        auth: { token: GW_TOKEN },
        locale: 'zh-CN',
        userAgent: 'Murasame/1.0'
      }
    });
    _wsConnected = true;
    _wsConnecting = false;
    GW_updateStatus('已连接');
    console.log('[GW] Handshake OK, policy:', resp.policy);
  } catch (e) {
    console.error('[GW] Connect failed:', e);
    GW_updateStatus('认证失败');
    if (_ws) _ws.close();
  }
}

async function GW_rpc(method, params) {
  return GW_sendRaw({ type: 'req', id: GW_genId(), method, params });
}

// ---- Session-based chat ----
let _activeSessionCb = null;
let _activeSessionId = null;
let _streamBuffer = '';

function GW_dispatchSessionEvent(event, payload, seq) {
  // Handle session.message events
  // OpenClaw session.message event: { event: 'session.message', sessionKey: '...', seq: N, payload: { type: 'content'|'run-end'|[done], delta?: string, text?: string } }
  if (event === 'session.message' && _activeSessionCb) {
    const sessionKey = payload.sessionKey || (payload.message && payload.message.sessionKey);
    if (sessionKey && sessionKey !== _activeSessionId) return;
    
    const msgType = payload.type || (payload.message && payload.message.type);
    const msgContent = payload.message && payload.message.content;
    
    // Extract text from various possible formats
    let text = '';
    if (payload.delta) {
      text = payload.delta;
    } else if (payload.text) {
      text = payload.text;
    } else if (Array.isArray(payload.content) && payload.content.length > 0) {
      // OpenClaw format: content: [{type: 'text', text: '...'}]
      const first = payload.content[0];
      if (typeof first === 'object' && first !== null) {
        text = first.text || '';
      }
    } else if (typeof msgContent === 'string') {
      text = msgContent;
    }
    
    if (msgType === 'run-end' || msgType === 'run.end' || msgType === '[done]') {
      _activeSessionCb({ done: true });
    } else if (text) {
      _activeSessionCb({ done: false, content: text });
    }
    return;
  }
  
  // Handle run.end / run-end top-level event
  if ((event === 'run.end' || event === 'run-end') && _activeSessionCb) {
    _activeSessionCb({ done: true });
  }
}

async function GW_createSession() {
  const resp = await GW_rpc('sessions.create', { agentId: 'main' });
  return resp.sessionKey;
}

async function GW_sendMessage(sessionKey, messages, onChunk, onDone) {
  _activeSessionId = sessionKey;
  _activeSessionCb = onChunk;
  _streamBuffer = '';

  // Subscribe to this session
  await GW_rpc('sessions.subscribe', { sessionKey });
  _subscribedSessions.add(sessionKey);
  // Subscribe to messages
  await GW_rpc('sessions.messages.subscribe', { sessionKey });

  // Send the chat message
  // If messages is an array, send the full conversation context
  // If it's a string, wrap it as a user message
  let sendParams = { sessionKey };
  if (Array.isArray(messages)) {
    // Send full conversation history with the last message as the new input
    sendParams.messages = messages;
  } else {
    sendParams.message = { role: 'user', content: messages };
  }
  
  const sendResp = await GW_rpc('sessions.send', sendParams);

  // Wait for stream to complete
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      // Check if stream is done (callback received done=true)
      // This is handled by GW_dispatchSessionEvent
    }, 100);
    
    // Timeout after 120 seconds
    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
      reject(new Error('Gateway response timeout'));
    }, 120000);
    
    // Override callback to detect completion
    const originalCb = _activeSessionCb;
    _activeSessionCb = (data) => {
      originalCb(data);
      if (data.done) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        resolve();
      }
    };
  });


async function GW_closeSession(sessionKey) {
  if (!sessionKey) return;
  try {
    await GW_rpc('sessions.delete', { sessionKey });
  } catch (e) { /* ignore */ }
  _subscribedSessions.delete(sessionKey);
}

async function GW_chat(messages, onChunk) {
  let sessionKey = null;
  try {
    sessionKey = await GW_createSession();
    await GW_sendMessage(sessionKey, messages, onChunk, () => {});
    await GW_closeSession(sessionKey);
  } catch (e) {
    if (sessionKey) await GW_closeSession(sessionKey);
    throw e;
  }
}

// Public: connect gateway WS
window.GW_init = GW_init;
// Public: close gateway WS
window.GW_close = function() {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  if (_ws) _ws.close();
  _ws = null; _wsConnected = false; _wsConnecting = false;
};
// Public: check connection status
window.GW_status = function() { return _wsConnected; };
// Public: chat via gateway WS
window.GW_chat = GW_chat;