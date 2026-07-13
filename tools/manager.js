/**
 * 工具管理器 - 管理所有可用工具
 * 使用 cmd/curl 避免 PowerShell 编码问题
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PROXY = process.env.HTTP_PROXY_HOST ? `http://${process.env.HTTP_PROXY_HOST}:${process.env.HTTP_PROXY_PORT}` : 'http://127.0.0.1:7897';

function sanitizeUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.href;
  } catch { return null; }
}

// 异步执行命令（使用 cmd.exe 避免 PowerShell 编码问题）
function execCmd(cmd, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'buffer', timeout: timeoutMs, windowsHide: true, shell: 'cmd.exe', maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err && !stdout) return reject(err);
      const buf = Buffer.from(stdout || '');
      resolve(buf.toString('utf8'));
    });
  });
}

function createToolManager(appRoot) {
  const tools = new Map();

  // ===== 文件读取 =====
  tools.set('read_file', {
    name: 'read_file',
    description: '读取本地文件内容',
    async execute(input) {
      const { file_path } = input;
      if (!file_path || typeof file_path !== 'string') return { success: false, error: '缺少 file_path 参数' };
      try {
        let fullPath = file_path;
        if (!path.isAbsolute(file_path)) fullPath = path.join(appRoot, file_path);
        const resolved = path.resolve(fullPath);
        if (!resolved.startsWith(path.resolve(appRoot))) return { success: false, error: '访问被拒绝' };
        if (!fs.existsSync(fullPath)) return { success: false, error: `文件不存在: ${file_path}` };
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) return { success: false, error: `不是文件: ${file_path}` };
        if (stat.size > 1024 * 1024) return { success: false, error: '文件太大(>1MB)' };
        return { success: true, content: fs.readFileSync(fullPath, 'utf8'), file_path, size: stat.size };
      } catch (e) { return { success: false, error: e.message }; }
    }
  });

  // ===== 文件写入 =====
  tools.set('write_file', {
    name: 'write_file',
    description: '写入或修改本地文件内容。可以创建新文件或覆盖已有文件',
    async execute(input) {
      const { file_path, content, append = false } = input;
      if (!file_path || typeof file_path !== 'string') return { success: false, error: '缺少 file_path 参数' };
      if (content === undefined || content === null) return { success: false, error: '缺少 content 参数' };
      try {
        let fullPath = file_path;
        if (!path.isAbsolute(file_path)) fullPath = path.join(appRoot, file_path);
        const resolved = path.resolve(fullPath);
        if (!resolved.startsWith(path.resolve(appRoot))) return { success: false, error: '访问被拒绝' };
        // 禁止修改配置文件
        const forbidden = ['config.json', '.env', '.git/config'];
        if (forbidden.some(f => resolved.endsWith(f))) return { success: false, error: '不允许修改配置文件' };
        if (append) {
          fs.appendFileSync(fullPath, content, 'utf8');
        } else {
          fs.writeFileSync(fullPath, content, 'utf8');
        }
        const stat = fs.statSync(fullPath);
        return { success: true, file_path, size: stat.size, action: append ? '追加' : '写入' };
      } catch (e) { return { success: false, error: e.message }; }
    }
  });

  // ===== 文件列表 =====
  tools.set('list_files', {
    name: 'list_files',
    description: '列出指定目录中的文件和文件夹',
    async execute(input) {
      const { dir_path = '.' } = input;
      try {
        let fullPath = dir_path;
        if (!path.isAbsolute(dir_path)) fullPath = path.join(appRoot, dir_path);
        const resolved = path.resolve(fullPath);
        if (!resolved.startsWith(path.resolve(appRoot))) return { success: false, error: '访问被拒绝' };
        if (!fs.existsSync(fullPath)) return { success: false, error: `目录不存在: ${dir_path}` };
        const stat = fs.statSync(fullPath);
        if (!stat.isDirectory()) return { success: false, error: `不是目录: ${dir_path}` };
        const entries = fs.readdirSync(fullPath, { withFileTypes: true }).map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'dir' : 'file',
          size: e.isFile() ? fs.statSync(path.join(fullPath, e.name)).size : 0
        }));
        return { success: true, dir_path, entries, total: entries.length };
      } catch (e) { return { success: false, error: e.message }; }
    }
  });

  // ===== 获取日期时间 =====
  tools.set('get_datetime', {
    name: 'get_datetime',
    description: '获取当前的日期、时间、星期几',
    async execute() {
      const now = new Date();
      const options = { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' };
      const formatted = now.toLocaleString('zh-CN', options);
      return {
        success: true,
        datetime: formatted,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        day: now.getDate(),
        weekday: ['日', '一', '二', '三', '四', '五', '六'][now.getDay()],
        hour: now.getHours(),
        minute: now.getMinutes()
      };
    }
  });

  // ===== 天气查询 =====
  tools.set('get_weather', {
    name: 'get_weather',
    description: '查询指定城市的天气预报，包括温度、天气状况、湿度、风力等',
    async execute(input) {
      const { city } = input;
      if (!city || typeof city !== 'string') return { success: false, error: '缺少 city 参数，请指定城市名称' };
      const safeCity = city.replace(/["`$|&;]/g, ' ').trim();
      if (!safeCity) return { success: false, error: '无效的城市名' };

      try {
        // 使用 wttr.in 免费天气 API（中文输出，纯文本格式）
        const url = `https://wttr.in/${encodeURIComponent(safeCity)}?format=j1&lang=zh`;
        const cmd = `curl -s -x ${PROXY} -A "Mozilla/5.0" --max-time 10 "${url}"`;
        const json = await execCmd(cmd, 15000);
        const data = JSON.parse(json);

        if (!data.current_condition || data.current_condition.length === 0) {
          return { success: false, error: '无法获取天气数据' };
        }

        const current = data.current_condition[0];
        const area = data.nearest_area?.[0];
        const today = data.weather?.[0];
        const tomorrow = data.weather?.[1];

        const result = {
          success: true,
          city: area?.areaName?.[0]?.value || safeCity,
          region: area?.region?.[0]?.value || '',
          country: area?.country?.[0]?.value || '',
          current: {
            temp_c: current.temp_C,
            temp_f: current.temp_F,
            feels_like_c: current.FeelsLikeC,
            humidity: current.humidity,
            description: current.lang_zh?.[0]?.value || current.weatherDesc?.[0]?.value || '未知',
            wind_speed_kmph: current.windspeedKmph,
            wind_dir: current.winddir16Point,
            visibility: current.visibility
          },
          today: today ? {
            max_temp: today.maxtempC,
            min_temp: today.mintempC,
            avg_temp: today.avgtempC,
            description: today.hourly?.[4]?.lang_zh?.[0]?.value || today.hourly?.[4]?.weatherDesc?.[0]?.value || ''
          } : null,
          tomorrow: tomorrow ? {
            max_temp: tomorrow.maxtempC,
            min_temp: tomorrow.mintempC,
            description: tomorrow.hourly?.[4]?.lang_zh?.[0]?.value || tomorrow.hourly?.[4]?.weatherDesc?.[0]?.value || ''
          } : null
        };

        // 生成可读的文本摘要
        let summary = `${result.city}当前天气：${result.current.description}，温度${result.current.temp_c}°C（体感${result.current.feels_like_c}°C），湿度${result.current.humidity}%，风速${result.current.wind_speed_kmph}km/h`;
        if (today) {
          summary += `。今日最高${today.maxtempC}°C，最低${today.mintempC}°C`;
        }
        if (tomorrow) {
          summary += `。明日预计${result.tomorrow.description}，${tomorrow.mintempC}~${tomorrow.maxtempC}°C`;
        }
        result.summary = summary;

        return result;
      } catch (e) { return { success: false, error: `天气查询失败: ${e.message}` }; }
    }
  });

  // ===== 网络搜索 =====
  tools.set('web_search', {
    name: 'web_search',
    description: '从互联网搜索信息，可以搜索新闻、知识、问题答案等',
    async execute(input) {
      const { query, max_results = 5 } = input;
      if (!query || typeof query !== 'string') return { success: false, error: '缺少 query 参数' };
      const safeQuery = query.replace(/["`$|]/g, ' ').trim();
      if (!safeQuery) return { success: false, error: '无效的搜索词' };

      try {
        // 使用 DuckDuckGo Instant Answer API（无需反爬，返回 JSON）
        const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(safeQuery)}&format=json&no_html=1&skip_disambig=1`;
        const cmd = `curl -s -x ${PROXY} --max-time 15 "${searchUrl}"`;
        const json = await execCmd(cmd, 25000);
        const data = JSON.parse(json);

        const results = [];

        // 主要结果
        if (data.AbstractText) {
          results.push({
            title: data.Heading || safeQuery,
            snippet: data.AbstractText.substring(0, 500),
            url: data.AbstractURL || ''
          });
        }

        // 相关话题
        if (data.RelatedTopics) {
          for (const topic of data.RelatedTopics) {
            if (results.length >= max_results) break;
            if (topic.Text && topic.FirstURL) {
              results.push({
                title: topic.Text.substring(0, 100),
                snippet: topic.Text,
                url: topic.FirstURL
              });
            }
          }
        }

        // 如果 DuckDuckGo API 没有结果，用 Wikipedia API 补充
        if (results.length === 0) {
          const wikiUrl = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(safeQuery)}&format=json&srlimit=${max_results}`;
          const wikiCmd = `curl -s -x ${PROXY} --max-time 15 "${wikiUrl}"`;
          const wikiJson = await execCmd(wikiCmd, 20000);
          const wikiData = JSON.parse(wikiJson);
          if (wikiData.query && wikiData.query.search) {
            for (const item of wikiData.query.search) {
              results.push({
                title: item.title,
                snippet: (item.snippet || '').replace(/<[^>]*>/g, '').trim(),
                url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(item.title)}`
              });
            }
          }
        }
        return { success: true, query: safeQuery, results, total: results.length };
      } catch (e) { return { success: false, error: e.message }; }
    }
  });

  // ===== 网页获取 =====
  tools.set('web_fetch', {
    name: 'web_fetch',
    description: '获取指定URL的网页内容',
    async execute(input) {
      const { url, max_length = 5000 } = input;
      const safeUrl = sanitizeUrl(url);
      if (!safeUrl) return { success: false, error: '无效的 URL' };
      try {
        const cmd = `curl -s -L -x ${PROXY} -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" --max-time 15 "${safeUrl}"`;
        let text = await execCmd(cmd, 25000);
        text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ').trim();
        return { success: true, url: safeUrl, content: text.substring(0, max_length) };
      } catch (e) { return { success: false, error: e.message }; }
    }
  });

  function get(name) { return tools.get(name); }
  function getAll() { return Array.from(tools.values()); }
  function getToolList() { return getAll().map(t => ({ name: t.name, description: t.description })); }
  async function execute(toolName, input) {
    const tool = tools.get(toolName);
    if (!tool) return { success: false, error: `工具不存在: ${toolName}` };
    return await tool.execute(input || {});
  }

  return { get, getAll, getToolList, execute };
}

module.exports = { createToolManager };
