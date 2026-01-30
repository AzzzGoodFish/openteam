/**
 * Memory system v2
 *
 * Supports three memory types:
 * - resident: Always in context, with size limit
 * - index: Index in context, details on demand
 * - sessions: Session history as index
 */

import fs from 'fs';
import path from 'path';
import { getTeamDir, loadAgentConfig } from '../team/config.js';
import { DEFAULTS, MEMORY_TYPES, EXTENSIONS } from '../constants.js';

/**
 * Get agent memory directory
 */
export function getAgentMemoryDir(teamName, agentName) {
  return path.join(getTeamDir(teamName), agentName, 'memories');
}

/**
 * Get memory file path
 */
function getMemoryPath(teamName, agentName, memoryName) {
  return path.join(getAgentMemoryDir(teamName, agentName), `${memoryName}${EXTENSIONS.MEMORY_BLOCK}`);
}

/**
 * Get note directory path (for index type)
 */
function getNoteDir(teamName, agentName, indexName) {
  return path.join(getAgentMemoryDir(teamName, agentName), indexName);
}

/**
 * Get note file path
 */
function getNotePath(teamName, agentName, indexName, key) {
  return path.join(getNoteDir(teamName, agentName, indexName), `${key}${EXTENSIONS.MEMORY_BLOCK}`);
}

/**
 * Load memory configuration for an agent
 * Supports both old (blocks) and new (memories) format
 */
export function loadMemoryConfig(teamName, agentName) {
  const config = loadAgentConfig(teamName, agentName);
  if (!config) return [];

  // New format
  if (config.memories) {
    return config.memories;
  }

  // Old format (blocks) - convert to new format
  if (config.blocks) {
    return config.blocks.map((block) => ({
      name: block.label,
      type: MEMORY_TYPES.RESIDENT,
      limit: DEFAULTS.MEMORY_LIMIT,
      readonly: block.readonly || false,
      _legacyFile: block.file,
    }));
  }

  return [];
}

/**
 * Get memory config by name
 */
export function getMemoryByName(teamName, agentName, memoryName) {
  const memories = loadMemoryConfig(teamName, agentName);
  return memories.find((m) => m.name === memoryName);
}

/**
 * Read memory content
 */
export function readMemory(teamName, agentName, memoryName) {
  const config = getMemoryByName(teamName, agentName, memoryName);
  if (!config) return null;

  // Handle legacy file path
  let memPath;
  if (config._legacyFile) {
    memPath = path.join(getTeamDir(teamName), agentName, config._legacyFile);
  } else {
    memPath = getMemoryPath(teamName, agentName, memoryName);
  }

  if (!fs.existsSync(memPath)) return '';

  return fs.readFileSync(memPath, 'utf8').trim();
}

/**
 * Write memory content (overwrite)
 */
export function writeMemory(teamName, agentName, memoryName, content) {
  const config = getMemoryByName(teamName, agentName, memoryName);
  if (!config) {
    return { success: false, error: `记忆 "${memoryName}" 不存在` };
  }
  if (config.readonly) {
    return { success: false, error: `记忆 "${memoryName}" 是只读的` };
  }

  // Check limit
  const limit = config.limit || DEFAULTS.MEMORY_LIMIT;
  if (content.length > limit) {
    return { success: false, error: `内容超出限制 (${content.length}/${limit})，请先整理` };
  }

  const memDir = getAgentMemoryDir(teamName, agentName);
  if (!fs.existsSync(memDir)) {
    fs.mkdirSync(memDir, { recursive: true });
  }

  const memPath = getMemoryPath(teamName, agentName, memoryName);
  fs.writeFileSync(memPath, content);

  return { success: true };
}

/**
 * Append to memory
 */
export function appendMemory(teamName, agentName, memoryName, content) {
  const existing = readMemory(teamName, agentName, memoryName);
  if (existing === null) {
    return { success: false, error: `记忆 "${memoryName}" 不存在` };
  }

  const newContent = existing ? `${existing}\n\n${content}` : content;
  return writeMemory(teamName, agentName, memoryName, newContent);
}

/**
 * Replace part of memory content
 */
export function replaceInMemory(teamName, agentName, memoryName, oldText, newText) {
  const config = getMemoryByName(teamName, agentName, memoryName);
  if (!config) {
    return { success: false, error: `记忆 "${memoryName}" 不存在` };
  }
  if (config.readonly) {
    return { success: false, error: `记忆 "${memoryName}" 是只读的` };
  }

  const content = readMemory(teamName, agentName, memoryName);
  if (!content.includes(oldText)) {
    return { success: false, error: '找不到要替换的内容' };
  }

  const newContent = content.replace(oldText, newText);
  return writeMemory(teamName, agentName, memoryName, newContent);
}

