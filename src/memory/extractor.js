/**
 * Memory Extractor
 *
 * Automatically extracts memorable information from conversations
 * using a lightweight LLM call at session.idle time.
 */

import YAML from 'yaml';
import { createSession, postMessage, fetchMessages, findSmallModel } from '../utils/api.js';
import { appendMemory, saveNote, loadMemoryConfig } from './memory.js';
import { getExtractorModel } from '../team/config.js';
import { MEMORY_TYPES } from '../constants.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('extractor');

// Extractor session and model management
let extractorSession = null;
let extractorModel = null; // Cached small model

/**
 * Prompt template for memory extraction
 */
const EXTRACTOR_PROMPT = `你是一个记忆提取助手。你的任务是分析对话内容，判断是否有值得长期记住的信息。

## 判断标准

**应该记住的**:
- 用户明确表达的偏好（如代码风格、语言习惯、工作方式）
- 用户提到的重要约束或要求
- 项目相关的关键决策或结论
- 踩过的坑和解决方案
- 反复出现的模式或需求

**不应该记住的**:
- 一次性的调试过程
- 临时的上下文信息
- 已经存在于记忆中的内容
- 过于具体的实现细节（除非是重要的技术决策）

## 输出格式

使用 YAML 格式输出（不要包含 markdown 代码块）。

如果有值得记住的内容:

extract: true
memories:
  - type: resident
    target: human
    action: append
    content: 要记住的内容
  - type: index
    target: projects
    key: note-key
    summary: 简短摘要
    content: |
      详细内容
      可以是多行

如果没有值得记住的内容:

extract: false
reason: 简短说明为什么不需要记住

## 注意事项
- type 只能是 "resident" 或 "index"
- resident 类型用于核心记忆（如 human 偏好），action 只能是 "append"
- index 类型用于笔记，需要提供 key 和 summary
- content 要简洁精炼，不要冗余
- 只输出 YAML，不要有其他内容`;

/**
 * Format conversation for analysis
 */
function formatConversation(messages, limit = 2) {
  if (!messages || messages.length === 0) return '';

  // Get last N exchanges (user + assistant pairs)
  const recentMessages = [];
  let exchangeCount = 0;

  for (let i = messages.length - 1; i >= 0 && exchangeCount < limit; i--) {
    const msg = messages[i];
    recentMessages.unshift(msg);

    if (msg.info?.role === 'user') {
      exchangeCount++;
    }
  }

  // Format messages
  const lines = [];
  for (const msg of recentMessages) {
    const role = msg.info?.role === 'user' ? '用户' : 'AI';
    const textPart = msg.parts?.find((p) => p.type === 'text');
    if (textPart?.text) {
      // Truncate long messages
      const text = textPart.text.length > 2000 ? textPart.text.slice(0, 2000) + '...' : textPart.text;
      lines.push(`[${role}]: ${text}`);
    }
  }

  return lines.join('\n\n');
}

/**
 * Get available memory targets for an agent
 */
function getAvailableMemories(teamName, agentName) {
  const configs = loadMemoryConfig(teamName, agentName);
  const available = {
    resident: [],
    index: [],
  };

  for (const config of configs) {
    if (config.readonly) continue;

    if (config.type === MEMORY_TYPES.INDEX) {
      available.index.push(config.name);
    } else if (!config.type || config.type === MEMORY_TYPES.RESIDENT) {
      available.resident.push(config.name);
    }
  }

  return available;
}

/**
 * Parse extractor response (YAML format)
 */
function parseExtractorResponse(text) {
  if (!text) return null;

  try {
    // Remove markdown code block if present
    let cleanText = text.trim();
    if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
    }

    const result = YAML.parse(cleanText);

    if (!result || typeof result !== 'object') {
      return null;
    }

    if (!result.extract) {
      return { extract: false, reason: result.reason || '无需记忆' };
    }

    if (!Array.isArray(result.memories) || result.memories.length === 0) {
      return { extract: false, reason: '没有提取到有效记忆' };
    }

    // Validate each memory item
    const validMemories = result.memories.filter((mem) => {
      if (!mem.type || !mem.target || !mem.content) return false;
      if (mem.type === 'index' && !mem.key) return false;
      return true;
    });

    if (validMemories.length === 0) {
      return { extract: false, reason: '记忆格式无效' };
    }

    return { extract: true, memories: validMemories };
  } catch (e) {
    log.warn('Failed to parse extractor response', { error: e.message });
    return null;
  }
}

/**
 * Apply extracted memories
 */
