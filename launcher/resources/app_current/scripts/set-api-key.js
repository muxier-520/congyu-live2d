/**
 * 设置 Cloud API Key 到服务器配置
 * 用法: node set-api-key.js <your-api-key> [provider] [base_url] [model]
 * 示例: node set-api-key.js sk-xxxxx deepseek https://api.deepseek.com deepseek-chat
 */
const path = require('path');
const cfgPath = path.resolve(__dirname, '..', 'config.json');
const fs = require('fs');

const [, , apiKey, provider = 'deepseek', baseUrl = 'https://api.deepseek.com', model = 'deepseek-chat'] = process.argv;

if (!apiKey || apiKey === '--help') {
  console.log('用法: node set-api-key.js <api-key> [provider] [base_url] [model]');
  console.log('示例: node set-api-key.js sk-xxxxx deepseek https://api.deepseek.com deepseek-chat');
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
cfg.cloud_api = cfg.cloud_api || {};
cfg.cloud_api.api_key = apiKey;
cfg.cloud_api.provider = provider;
cfg.cloud_api.base_url = baseUrl;
cfg.cloud_api.model = model;
cfg.cloud_api.enabled = true;

fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
console.log('✅ API Key 已写入 config.json');
console.log('   provider:', provider);
console.log('   base_url:', baseUrl);
console.log('   model:', model);
console.log('   key:', apiKey.substring(0, 8) + '...');
console.log('');
console.log('请重启服务器 (Ctrl+C 重启) 或访问 /api/config-reload 热重载');
