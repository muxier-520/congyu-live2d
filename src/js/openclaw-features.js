/**
 * OpenClaw 功能集成模块
 * 为桌面端添加 OpenClaw 的核心功能
 */

// ===== 模型管理 =====
let availableModels = [];
let currentModel = 'qclaw/modelroute';

// 模型列表（从 OpenClaw 获取或使用默认值）
const DEFAULT_MODELS = [
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', icon: '🔮', desc: '国产开源模型，性价比高' },
    { id: 'deepseek/deepseek-coder', name: 'DeepSeek Coder', icon: '💻', desc: '专为代码优化' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', icon: '🧠', desc: 'OpenAI 最强模型' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', icon: '⚡', desc: '快速响应' },
    { id: 'qwen-max', name: 'Qwen Max', icon: '🌟', desc: '阿里通义千问最强' },
    { id: 'qwen-plus', name: 'Qwen Plus', icon: '✨', desc: '阿里通义千问增强' },
    { id: 'claude-3-opus', name: 'Claude 3 Opus', icon: '🎭', desc: 'Anthropic 最强模型' },
    { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet', icon: '🎨', desc: '平衡性能与速度' },
    { id: 'minimax', name: 'MiniMax', icon: '🌊', desc: '国产大模型' }
];

// 初始化模型列表
async function initModels() {
    try {
        // 尝试从 OpenClaw 获取模型列表
        const response = await fetch('/api/gateway/v1/models');
        if (response.ok) {
            const data = await response.json();
            if (data.data && Array.isArray(data.data)) {
                availableModels = data.data.map(m => ({
                    id: m.id,
                    name: m.id.split('/').pop() || m.id,
                    icon: '🤖',
                    desc: m.owned_by || '自定义模型'
                }));
            }
        }
    } catch (err) {
        console.log('[Models] Using default model list');
    }
    
    // 如果获取失败或为空，使用默认列表
    if (availableModels.length === 0) {
        availableModels = DEFAULT_MODELS;
    }
    
    // 从配置加载当前模型
    const savedModel = localStorage.getItem('murasame-model');
    if (savedModel) {
        currentModel = savedModel;
    }
    
    // 更新UI
    updateModelIndicator();
}

// 更新模型指示器
function updateModelIndicator() {
    const modelNameEl = document.getElementById('current-model-name');
    if (modelNameEl) {
        const model = availableModels.find(m => m.id === currentModel);
        modelNameEl.textContent = model ? model.name : currentModel.split('/').pop();
    }
}

// 打开模型选择器
function openModelSelector() {
    const modal = document.getElementById('model-modal');
    if (!modal) return;
    
    // 渲染模型列表
    renderModelList();
    
    modal.classList.remove('hidden');
}

// 渲染模型列表
function renderModelList() {
    const listEl = document.getElementById('model-list');
    if (!listEl) return;
    
    if (availableModels.length === 0) {
        listEl.innerHTML = '<div class="model-loading">加载中...</div>';
        return;
    }
    
    listEl.innerHTML = availableModels.map(model => `
        <div class="model-item ${model.id === currentModel ? 'selected' : ''}" 
             onclick="selectModel('${model.id}')">
            <span class="model-item-icon">${model.icon}</span>
            <div class="model-item-info">
                <div class="model-item-name">${model.name}</div>
                <div class="model-item-desc">${model.desc}</div>
            </div>
            <span class="model-item-check">✓</span>
        </div>
    `).join('');
}

// 选择模型
function selectModel(modelId) {
    currentModel = modelId;
    localStorage.setItem('murasame-model', modelId);
    
    // 更新本地配置
    if (typeof CONFIG !== 'undefined') {
        CONFIG.openclawModel = modelId;
    }
    
    // 更新UI
    updateModelIndicator();
    renderModelList();
    
    // 显示选中提示
    const model = availableModels.find(m => m.id === modelId);
    showNotification(`已切换到 ${model ? model.name : modelId}`, 'success');
}

// ===== 技能管理 =====
let activeSkill = null;

const SKILL_DEFINITIONS = {
    'web-search': {
        name: '联网搜索',
        icon: '🔍',
        description: '搜索互联网获取最新信息',
        trigger: '/搜索',
        handler: handleWebSearch
    },
    'calculator': {
        name: '计算器',
        icon: '🧮',
        description: '数学计算和单位转换',
        trigger: '/计算',
        handler: handleCalculator
    },
    'translator': {
        name: '翻译',
        icon: '🌐',
        description: '多语言翻译服务',
        trigger: '/翻译',
        handler: handleTranslator
    },
    'weather': {
        name: '天气',
        icon: '🌤️',
        description: '查询天气预报',
        trigger: '/天气',
        handler: handleWeather
    },
    'news': {
        name: '新闻',
        icon: '📰',
        description: '获取最新资讯',
        trigger: '/新闻',
        handler: handleNews
    },
    'schedule': {
        name: '日程',
        icon: '📅',
        description: '管理日程和提醒',
        trigger: '/日程',
        handler: handleSchedule
    },
    'reminder': {
        name: '定时提醒',
        icon: '⏰',
        description: '设置定时提醒',
        trigger: '/提醒',
        handler: handleReminder
    },
    'memory': {
        name: '记忆',
        icon: '🧠',
        description: '查看和管理记忆',
        trigger: '/记忆',
        handler: handleMemory
    },
    'files': {
        name: '文件管理',
        icon: '📁',
        description: '浏览和管理文件',
        trigger: '/文件',
        handler: handleFiles
    },
    'code': {
        name: '代码助手',
        icon: '💻',
        description: '编程帮助和代码生成',
        trigger: '/代码',
        handler: handleCode
    }
};

// 打开技能面板
function openSkillsPanel() {
    const modal = document.getElementById('skills-modal');
    if (!modal) return;
    
    renderSkillsList();
    modal.classList.remove('hidden');
}

// 渲染技能列表
function renderSkillsList(category = 'all') {
    const gridEl = document.getElementById('skills-grid');
    if (!gridEl) return;
    
    let skills = Object.entries(SKILL_DEFINITIONS);
    
    // 根据分类筛选
    if (category !== 'all') {
        const categoryMap = {
            'productivity': ['web-search', 'calculator', 'schedule', 'reminder', 'files'],
            'knowledge': ['translator', 'weather', 'news', 'memory'],
            'creative': ['code']
        };
        const categorySkills = categoryMap[category] || [];
        skills = skills.filter(([id]) => categorySkills.includes(id));
    }
    
    gridEl.innerHTML = skills.map(([id, skill]) => `
        <div class="skill-item ${activeSkill === id ? 'active' : ''}" 
             data-skill="${id}"
             onclick="activateSkill('${id}')">
            <span class="skill-icon">${skill.icon}</span>
            <span class="skill-name">${skill.name}</span>
            <span class="skill-desc">${skill.description}</span>
        </div>
    `).join('');
    
    // 更新分类高亮
    document.querySelectorAll('.skill-category').forEach(el => {
        el.classList.toggle('active', el.dataset.category === category);
    });
}

// 激活技能
function activateSkill(skillId) {
    const skill = SKILL_DEFINITIONS[skillId];
    if (!skill) return;
    
    activeSkill = skillId;
    
    // 保存到本地存储
    localStorage.setItem('murasame-active-skill', skillId);
    
    // 更新UI
    const indicator = document.getElementById('skill-active-indicator');
    const skillName = document.getElementById('active-skill-name');
    if (indicator && skillName) {
        indicator.style.display = 'flex';
        skillName.textContent = skill.name;
    }
    
    renderSkillsList();
    
    showNotification(`技能 "${skill.name}" 已启用 ${skill.trigger}`, 'success');
}

// 停用技能
function deactivateSkill() {
    activeSkill = null;
    localStorage.removeItem('murasame-active-skill');
    
    const indicator = document.getElementById('skill-active-indicator');
    if (indicator) {
        indicator.style.display = 'none';
    }
    
    renderSkillsList();
    showNotification('技能已停用', 'info');
}

// ===== 技能处理器 =====

// 联网搜索
async function handleWebSearch(query) {
    showNotification('正在搜索...', 'info');
    // 这里可以调用实际的搜索API
    return `搜索结果：关于"${query}"的信息`;
}

// 计算器
function handleCalculator(expression) {
    try {
        // 安全计算（只允许数字和基本运算符）
        const safeExpr = expression.replace(/[^0-9+\-*/().%]/g, '');
        const result = Function(`"use strict"; return (${safeExpr})`)();
        return `计算结果：${expression} = ${result}`;
    } catch (e) {
        return '计算表达式无效';
    }
}

// 翻译
async function handleTranslator(text) {
    showNotification('正在翻译...', 'info');
    return `翻译结果：${text}`;
}

// 天气
async function handleWeather(city) {
    showNotification('查询天气中...', 'info');
    return `天气查询：关于"${city || '当前城市'}"的天气`;
}

// 新闻
async function handleNews() {
    showNotification('获取新闻中...', 'info');
    return '新闻资讯获取中...';
}

// 日程管理
function handleSchedule() {
    openSchedulePanel();
    return '打开日程管理';
}

// 定时提醒
function handleReminder() {
    openReminderPanel();
    return '打开定时提醒';
}

// 记忆管理
function handleMemory() {
    openMemoryPanel();
    return '打开记忆中心';
}

// 文件管理
function handleFiles() {
    showNotification('文件管理功能开发中...', 'info');
    return '文件管理功能即将推出';
}

// 代码助手
function handleCode() {
    showNotification('代码助手功能开发中...', 'info');
    return '代码助手功能即将推出';
}

// ===== 记忆管理 =====
let memories = [];

function loadMemories() {
    const saved = localStorage.getItem('murasame-memories');
    if (saved) {
        try {
            memories = JSON.parse(saved);
        } catch (e) {
            memories = [];
        }
    }
}

function saveMemories() {
    localStorage.setItem('murasame-memories', JSON.stringify(memories));
}

function openMemoryPanel() {
    const modal = document.getElementById('memory-modal');
    if (!modal) return;
    
    loadMemories();
    renderMemoryList('recent');
    modal.classList.remove('hidden');
}

function renderMemoryList(tab) {
    const listEl = document.getElementById('memory-list');
    if (!listEl) return;
    
    if (memories.length === 0) {
        listEl.innerHTML = '<div class="memory-empty">暂无记忆记录</div>';
        return;
    }
    
    let filteredMemories = memories;
    if (tab === 'important') {
        filteredMemories = memories.filter(m => m.important);
    } else if (tab === 'facts') {
        filteredMemories = memories.filter(m => m.type === 'fact');
    }
    
    listEl.innerHTML = filteredMemories.map((m, i) => `
        <div class="memory-item">
            <span class="memory-item-icon">${m.important ? '⭐' : '📝'}</span>
            <div class="memory-item-content">
                <div class="memory-item-text">${m.text}</div>
                <div class="memory-item-time">${m.time || '刚刚'}</div>
            </div>
        </div>
    `).join('');
}

function addMemory() {
    const text = prompt('输入要记忆的内容：');
    if (text) {
        memories.unshift({
            text: text,
            time: new Date().toLocaleString('zh-CN'),
            important: false,
            type: 'note'
        });
        saveMemories();
        renderMemoryList('recent');
        showNotification('记忆已添加', 'success');
    }
}

// ===== 日程管理 =====
let schedules = [];

function loadSchedules() {
    const saved = localStorage.getItem('murasame-schedules');
    if (saved) {
        try {
            schedules = JSON.parse(saved);
        } catch (e) {
            schedules = [];
        }
    }
}

function saveSchedules() {
    localStorage.setItem('murasame-schedules', JSON.stringify(schedules));
}

function openSchedulePanel() {
    const modal = document.getElementById('schedule-modal');
    if (!modal) return;
    
    loadSchedules();
    updateScheduleDisplay();
    modal.classList.remove('hidden');
}

function updateScheduleDisplay() {
    const dateEl = document.getElementById('schedule-date');
    const eventsEl = document.getElementById('schedule-events');
    
    if (dateEl) {
        const today = new Date();
        dateEl.textContent = `${today.getMonth() + 1}月${today.getDate()}日 ${['日', '一', '二', '三', '四', '五', '六'][today.getDay()]}曜日`;
    }
    
    if (eventsEl) {
        if (schedules.length === 0) {
            eventsEl.innerHTML = '<div class="schedule-empty">今日暂无日程</div>';
        } else {
            eventsEl.innerHTML = schedules.map(s => `
                <div class="schedule-event">
                    <span class="schedule-event-time">${s.time}</span>
                    <span class="schedule-event-text">${s.text}</span>
                </div>
            `).join('');
        }
    }
}

function addSchedule() {
    const textInput = document.getElementById('schedule-input');
    const timeInput = document.getElementById('schedule-time');
    
    if (!textInput || !timeInput) return;
    
    const text = textInput.value.trim();
    const time = timeInput.value;
    
    if (text && time) {
        schedules.push({ text, time });
        saveSchedules();
        updateScheduleDisplay();
        textInput.value = '';
        showNotification('日程已添加', 'success');
    }
}

// ===== 定时提醒 =====
let reminders = [];

function loadReminders() {
    const saved = localStorage.getItem('murasame-reminders');
    if (saved) {
        try {
            reminders = JSON.parse(saved);
        } catch (e) {
            reminders = [];
        }
    }
}

function saveReminders() {
    localStorage.setItem('murasame-reminders', JSON.stringify(reminders));
}

function openReminderPanel() {
    const modal = document.getElementById('reminder-modal');
    if (!modal) return;
    
    loadReminders();
    renderReminderList();
    modal.classList.remove('hidden');
}

function renderReminderList() {
    const listEl = document.getElementById('reminder-list');
    if (!listEl) return;
    
    if (reminders.length === 0) {
        listEl.innerHTML = '<div class="reminder-empty">暂无提醒</div>';
        return;
    }
    
    listEl.innerHTML = reminders.map((r, i) => `
        <div class="reminder-item">
            <span class="reminder-item-icon">⏰</span>
            <div class="reminder-item-info">
                <div class="reminder-item-text">${r.text}</div>
                <div class="reminder-item-time">${r.type} · ${r.time}</div>
            </div>
            <button class="reminder-item-delete" onclick="deleteReminder(${i})">删除</button>
        </div>
    `).join('');
}

function createReminder() {
    const textInput = document.getElementById('reminder-text');
    const typeSelect = document.getElementById('reminder-type');
    const timeInput = document.getElementById('reminder-time');
    
    if (!textInput || !typeSelect || !timeInput) return;
    
    const text = textInput.value.trim();
    const type = typeSelect.value;
    const time = timeInput.value;
    
    if (text && time) {
        reminders.push({ text, type, time });
        saveReminders();
        renderReminderList();
        textInput.value = '';
        showNotification('提醒已创建', 'success');
        
        // 如果浏览器支持，可以设置 Web Notification
        if ('Notification' in window && Notification.permission === 'granted') {
            scheduleNotification(text, time);
        }
    }
}

function deleteReminder(index) {
    reminders.splice(index, 1);
    saveReminders();
    renderReminderList();
    showNotification('提醒已删除', 'info');
}

function scheduleNotification(text, time) {
    const [hours, minutes] = time.split(':').map(Number);
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
    
    if (target <= now) {
        target.setDate(target.getDate() + 1);
    }
    
    const delay = target.getTime() - now.getTime();
    
    setTimeout(() => {
        new Notification('丛雨提醒 ⏰', { body: text });
    }, delay);
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    // 初始化模型
    initModels();
    
    // 加载活跃技能
    const savedSkill = localStorage.getItem('murasame-active-skill');
    if (savedSkill && SKILL_DEFINITIONS[savedSkill]) {
        activeSkill = savedSkill;
        const indicator = document.getElementById('skill-active-indicator');
        const skillName = document.getElementById('active-skill-name');
        if (indicator && skillName) {
            indicator.style.display = 'flex';
            skillName.textContent = SKILL_DEFINITIONS[savedSkill].name;
        }
    }
    
    // 绑定技能分类点击
    document.querySelectorAll('.skill-category').forEach(el => {
        el.addEventListener('click', () => {
            renderSkillsList(el.dataset.category);
        });
    });
    
    // 绑定记忆标签点击
    document.querySelectorAll('.memory-tab').forEach(el => {
        el.addEventListener('click', () => {
            document.querySelectorAll('.memory-tab').forEach(t => t.classList.remove('active'));
            el.classList.add('active');
            renderMemoryList(el.dataset.tab);
        });
    });
    
    // 绑定关闭按钮
    document.getElementById('btn-close-model')?.addEventListener('click', () => {
        document.getElementById('model-modal')?.classList.add('hidden');
    });
    
    document.getElementById('btn-close-skills')?.addEventListener('click', () => {
        document.getElementById('skills-modal')?.classList.add('hidden');
    });
    
    document.getElementById('btn-close-memory')?.addEventListener('click', () => {
        document.getElementById('memory-modal')?.classList.add('hidden');
    });
    
    document.getElementById('btn-close-schedule')?.addEventListener('click', () => {
        document.getElementById('schedule-modal')?.classList.add('hidden');
    });
    
    document.getElementById('btn-close-reminder')?.addEventListener('click', () => {
        document.getElementById('reminder-modal')?.classList.add('hidden');
    });
});

// 检查消息是否触发技能
function checkSkillTrigger(message) {
    if (!activeSkill) return null;
    
    const skill = SKILL_DEFINITIONS[activeSkill];
    if (!skill) return null;
    
    if (message.startsWith(skill.trigger)) {
        const args = message.slice(skill.trigger.length).trim();
        return { skill: activeSkill, args };
    }
    
    return null;
}

// 请求通知权限
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}