async function applyMemories(teamName, agentName, memories, availableMemories) {
  const results = [];

  for (const mem of memories) {
    try {
      if (mem.type === 'resident') {
        // Check if target is available
        if (!availableMemories.resident.includes(mem.target)) {
          results.push({ success: false, error: `记忆 "${mem.target}" 不可用` });
          continue;
        }

        if (mem.action === 'append') {
          const result = appendMemory(teamName, agentName, mem.target, mem.content);
          results.push(result);
        }
      } else if (mem.type === 'index') {
        // Check if target is available
        if (!availableMemories.index.includes(mem.target)) {
          results.push({ success: false, error: `笔记本 "${mem.target}" 不可用` });
          continue;
        }

        const result = saveNote(teamName, agentName, mem.target, mem.key, mem.content, mem.summary);
        results.push(result);
      }
    } catch (e) {
      results.push({ success: false, error: e.message });
    }
  }

  return results;
}

/**
 * Extract memories from a session's conversation
 */
export async function extractMemories(serveUrl, sessionID, teamName, agentName, directory) {
  log.info('Starting memory extraction', { sessionID, agent: `${teamName}/${agentName}` });

  try {
    // 1. Get conversation messages
    const messages = await fetchMessages(serveUrl, sessionID);
    if (!messages || messages.length < 2) {
      log.debug('Skipping: conversation too short', { messageCount: messages?.length || 0 });
      return { extracted: false, reason: '对话太短' };
    }

    // 2. Format conversation (last 1 exchange for efficiency)
    const conversation = formatConversation(messages, 1);
    if (!conversation) {
      log.debug('Skipping: no valid conversation content');
      return { extracted: false, reason: '无有效对话内容' };
    }

    // 3. Get available memories for this agent
    const availableMemories = getAvailableMemories(teamName, agentName);
    log.debug('Available memories', availableMemories);

    // 4. Create or reuse extractor session
    if (!extractorSession) {
      log.info('Creating extractor session');
      extractorSession = await createSession(serveUrl, directory, '[系统] 记忆提取', {
        agent: `${teamName}/${agentName}`,
        system: true, // Mark as system session
      });

      if (!extractorSession) {
        log.error('Failed to create extractor session');
        return { extracted: false, reason: '无法创建分析会话' };
      }
      log.info('Extractor session created', { sessionId: extractorSession.id });
    }

    // 5. Find model for extraction (cached)
    // Priority: 1) team.json extractor.model config  2) auto-detect small model
    if (!extractorModel) {
      // Check team config first
      const configuredModel = getExtractorModel(teamName);
      if (configuredModel) {
        extractorModel = configuredModel;
        log.info('Using configured extractor model', extractorModel);
      } else {
        // Auto-detect small model (prefer same provider as main model if possible)
        extractorModel = await findSmallModel(serveUrl);
        if (extractorModel) {
          log.info('Using auto-detected small model for extraction', extractorModel);
        } else {
          log.warn('No small model found, using default model');
        }
      }
    }

    // 6. Build analysis prompt
    const availableInfo = `
## 可用的记忆目标
- resident 类型: ${availableMemories.resident.join(', ') || '(无)'}
- index 类型: ${availableMemories.index.join(', ') || '(无)'}

## 对话内容
${conversation}`;

    const fullPrompt = EXTRACTOR_PROMPT + '\n\n' + availableInfo;
    log.debug('Sending analysis prompt', { promptLength: fullPrompt.length });

    // 7. Call LLM for analysis
    const response = await postMessage(
      serveUrl,
      extractorSession.id,
      directory,
      `${teamName}/${agentName}`,
      fullPrompt,
      {
        timeout: 30000,
        model: extractorModel, // Use small model if available
      }
    );

    if (!response) {
      log.warn('LLM analysis timeout');
      return { extracted: false, reason: 'LLM 分析超时' };
    }

    // 7. Parse response
    const textPart = response.parts?.find((p) => p.type === 'text');
    log.debug('LLM response received', { responseLength: textPart?.text?.length || 0 });

    const result = parseExtractorResponse(textPart?.text);

    if (!result) {
      log.warn('Failed to parse extractor response', { rawResponse: textPart?.text?.slice(0, 200) });
      return { extracted: false, reason: '无法解析分析结果' };
    }

    if (!result.extract) {
      log.info('No memories to extract', { reason: result.reason });
      return { extracted: false, reason: result.reason };
    }

    // 8. Apply memories
    log.info('Applying extracted memories', { count: result.memories.length });
    const applyResults = await applyMemories(teamName, agentName, result.memories, availableMemories);

    const successCount = applyResults.filter((r) => r.success).length;
    log.info('Memory extraction complete', {
      total: result.memories.length,
      success: successCount,
      failed: result.memories.length - successCount,
    });

    return {
      extracted: true,
      memories: result.memories,
      results: applyResults,
    };
  } catch (e) {
    log.error('Memory extraction failed', { error: e.message });
    return { extracted: false, reason: e.message };
  }
}

/**
 * Reset extractor session and model cache (call when serve restarts)
 */
export function resetExtractorSession() {
  extractorSession = null;
  extractorModel = null;
}
