/* ===== VN Bridge - 视觉小说桥接层 ===== */
/* 将右侧聊天面板转换为视觉小说风格的底部对话框 */
/* 监听隐藏的 #chat-messages，同步到 VN 对话框 */

class VNBridge {
  constructor() {
    this.dialogText = null;
    this.speakerLabel = null;
    this.backlog = [];
    this.observer = null;
    this.typingTimer = null;
    this.isTyping = false;
  }

  init() {
    this.dialogText = document.getElementById('vn-dialog-text-content');
    this.speakerLabel = document.getElementById('vn-dialog-speaker-label');

    // 事件委托——只绑定一次到 controls 容器
    const controls = document.getElementById('vn-dialog-controls');
    if (controls) {
      controls.addEventListener('click', (e) => {
        const btn = e.target.closest('.vn-icon-btn');
        if (btn && btn.id) this.handleButtonClick(btn.id);
      });
    }

    this.watchChatMessages();
    this.setupQuickPhrases();
    this.setupBacklog();
    console.log('[VNBridge] init done');
  }

  /* ---- 按钮路由 ---- */
  handleButtonClick(id) {
    // 诊断——显示点击反馈到对话框
    if (this.dialogText) this.dialogText.textContent = '⏳ ' + id + ' 已触发...';
    switch (id) {
      case 'vn-btn-tts': {
        const hiddenBtn = document.getElementById('btn-tts');
        if (hiddenBtn) hiddenBtn.click();
        if (window.CONFIG) this.toggleTTSBtn(window.CONFIG.ttsEnabled);
        break;
      }
      case 'vn-btn-tts-mode':
        if (typeof switchTTSMode === 'function') switchTTSMode();
        break;
      case 'vn-btn-ref-audio': {
        const panel = document.getElementById('ref-audio-panel');
        if (panel) panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
        break;
      }
      case 'vn-btn-mic':
        this.showModal('recorder-modal');
        break;
      case 'vn-btn-model':
        this.showModal('model-modal');
        break;
      case 'vn-btn-skills':
        this.showModal('skills-modal');
        break;
      case 'vn-btn-menu':
        this.showModal('menu-modal');
        break;
      case 'vn-btn-settings':
        try { if (typeof loadSettingsToUI === 'function') loadSettingsToUI(); } catch (e) { console.error('[VNBridge] loadSettingsToUI error:', e); }
        this.showModal('settings-modal');
        break;
      case 'vn-btn-backlog':
        this.openBacklog();
        break;
    }
  }

  /* ---- 打开模态框（直接操作 display 绕过 CSS 过渡延迟）---- */
  showModal(id) {
    const el = document.getElementById(id);
    if (!el) {
      if (this.dialogText) this.dialogText.textContent = '❌ 找不到元素: ' + id;
      return;
    }
    el.classList.remove('hidden');
    el.style.display = 'flex';
    // 强制双重重绘以确保立即显示
    void el.offsetWidth;
    if (this.dialogText) this.dialogText.textContent = '✅ ' + id + ' 已打开';
  }

  toggleTTSBtn(enabled) {
    const btn = document.getElementById('vn-btn-tts');
    if (btn) {
      btn.classList.toggle('active', enabled);
      btn.textContent = enabled ? '🔊' : '🔇';
    }
  }

