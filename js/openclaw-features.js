/**
 * OpenClaw 功能集成模块
 * 为桌面端添加 OpenClaw 的核心功能
 */

// ===== 模型管理 =====
let modelSetupMode = 'ollama';
let availableOllamaModels = [];
let cloudConfigStatus = null;
let availableCloudModels = [];
let cloudModelsLoading = false;

const CLOUD_PROVIDER_PRESETS = {
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    moonshot: { baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    siliconflow: { baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
    custom: { baseUrl: '', model: '' }
};

const OLLAMA_FALLBACK_MODELS = [
    'qwen2.5:latest',
    'llama3.2:latest',
    'llama3.1:latest',
    'deepseek-r1:latest',
    'mistral:latest'
];

function modelEscape(value) {
    const div = document.createElement('div');
    div.textContent = value || '';
    return div.innerHTML;
}

function modelAttr(value) {
    return modelEscape(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getModelSetupMode() {
    if (typeof CONFIG !== 'undefined' && CONFIG.chatType === 'cloud-api') return 'cloud-api';
    return 'ollama';
}

async function initModels() {
    modelSetupMode = getModelSetupMode();
    await Promise.allSettled([loadCloudModelConfig(), loadOllamaModelList(false)]);
    updateModelIndicator();
}

async function loadCloudModelConfig() {
    try {
        const resp = await fetch('/api/cloud/config');
        if (!resp.ok) return;
        const data = await resp.json();
        cloudConfigStatus = data.config || null;
        if (cloudConfigStatus && typeof CONFIG !== 'undefined') {
            CONFIG.cloudProvider = cloudConfigStatus.provider || CONFIG.cloudProvider;
            CONFIG.cloudBaseUrl = cloudConfigStatus.base_url || CONFIG.cloudBaseUrl;
            CONFIG.cloudModel = cloudConfigStatus.model || CONFIG.cloudModel;
        }
    } catch (err) {
        console.log('[Models] Cloud config unavailable:', err.message);
    }
}

async function loadOllamaModelList(showErrors = false) {
    try {
        const resp = await fetch('/api/ollama/models');
        if (!resp.ok) throw new Error('Ollama not ready');
        const data = await resp.json();
        availableOllamaModels = (data.models || []).map(m => m.name).filter(Boolean);
    } catch (err) {
        availableOllamaModels = [];
        if (showErrors) showNotification('Ollama 暂时不可用，可先手动输入模型名', 'warning');
    }
}

function updateModelIndicator() {
    const modelNameEl = document.getElementById('current-model-name');
    if (!modelNameEl || typeof CONFIG === 'undefined') return;

    if (CONFIG.chatType === 'cloud-api') {
        modelNameEl.textContent = `API: ${CONFIG.cloudModel || '未配置'}`;
        return;
    }
    if (CONFIG.chatType === 'ollama') {
        modelNameEl.textContent = `Ollama: ${CONFIG.ollamaModel || '未配置'}`;
        return;
    }
    modelNameEl.textContent = 'Gateway';
}

function openModelSelector() {
    const modal = document.getElementById('model-modal');
    if (!modal) return;
    modelSetupMode = getModelSetupMode();
    renderModelList();
    modal.classList.remove('hidden');
    loadOllamaModelList(false).then(() => {
        if (!modal.classList.contains('hidden')) renderModelList();
    });
}

function renderModelList() {
    const listEl = document.getElementById('model-list');
    const infoEl = document.getElementById('model-info');
    if (!listEl || typeof CONFIG === 'undefined') return;

    const ollamaModel = CONFIG.ollamaModel || 'qwen2.5:latest';
    const cloudProvider = CONFIG.cloudProvider || 'openai';
    const cloudBaseUrl = CONFIG.cloudBaseUrl || CLOUD_PROVIDER_PRESETS[cloudProvider]?.baseUrl || '';
    const cloudModel = CONFIG.cloudModel || CLOUD_PROVIDER_PRESETS[cloudProvider]?.model || '';
    const ollamaOptions = (availableOllamaModels.length ? availableOllamaModels : OLLAMA_FALLBACK_MODELS)
        .map(name => `<option value="${modelAttr(name)}" ${name === ollamaModel ? 'selected' : ''}>${modelEscape(name)}</option>`)
        .join('');

    // 生成云模型列表 HTML
    let cloudModelsHtml = '';
    if (cloudModelsLoading) {
        cloudModelsHtml = '<div class="model-loading">正在加载模型列表...</div>';
    } else if (availableCloudModels.length > 0) {
        cloudModelsHtml = `
            <div class="model-field">
                <label>选择模型</label>
                <select id="model-cloud-select">
                    <option value="">-- 请选择模型 --</option>
                    ${availableCloudModels.map(m => `<option value="${modelAttr(m.id)}" ${m.id === cloudModel ? 'selected' : ''}>${modelEscape(m.id)}</option>`).join('')}
                </select>
            </div>
        `;
    }

    listEl.innerHTML = `
        <div class="model-mode-tabs">
            <button class="${modelSetupMode === 'ollama' ? 'active' : ''}" onclick="selectModelPath('ollama')">本地 Ollama</button>
            <button class="${modelSetupMode === 'cloud-api' ? 'active' : ''}" onclick="selectModelPath('cloud-api')">API Key</button>
        </div>

        <div class="model-setup-panel ${modelSetupMode === 'ollama' ? '' : 'hidden'}">
            <div class="model-field">
                <label>Ollama 地址</label>
                <input id="model-ollama-url" type="text" value="${modelAttr(CONFIG.ollamaUrl || 'http://localhost:11434')}" />
            </div>
            <div class="model-field">
                <label>模型名称</label>
                <select id="model-ollama-model">${ollamaOptions}</select>
                <input id="model-ollama-custom" type="text" placeholder="或者手动输入模型名" value="${availableOllamaModels.includes(ollamaModel) ? '' : modelAttr(ollamaModel)}" />
            </div>
            <div class="model-actions">
                <button onclick="testOllamaFromSelector()">测试 Ollama</button>
                <button class="primary" onclick="saveModelSelection()">应用本地模型</button>
            </div>
            <div class="model-selector-status"></div>
        </div>

        <div class="model-setup-panel ${modelSetupMode === 'cloud-api' ? '' : 'hidden'}">
            <div class="model-field">
                <label>API 提供商</label>
                <select id="model-cloud-provider" onchange="applyCloudProviderPreset()">
                    ${Object.keys(CLOUD_PROVIDER_PRESETS).map(p => `<option value="${p}" ${p === cloudProvider ? 'selected' : ''}>${p}</option>`).join('')}
                </select>
            </div>
            <div class="model-field">
                <label>API Key</label>
                <input id="model-cloud-key" type="password" placeholder="${cloudConfigStatus?.has_key ? '已保存，留空则继续使用原 Key' : '输入 API Key'}" />
            </div>
            <div class="model-field">
                <label>API 基础地址</label>
                <input id="model-cloud-base-url" type="text" value="${modelAttr(cloudBaseUrl)}" />
            </div>
            <div class="model-actions">
                <button onclick="testCloudFromSelector()">测试 API</button>
                <button class="primary" onclick="saveCloudConfigAndRefreshModels()">保存并刷新模型</button>
            </div>
            <div class="model-selector-status"></div>
            ${cloudModelsHtml}
            ${availableCloudModels.length > 0 ? `
            <div class="model-actions">
                <button class="primary" onclick="saveModelSelection()">应用选中的模型</button>
            </div>
            ` : ''}
        </div>
    `;

    if (infoEl) {
        infoEl.innerHTML = modelSetupMode === 'ollama'
            ? '<div class="model-info-title">本地 Ollama</div><div class="model-info-desc">适合离线、本地模型和图像识别。模型名必须是 Ollama 已安装模型。</div>'
            : '<div class="model-info-title">API Key</div><div class="model-info-desc">适合 OpenAI 兼容接口。API Key 只保存到本地后端配置，不暴露给聊天前端请求。</div>';
    }
}

function selectModelPath(mode) {
    modelSetupMode = mode;
    renderModelList();
}

function applyCloudProviderPreset() {
    const provider = document.getElementById('model-cloud-provider')?.value || 'openai';
    const preset = CLOUD_PROVIDER_PRESETS[provider] || CLOUD_PROVIDER_PRESETS.custom;
    const baseEl = document.getElementById('model-cloud-base-url');
    const modelEl = document.getElementById('model-cloud-model');
    if (baseEl && preset.baseUrl) baseEl.value = preset.baseUrl;
    if (modelEl && preset.model) modelEl.value = preset.model;
}

function setModelSelectorStatus(text, type = 'info') {
    document.querySelectorAll('.model-selector-status').forEach(el => {
        el.textContent = text;
        el.dataset.type = type;
    });
}

async function testOllamaFromSelector() {
    setModelSelectorStatus('正在检查 Ollama...', 'info');
    await loadOllamaModelList(true);
    if (availableOllamaModels.length > 0) {
        setModelSelectorStatus(`Ollama 可用，发现 ${availableOllamaModels.length} 个模型`, 'success');
        renderModelList();
    } else {
        setModelSelectorStatus('Ollama 未返回模型，可确认服务和模型是否已安装', 'error');
    }
}

async function testCloudFromSelector() {
    try {
        setModelSelectorStatus('正在测试 API...', 'info');
        const provider = document.getElementById('model-cloud-provider')?.value || 'openai';
        const apiKey = document.getElementById('model-cloud-key')?.value.trim() || '';
        const baseUrl = document.getElementById('model-cloud-base-url')?.value.trim();
        const modelName = document.getElementById('model-cloud-model')?.value.trim();
        const payload = { provider, base_url: baseUrl, model: modelName };
        if (apiKey) payload.api_key = apiKey;
        const resp = await fetch('/api/cloud/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) throw new Error(data.error || '测试失败');
        setModelSelectorStatus(`API 可用 (${data.latency_ms}ms)`, 'success');
    } catch (err) {
        setModelSelectorStatus(err.message, 'error');
        showNotification(err.message, 'error');
    }
}

function syncModelSettingsFields() {
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    };
    setValue('cfg-chat-type', CONFIG.chatType);
    setValue('cfg-ollama-url', CONFIG.ollamaUrl);
    setValue('cfg-ollama-model', CONFIG.ollamaModel);
    setValue('cfg-cloud-provider', CONFIG.cloudProvider);
    setValue('cfg-cloud-base-url', CONFIG.cloudBaseUrl);
    setValue('cfg-cloud-model', CONFIG.cloudModel);
    if (typeof updateChatConfigVisibility === 'function') updateChatConfigVisibility();
}

async function saveCloudConfigAndRefreshModels() {
    if (typeof CONFIG === 'undefined') return;

    try {
        const provider = document.getElementById('model-cloud-provider')?.value || 'openai';
        const apiKey = document.getElementById('model-cloud-key')?.value.trim() || '';
        const baseUrl = document.getElementById('model-cloud-base-url')?.value.trim();

        if (!baseUrl) throw new Error('请填写 API 基础地址');
        if (!apiKey && !cloudConfigStatus?.has_key) throw new Error('请填写 API Key');

        // 保存配置
        const payload = { enabled: true, provider, base_url: baseUrl };
        if (apiKey) payload.api_key = apiKey;
        const resp = await fetch('/api/cloud/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) throw new Error(data.error || '保存失败');

        cloudConfigStatus = data.config;
        CONFIG.cloudProvider = provider;
        CONFIG.cloudBaseUrl = baseUrl;
        CONFIG.cloudApiKey = '';

        // 获取模型列表
        cloudModelsLoading = true;
        availableCloudModels = [];
        renderModelList();
        setModelSelectorStatus('正在获取模型列表...', 'info');

        const modelsResp = await fetch('/api/cloud/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider, base_url: baseUrl })
        });
        const modelsData = await modelsResp.json();

        cloudModelsLoading = false;
        if (modelsData.success && modelsData.models) {
            availableCloudModels = modelsData.models;
            setModelSelectorStatus(`获取到 ${modelsData.total} 个模型`, 'success');
        } else {
            setModelSelectorStatus(modelsData.error || '获取模型列表失败', 'error');
        }
        renderModelList();
    } catch (err) {
        cloudModelsLoading = false;
        setModelSelectorStatus(err.message, 'error');
        showNotification(err.message, 'error');
        renderModelList();
    }
}

async function saveModelSelection() {
    if (typeof CONFIG === 'undefined') return;

    try {
        if (modelSetupMode === 'ollama') {
            const custom = document.getElementById('model-ollama-custom')?.value.trim();
            const selected = document.getElementById('model-ollama-model')?.value.trim();
            const modelName = custom || selected || 'qwen2.5:latest';
            CONFIG.chatType = 'ollama';
            CONFIG.ollamaUrl = document.getElementById('model-ollama-url')?.value.trim() || 'http://localhost:11434';
            CONFIG.ollamaModel = modelName;
            localStorage.setItem('murasame-model-mode', 'ollama');
            if (typeof saveConfig === 'function') saveConfig();
            syncModelSettingsFields();
            updateModelIndicator();
            renderModelList();
            showNotification(`已切换到 Ollama: ${modelName}`, 'success');
            return;
        }

        const provider = document.getElementById('model-cloud-provider')?.value || 'openai';
        const apiKey = document.getElementById('model-cloud-key')?.value.trim() || '';
        const baseUrl = document.getElementById('model-cloud-base-url')?.value.trim();
        // 优先从下拉列表获取选中的模型，如果没有则从输入框获取
        const modelSelect = document.getElementById('model-cloud-select');
        const modelName = modelSelect?.value || document.getElementById('model-cloud-model')?.value.trim() || '';
        if (!baseUrl || !modelName) throw new Error('请填写 API 基础地址并选择模型');
        if (!apiKey && !cloudConfigStatus?.has_key) throw new Error('请填写 API Key');

        const payload = { enabled: true, provider, base_url: baseUrl, model: modelName };
        if (apiKey) payload.api_key = apiKey;
        const resp = await fetch('/api/cloud/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) throw new Error(data.error || '保存失败');

        cloudConfigStatus = data.config;
        CONFIG.chatType = 'cloud-api';
        CONFIG.cloudProvider = provider;
        CONFIG.cloudBaseUrl = baseUrl;
        CONFIG.cloudModel = modelName;
        CONFIG.cloudApiKey = '';
        localStorage.setItem('murasame-model-mode', 'cloud-api');
        if (typeof saveConfig === 'function') saveConfig();
        syncModelSettingsFields();
        updateModelIndicator();
        renderModelList();
        showNotification(`已切换到 API: ${modelName}`, 'success');
    } catch (err) {
        setModelSelectorStatus(err.message, 'error');
        showNotification(err.message, 'error');
    }
}

// ===== 技能管理 =====
let activeSkill = null;

const SKILL_DEFINITIONS = {
    'calculator': {
        name: '计算器',
        icon: '🧮',
        description: '数学计算和单位转换',
        trigger: '/计算',
        handler: handleCalculator
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
    'web-search': {
        name: '搜索网址',
        icon: '🔍',
        description: '从互联网搜索信息',
        trigger: '/搜索',
        handler: handleWebSearch
    },
    'file-read': {
        name: '读取权限',
        icon: '📂',
        description: '读取服务器文件和目录',
        trigger: '/读取',
        handler: handleFileRead
    },
    'file-ops': {
        name: '操作文件',
        icon: '📝',
        description: '创建、写入和删除文件',
        trigger: '/文件',
        handler: handleFileOps
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
            'productivity': ['calculator', 'schedule', 'reminder'],
            'knowledge': ['memory'],
            'tools': ['web-search', 'file-read', 'file-ops']
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

// 计算器
function handleCalculator(expression) {
    try {
        // 只允许数字和基本运算符，正则过滤防止注入
        const safeExpr = expression.replace(/[^0-9+\-*/().%\s]/g, '');
        const result = Function(`"use strict"; return (${safeExpr})`)();
        if (typeof result === 'number' && isFinite(result)) {
            return `计算结果：${expression} = ${result}`;
        }
        return '计算表达式无效';
    } catch (e) {
        return '计算表达式无效';
    }
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

// ===== 技能：搜索网址 =====
async function handleWebSearch(query) {
    if (!query || query.trim().length === 0) {
        return '请提供搜索关键词，例如：/搜索 今天天气';
    }
    try {
        const res = await fetchWithRetry('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query.trim(), max_results: 5 })
        }, 30000, 2);
        const data = await res.json();
        if (!data.success || !data.results || data.results.length === 0) {
            return '没有找到相关结果呢～';
        }
        let text = `🔍 搜索 "${query}" 的结果：\n\n`;
        data.results.forEach((r, i) => {
            text += `${i + 1}. ${r.title}\n`;
            text += `   ${r.snippet}\n`;
            if (r.url) text += `   ${r.url}\n`;
            text += '\n';
        });
        return text;
    } catch (e) {
        return '😢 搜索失败: ' + e.message;
    }
}

// ===== 技能：读取权限 =====
async function handleFileRead(args) {
    if (!args || args.trim().length === 0) {
        return '用法：/读取 list [目录] 或 /读取 read <文件路径>\n示例：/读取 list .\n示例：/读取 read config.json';
    }
    const parts = args.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const filePath = parts.slice(1).join(' ') || '.';

    try {
        if (command === 'list') {
            const res = await fetchWithRetry('/api/files/list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dir: filePath })
            }, 15000, 2);
            const data = await res.json();
            if (!data.success) return '列出目录失败: ' + (data.error || '未知错误');
            if (data.entries.length === 0) return '目录为空';

            let text = `📂 目录 "` + filePath + `" 的内容：\n\n`;
            data.entries.forEach(e => {
                const icon = e.type === 'dir' ? '📁' : '📄';
                const size = e.type === 'file' ? ` (${formatSize(e.size)})` : '';
                text += `${icon} ${e.name}${size}\n`;
            });
            text += `\n共 ${data.count} 项`;
            return text;
        } else if (command === 'read') {
            const res = await fetchWithRetry('/api/files/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file: filePath })
            }, 15000, 2);
            const data = await res.json();
            if (!data.success) return '读取文件失败: ' + (data.error || '未知错误');
            return `📄 ${data.name} (${formatSize(data.size)}):\n\n${data.content}`;
        } else {
            return '未知命令，可用：list 或 read';
        }
    } catch (e) {
        return '😢 文件操作失败: ' + e.message;
    }
}

// ===== 技能：操作文件 =====
async function handleFileOps(args) {
    if (!args || args.trim().length === 0) {
        return '用法：/文件 write <路径> <内容> 或 /文件 delete <路径>\n示例：/文件 write test.txt hello world\n示例：/文件 delete test.txt';
    }
    const parts = args.trim().split(/\s+/);
    const command = parts[0].toLowerCase();

    try {
        if (command === 'write') {
            const filePath = parts[1];
            if (!filePath) return '请提供文件路径';
            const content = parts.slice(2).join(' ');
            if (!content) return '请提供文件内容';

            const res = await fetchWithRetry('/api/files/write', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file: filePath, content })
            }, 15000, 2);
            const data = await res.json();
            if (!data.success) return '写入文件失败: ' + (data.error || '未知错误');
            return `✅ 文件已写入: ${data.path} (${formatSize(data.size)})`;
        } else if (command === 'delete') {
            const filePath = parts.slice(1).join(' ');
            if (!filePath) return '请提供文件路径';

            const res = await fetchWithRetry('/api/files/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file: filePath })
            }, 15000, 2);
            const data = await res.json();
            if (!data.success) return '删除文件失败: ' + (data.error || '未知错误');
            return `🗑️ 文件已删除: ${data.path}`;
        } else {
            return '未知命令，可用：write 或 delete';
        }
    } catch (e) {
        return '😢 文件操作失败: ' + e.message;
    }
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
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