// ========== Index (Note) Operations ==========

/**
 * Parse index content into entries and notes
 */
function parseIndex(content) {
  const separator = DEFAULTS.INDEX_SEPARATOR;
  const parts = content.split(separator);

  const entriesText = parts[0].trim();
  const notesText = parts.length > 1 ? parts.slice(1).join(separator).trim() : '';

  const entries = {};
  for (const line of entriesText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      const summary = trimmed.slice(colonIdx + 1).trim();
      entries[key] = summary;
    }
  }

  return { entries, notes: notesText };
}

/**
 * Format index content from entries and notes
 */
function formatIndex(entries, notes) {
  const lines = Object.entries(entries).map(([key, summary]) => `${key}: ${summary}`);
  let content = lines.join('\n');

  if (notes) {
    content += `\n${DEFAULTS.INDEX_SEPARATOR}\n${notes}`;
  }

  return content;
}

/**
 * Update index entry
 */
function updateIndexEntry(teamName, agentName, indexName, key, summary) {
  const content = readMemory(teamName, agentName, indexName) || '';
  const { entries, notes } = parseIndex(content);

  entries[key] = summary;

  const newContent = formatIndex(entries, notes);
  return writeMemory(teamName, agentName, indexName, newContent);
}

/**
 * Remove index entry
 */
function removeIndexEntry(teamName, agentName, indexName, key) {
  const content = readMemory(teamName, agentName, indexName) || '';
  const { entries, notes } = parseIndex(content);

  if (!entries[key]) {
    return { success: false, error: `索引中没有 "${key}"` };
  }

  delete entries[key];

  const newContent = formatIndex(entries, notes);
  return writeMemory(teamName, agentName, indexName, newContent);
}

/**
 * Save a note (create or update)
 */
export function saveNote(teamName, agentName, indexName, key, content, summary) {
  const config = getMemoryByName(teamName, agentName, indexName);
  if (!config) {
    return { success: false, error: `笔记本 "${indexName}" 不存在` };
  }
  if (config.type !== MEMORY_TYPES.INDEX) {
    return { success: false, error: `"${indexName}" 不是笔记本类型` };
  }

  // Create note directory if needed
  const noteDir = getNoteDir(teamName, agentName, indexName);
  if (!fs.existsSync(noteDir)) {
    fs.mkdirSync(noteDir, { recursive: true });
  }

  // Save note content
  const notePath = getNotePath(teamName, agentName, indexName, key);
  fs.writeFileSync(notePath, content);

  // Update index
  const autoSummary = summary || content.slice(0, 50).replace(/\n/g, ' ') + (content.length > 50 ? '...' : '');
  const result = updateIndexEntry(teamName, agentName, indexName, key, autoSummary);

  if (!result.success) {
    return result;
  }

  return { success: true };
}

/**
 * Read a note
 */
export function readNote(teamName, agentName, indexName, key) {
  const config = getMemoryByName(teamName, agentName, indexName);
  if (!config) {
    return { success: false, error: `笔记本 "${indexName}" 不存在` };
  }

  const notePath = getNotePath(teamName, agentName, indexName, key);
  if (!fs.existsSync(notePath)) {
    return { success: false, error: `笔记 "${key}" 不存在` };
  }

  const content = fs.readFileSync(notePath, 'utf8');
  return { success: true, content };
}

/**
 * Delete a note
 */
export function deleteNote(teamName, agentName, indexName, key) {
  const config = getMemoryByName(teamName, agentName, indexName);
  if (!config) {
    return { success: false, error: `笔记本 "${indexName}" 不存在` };
  }

  const notePath = getNotePath(teamName, agentName, indexName, key);
  if (fs.existsSync(notePath)) {
    fs.unlinkSync(notePath);
  }

  return removeIndexEntry(teamName, agentName, indexName, key);
}

/**
 * Search notes in an index
 */