  /* ---- MutationObserver - 监控隐藏 #chat-messages --- */
  watchChatMessages() {
    const target = document.getElementById('chat-messages');
    if (!target) return;

    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) this.handleNewMessageNode(node);
        }
      }
    });

    this.observer.observe(target, { childList: true, subtree: true });
  }

  handleNewMessageNode(node) {
    const isMessage = node.classList && (
      node.classList.contains('message') ||
      node.classList.contains('chat-message') ||
      node.querySelector('.bubble')
    );
    if (!isMessage) return;

    const text = node.textContent || node.innerText;
    if (!text || text.includes('正在输入') || text.includes('正在思考')) return;

    const isUser = node.classList.contains('user') ||
                   (node.parentElement && node.parentElement.classList.contains('user'));

    this.showVNMessage(isUser ? 'user' : 'bot', text);
  }

  /* ---- VN 对话框更新 ---- */
  showVNMessage(role, text) {
    const speaker = role === 'user' ? '主人' : '丛雨';
    if (this.speakerLabel) this.speakerLabel.textContent = speaker;

    if (role === 'user') {
      if (this.dialogText) {
        this.dialogText.textContent = text;
        this.dialogText.classList.remove('typing');
      }
    } else if (!this.isTyping) {
      this.typewriteText(text);
    }

    this.backlog.push({
      role, speaker, text,
      time: new Date().toLocaleTimeString()
    });
  }

  /* ---- 流式更新（由 app.js 调用） ---- */
  updateDialogText(text, role) {
    const speaker = role === 'user' ? '主人' : '丛雨';
    if (this.speakerLabel) this.speakerLabel.textContent = speaker;
    if (this.dialogText) this.dialogText.textContent = text;

    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
      this.isTyping = false;
      if (this.dialogText) this.dialogText.classList.remove('typing');
    }
  }

  /* ---- 打字机效果 ---- */
  typewriteText(fullText) {
    if (this.typingTimer) {
      clearInterval(this.typingTimer);
      this.typingTimer = null;
    }

    this.isTyping = true;
    if (this.dialogText) {
      this.dialogText.classList.add('typing');
      this.dialogText.textContent = '';
    }
    let index = 0;
    const chars = [...fullText];

    this.typingTimer = setInterval(() => {
      if (index < chars.length) {
        if (this.dialogText) {
          this.dialogText.textContent += chars[index++];
          this.dialogText.scrollTop = this.dialogText.scrollHeight;
        }
      } else {
        clearInterval(this.typingTimer);
        this.typingTimer = null;
        this.isTyping = false;
        if (this.dialogText) this.dialogText.classList.remove('typing');
      }
    }, 30);
  }

  /* ---- Backlog 对话记录 ---- */
  openBacklog() {
    this.renderBacklog();
    const overlay = document.getElementById('vn-backlog-overlay');
    if (overlay) { overlay.classList.add('active'); void overlay.offsetWidth; }
  }

  closeBacklog() {
    const overlay = document.getElementById('vn-backlog-overlay');
    if (overlay) overlay.classList.remove('active');
  }

  renderBacklog() {
    const container = document.getElementById('vn-backlog-content');
    if (!container) return;

    if (this.backlog.length === 0) {
      container.innerHTML = '<div class="vn-backlog-empty">暂无对话记录</div>';
      return;
    }

    container.innerHTML = this.backlog.map((item, i) =>
      `<div class="vn-backlog-item" style="animation-delay:${Math.min(i * 0.02, 0.3)}s">
        <div class="vn-backlog-item-header">
          <span class="vn-backlog-speaker ${item.role}">${item.speaker}</span>
          <span class="vn-backlog-time">${item.time}</span>
        </div>
        <div class="vn-backlog-text">${this.escapeHtml(item.text)}</div>
      </div>`
    ).join('');

    container.scrollTop = container.scrollHeight;
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  clearHistory() {
    if (!confirm('确定清空所有对话记录吗？')) return;
    this.backlog = [];
    if (this.dialogText) this.dialogText.textContent = '对话已清空';
    this.renderBacklog();
  }

  /* ---- 快捷短语 ---- */
  setupQuickPhrases() {
    document.querySelectorAll('#vn-quick-phrases .quick-phrase').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.dataset.text || btn.textContent.replace(/^[^\s]+\s*/, '').trim();
        const input = document.getElementById('chat-input');
        if (input) {
          input.value = text;
          const sendBtn = document.getElementById('btn-send');
          if (sendBtn) sendBtn.click();
        }
      });
    });
  }

  /* ---- Backlog 事件绑定 ---- */
  setupBacklog() {
    document.getElementById('vn-backlog-close')?.addEventListener('click', () => this.closeBacklog());
    document.getElementById('vn-backlog-clear')?.addEventListener('click', () => this.clearHistory());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const overlay = document.getElementById('vn-backlog-overlay');
        if (overlay && overlay.classList.contains('active')) this.closeBacklog();
      }
    });

    document.getElementById('vn-backlog-overlay')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeBacklog();
    });
  }
}

// 全局实例
window.vnBridge = new VNBridge();
