/**
 * Agent 服务 - 工具调用核心逻辑
 */
'use strict';
const { createToolManager } = require('../tools/manager');

function createAgent(config, state, { log, utils }) {
  const { httpReq } = utils;
  const toolManager = createToolManager(require('path').join(__dirname, '..'));

  function buildSystemPrompt() {
    const toolDesc = toolManager.getToolList().map(t => `- ${t.name}: ${t.description}`).join('\n');
    return `你是丛雨(Murasame)，一个温柔可爱的日式女仆AI助手。

【角色设定】
1. 用温柔可爱的语气说中文，简短自然
2. 回答简洁，不超过3句话
3. 语气温柔，常用"呀""呢""～"等可爱语气词

【工具使用】
你可以使用以下工具来帮助用户：
${toolDesc}

当你需要以下情况时，必须调用工具：
- 用户问天气、温度、气候 → 调用 get_weather
- 用户问日期、时间、星期几 → 调用 get_datetime
- 用户要你搜索、查找信息 → 调用 web_search
- 用户要你读取文件 → 调用 read_file
- 用户要你打开网页 → 调用 web_fetch
- 任何你不确定的事实性问题 → 调用 web_search

不需要调用工具的情况：
- 闲聊、打招呼、情感交流
- 你已经知道的常识性问题
- 用户只是在表达感受

工具调用格式：[TOOL_CALL: 工具名][TOOL_INPUT: {"参数": "值"}]

重要规则：
1. 一次只调用一个工具
2. 收到工具结果后，直接根据结果回答，绝对不要在回复中包含工具调用格式
3. 不要编造数据，只使用工具返回的真实数据
4. 如果工具失败，诚实告诉用户`;
  }

  function parseToolCalls(text) {
    const calls = [];
    const re = /\[TOOL_CALL:\s*(\w+)\]\s*\[TOOL_INPUT:\s*(\{[^]*?\})\]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      try { 
        calls.push({ name: m[1], input: JSON.parse(m[2]) }); 
      } catch (e) { 
        log('WARN', `parseToolCalls JSON parse failed for ${m[1]}: ${e.message}`); 
      }
    }
    return calls;
  }

  async function callAI(messages) {
    const chatType = config.chatType || 'cloud-api';
    if (chatType === 'cloud-api' && config.cloud_api?.api_key) {
      const u = new URL(config.cloud_api.base_url || 'https://api.openai.com/v1');
      const body = JSON.stringify({ model: config.cloud_api.model || 'gpt-4o-mini', messages, temperature: 0.7, max_tokens: 2048 });
      const resp = await httpReq({ protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: '/chat/completions', method: 'POST', timeout: 60000, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.cloud_api.api_key}` } }, body);
      if (resp.status >= 200 && resp.status < 300) return JSON.parse(resp.body.toString()).choices[0].message.content;
      throw new Error(`API Error: ${resp.status}`);
    }
    if (chatType === 'ollama') {
      const body = JSON.stringify({ model: config.ollama?.model || 'qwen2.5:latest', messages, stream: false });
      const resp = await httpReq({ hostname: '127.0.0.1', port: config.ollama?.port || 11434, path: '/v1/chat/completions', method: 'POST', timeout: 120000, headers: { 'Content-Type': 'application/json' } }, body);
      if (resp.status >= 200 && resp.status < 300) return JSON.parse(resp.body.toString()).choices[0].message.content;
      throw new Error(`Ollama Error: ${resp.status}`);
    }
    throw new Error('未配置AI服务');
  }

  async function processMessage(userMessage, history = []) {
    const messages = [
      { role: 'system', content: buildSystemPrompt() },
      ...history.slice(-10),
      { role: 'user', content: userMessage }
    ];
    const aiResponse = await callAI(messages);
    const toolCalls = parseToolCalls(aiResponse);
    if (toolCalls.length === 0) return { success: true, response: aiResponse, toolCalls: [], usedTools: false };

    const toolResults = [];
    for (const call of toolCalls) {
      const result = await toolManager.execute(call.name, call.input);
      toolResults.push({ tool: call.name, input: call.input, result });
    }

    let toolMsg = '以下是工具返回的真实数据，请直接根据这些数据回答用户，不要编造信息，不要再调用工具：\n\n';
    for (const r of toolResults) {
      toolMsg += `【${r.tool}】\n`;
      if (r.result.success) {
        if (r.result.content) {
          toolMsg += `${r.result.content.substring(0, 3000)}\n`;
        } else if (r.result.results && r.result.results.length > 0) {
          for (const item of r.result.results) {
            toolMsg += `标题：${item.title}\n`;
            if (item.snippet) toolMsg += `摘要：${item.snippet}\n`;
            if (item.url) toolMsg += `链接：${item.url}\n`;
            toolMsg += '\n';
          }
        } else if (r.result.datetime) {
          toolMsg += `当前时间：${r.result.datetime}\n`;
          toolMsg += `日期：${r.result.year}年${r.result.month}月${r.result.day}日 星期${r.result.weekday}\n`;
          toolMsg += `时间：${r.result.hour}时${r.result.minute}分\n`;
        } else if (r.result.summary) {
          toolMsg += `${r.result.summary}\n`;
        } else {
          // 通用处理：把所有非 success 的字段都输出
          const fields = Object.entries(r.result).filter(([k]) => k !== 'success');
          if (fields.length > 0) {
            toolMsg += fields.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';
          } else {
            toolMsg += '成功但无返回内容\n';
          }
        }
      } else {
        toolMsg += `失败：${r.result.error}\n`;
      }
    }
    toolMsg += '\n请根据以上真实数据回答用户。不要编造数据，不要再次调用工具。';

    const finalMessages = [...messages, { role: 'assistant', content: aiResponse }, { role: 'user', content: toolMsg }];
    const finalResponse = await callAI(finalMessages);
    // 清除残留的工具调用格式
    const cleanResponse = finalResponse.replace(/\[TOOL_CALL:\s*\w+\]\s*\[TOOL_INPUT:\s*\{[^]*?\}\]/g, '').trim();
    return { success: true, response: cleanResponse, toolCalls, toolResults, usedTools: true };
  }

  return { processMessage, getToolList: () => toolManager.getToolList(), execute: (t, i) => toolManager.execute(t, i) };
}

module.exports = { createAgent };