export function searchNotes(teamName, agentName, indexName, query) {
  const config = getMemoryByName(teamName, agentName, indexName);
  if (!config) {
    return { success: false, error: `笔记本 "${indexName}" 不存在` };
  }

  const content = readMemory(teamName, agentName, indexName) || '';
  const { entries } = parseIndex(content);

  const queryLower = query.toLowerCase();
  const matches = [];

  for (const [key, summary] of Object.entries(entries)) {
    if (key.toLowerCase().includes(queryLower) || summary.toLowerCase().includes(queryLower)) {
      matches.push({ key, summary });
    }
  }

  // Also search in note content
  const noteDir = getNoteDir(teamName, agentName, indexName);
  if (fs.existsSync(noteDir)) {
    for (const file of fs.readdirSync(noteDir)) {
      if (!file.endsWith(EXTENSIONS.MEMORY_BLOCK)) continue;

      const key = file.slice(0, -EXTENSIONS.MEMORY_BLOCK.length);
      if (matches.find((m) => m.key === key)) continue;

      const content = fs.readFileSync(path.join(noteDir, file), 'utf8');
      if (content.toLowerCase().includes(queryLower)) {
        matches.push({ key, summary: entries[key] || '(无摘要)' });
      }
    }
  }

  return { success: true, matches };
}

// ========== Memory Hint (for auto-injection) ==========

/**
 * Get all index entries for keyword matching
 */
export function getAllIndexEntries(teamName, agentName) {
  const configs = loadMemoryConfig(teamName, agentName);
  const indexEntries = [];

  for (const config of configs) {
    if (config.type !== MEMORY_TYPES.INDEX) continue;

    const content = readMemory(teamName, agentName, config.name);
    if (!content) continue;

    const { entries } = parseIndex(content);

    for (const [key, summary] of Object.entries(entries)) {
      indexEntries.push({
        indexName: config.name,
        key,
        summary,
        path: getNotePath(teamName, agentName, config.name, key),
      });
    }
  }

  return indexEntries;
}

/**
 * Find relevant index entries based on user message
 * Uses keyword matching for speed
 */
export function findRelevantEntries(teamName, agentName, userMessage) {
  if (!userMessage) return [];

  const entries = getAllIndexEntries(teamName, agentName);
  if (entries.length === 0) return [];

  const messageLower = userMessage.toLowerCase();
  const matches = [];

  for (const entry of entries) {
    const keyLower = entry.key.toLowerCase();
    const summaryLower = entry.summary.toLowerCase();

    // Check if key or summary appears in user message
    if (messageLower.includes(keyLower) || messageLower.includes(summaryLower)) {
      matches.push(entry);
      continue;
    }

    // Check if any word from key appears in message (for compound keys like "feature-login")
    const keyWords = keyLower.split(/[-_\s]+/).filter((w) => w.length > 2);
    for (const word of keyWords) {
      if (messageLower.includes(word)) {
        matches.push(entry);
        break;
      }
    }
  }

  return matches;
}

/**
 * Format memory hints for system prompt
 */
export function formatMemoryHints(matches) {
  if (matches.length === 0) return '';

  let hint = '<memory-hints>\n';
  hint += '检测到可能相关的笔记，建议使用 lookup 查看详情：\n\n';

  for (const match of matches) {
    hint += `- **${match.indexName}/${match.key}**: ${match.summary}\n`;
    hint += `  使用: lookup(index="${match.indexName}", key="${match.key}")\n\n`;
  }

  hint += '</memory-hints>';
  return hint;
}

// ========== Format for System Prompt ==========

/**
 * Load all memories for system prompt injection
 */
export function loadAllMemories(teamName, agentName) {
  const configs = loadMemoryConfig(teamName, agentName);
  const memories = [];

  for (const config of configs) {
    const content = readMemory(teamName, agentName, config.name);

    memories.push({
      name: config.name,
      type: config.type || MEMORY_TYPES.RESIDENT,
      readonly: config.readonly || false,
      limit: config.limit || DEFAULTS.MEMORY_LIMIT,
      content: content || '',
    });
  }

  return memories;
}

/**
 * Format memories for system prompt
 */
export function formatMemoriesPrompt(memories) {
  if (memories.length === 0) return '';

  let prompt = '<memory>\n';

  for (const mem of memories) {
    const attrs = [];
    if (mem.readonly) attrs.push('readonly="true"');
    if (mem.type && mem.type !== MEMORY_TYPES.RESIDENT) attrs.push(`type="${mem.type}"`);

    const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : '';
    prompt += `<${mem.name}${attrStr}>\n${mem.content}\n</${mem.name}>\n\n`;
  }

  prompt += '</memory>';
  return prompt;
}
