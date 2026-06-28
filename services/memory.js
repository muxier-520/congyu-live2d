/**
 * 智能记忆系统 - Markdown 版本
 * 自动从对话中提取重要信息，存储到 memory.md
 */
'use strict';

const fs = require('fs');
const path = require('path');

function createMemoryService(config, state, { log, utils }) {
  const MEMORY_FILE = path.join(__dirname, '..', 'memory.md');

  function readMemoryFile() {
    try {
      if (fs.existsSync(MEMORY_FILE)) return fs.readFileSync(MEMORY_FILE, 'utf8');
    } catch (e) { log('ERROR', 'Read memory failed:', e.message); }
    return getDefaultContent();
  }

  function getDefaultContent() {
    return `# 丛雨的记忆库

## 👤 个人信息

## 💚 你的喜好

## 📚 重要事实

## 🎯 你的目标

## 👥 你提到的人

## 📅 最近的事件
`;
  }

  function writeMemoryFile(content) {
    try { fs.writeFileSync(MEMORY_FILE, content, 'utf8'); } catch (e) { log('ERROR', 'Write memory failed:', e.message); }
  }

  function appendToSection(category, text) {
    const content = readMemoryFile();
    const lines = content.split('\n');
    let targetIdx = -1;
    let nextSectionIdx = lines.length;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === `## ${category}`) targetIdx = i;
      else if (targetIdx >= 0 && lines[i].startsWith('## ') && i > targetIdx) { nextSectionIdx = i; break; }
    }
    if (targetIdx === -1) {
      lines.push(`\n## ${category}\n- ${text}`);
    } else {
      let insertIdx = targetIdx + 1;
      for (let i = targetIdx + 1; i < nextSectionIdx; i++) {
        if (lines[i].trim() !== '' && !lines[i].startsWith('<!--')) insertIdx = i + 1;
      }
      lines.splice(insertIdx, 0, `- ${text}`);
    }
    writeMemoryFile(lines.join('\n'));
  }

  const PATTERNS = {
    '👤 个人信息': [
      { p: /我叫(.{1,20}?)(?:[，。！\n]|$)/g, t: m => `名字：${m[1]}` },
      { p: /我是(.{1,30}?)(?:[，。！\n]|$)/g, t: m => `身份：${m[1]}` },
      { p: /我今年(\d+)岁/g, t: m => `年龄：${m[1]}岁` },
      { p: /我在(.{1,30}?)(?:[，。！\n工作学习]|$)/g, t: m => `所在地：${m[1]}` },
      { p: /我的生日是(.{1,20}?)(?:[，。！\n]|$)/g, t: m => `生日：${m[1]}` }
    ],
    '💚 你的喜好': [
      { p: /我喜欢(.{1,30}?)(?:[，。！\n]|$)/g, t: m => `喜欢：${m[1]}` },
      { p: /我讨厌(.{1,30}?)(?:[，。！\n]|$)/g, t: m => `不喜欢：${m[1]}` },
      { p: /我不喜欢(.{1,30}?)(?:[，。！\n]|$)/g, t: m => `不喜欢：${m[1]}` }
    ],
    '📚 重要事实': [
      { p: /我知道(.{1,50}?)(?:[，。！\n]|$)/g, t: m => `知道：${m[1]}` }
    ],
    '🎯 你的目标': [
      { p: /我想(.{1,30}?)(?:[，。！\n]|$)/g, t: m => `想：${m[1]}` },
      { p: /我要(.{1,30}?)(?:[，。！\n]|$)/g, t: m => `要：${m[1]}` },
      { p: /我打算(.{1,30}?)(?:[，。！\n]|$)/g, t: m => `计划：${m[1]}` }
    ],
    '👥 你提到的人': [
      { p: /我(爸爸|妈妈|老婆|老公|朋友|同事|同学)(?:叫|是)(.{1,20}?)(?:[，。！\n]|$)/g, t: m => `${m[1]}：${m[2]}` }
    ],
    '📅 最近的事件': [
      { p: /我昨天(.{1,50}?)(?:[，。！\n]|$)/g, t: m => `昨天：${m[1]}` },
      { p: /我今天(.{1,50}?)(?:[，。！\n]|$)/g, t: m => `今天：${m[1]}` },
      { p: /我刚(.{1,30}?)(?:[，。！\n]|$)/g, t: m => `刚刚：${m[1]}` },
      { p: /我去了(.{1,50}?)(?:[，。！\n]|$)/g, t: m => `去了：${m[1]}` }
    ]
  };

  function extractMemoriesFromMessage(msg) {
    const extracted = [];
    const content = readMemoryFile();
    for (const [category, patterns] of Object.entries(PATTERNS)) {
      for (const { p, t } of patterns) {
        p.lastIndex = 0;
        let m;
        while ((m = p.exec(msg)) !== null) {
          const text = t(m);
          if (!content.includes(text)) {
            appendToSection(category, text);
            extracted.push({ category, text });
            log('INFO', `Memory: ${category} - ${text}`);
          }
        }
      }
    }
    return extracted;
  }

  function generateMemoryContext() {
    const content = readMemoryFile();
    const lines = content.split('\n').filter(l =>
      l.trim() && !l.startsWith('#') && !l.startsWith('>') && !l.startsWith('---') && !l.startsWith('<!--') && !l.startsWith('*')
    );
    if (lines.length === 0) return '';
    let ctx = lines.join('\n');
    if (ctx.length > 500) ctx = ctx.substring(0, 500) + '...';
    return `\n[关于用户的记忆]\n${ctx}\n[请自然地使用这些信息]\n`;
  }

  function addMemory(category, text) {
    appendToSection(category || '📚 重要事实', text);
    return { success: true };
  }

  function getMemoryContent() { return readMemoryFile(); }

  function getMemoryStats() {
    const content = readMemoryFile();
    const lines = content.split('\n');
    let total = 0;
    for (const line of lines) {
      if (line.startsWith('- ') && line.trim().length > 2) total++;
    }
    return { total };
  }

  log('INFO', 'Memory service initialized');
  return { extractMemoriesFromMessage, generateMemoryContext, addMemory, getMemoryContent, getMemoryStats };
}

module.exports = { createMemoryService };
