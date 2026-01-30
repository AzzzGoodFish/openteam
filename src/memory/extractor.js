/**
 * Memory Lifecycle
 *
 * Accumulate -> Consolidate -> Distill
 */

import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { createSession, postMessage, fetchMessages, fetchSession, findSmallModel } from '../utils/api.js';
import { saveNote, readNote, deleteNote, mergeNotes, getMemoryInventory } from './memory.js';
import { getExtractorModel, getTeamDir, loadAgentConfig, loadTeamConfig } from '../team/config.js';
import { EXTENSIONS } from '../constants.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('extractor');

const providerModelCache = new Map();
let fallbackSmallModel = null;
const systemSessions = new Map();

const DEFAULT_STATE = {
  pendingSessions: [],
  lastConsolidation: null,
  lastDistillation: null,
  lastModelHint: null,
};

const DEFAULT_CONSOLIDATION_THRESHOLD = {
  sessionThreshold: 5,
  timeThresholdMs: 24 * 60 * 60 * 1000,
};

const DEFAULT_DISTILLATION_THRESHOLD = {
  timeThresholdMs: 7 * 24 * 60 * 60 * 1000,
  entryThreshold: 20,
};

const CONSOLIDATE_PROMPT = `你是一个记忆巩固助手。你的任务是把最近的对话摘要融合到现有索引记忆中，形成更稳定、可复用的笔记。

## 输入内容
- Agent Prompt（用于理解角色与工作方式）
- 当前索引记忆库存（按 index 分组，包含 key/summary/content）
- 待巩固会话摘要（按时间排序）

## 你的目标
1. 只处理 index 类型的记忆（不要改动 resident 记忆）。
2. 把会话摘要中有价值的信息写入索引记忆。
3. 避免重复信息，尽量更新或追加已有笔记。
4. 只有在笔记完全过时时才删除。

## 原则
- 内容要有信息密度，不要写空泛的一句话概括。
- 一条好的记忆应该包含：事实、决策原因、或具体方案。
- 示例：
  - 低密度：「openteam 是团队协作框架」
  - 高密度：「openteam 采用 Leader-Member 模式，通过异步消息通信，记忆系统分三层（resident/index/sessions）」

## 可用动作
- create: 新建笔记
- update: 覆盖更新笔记内容
- append: 追加内容到笔记末尾
- delete: 删除笔记

## 输出格式
只输出 YAML，不要包含代码块。

actions:
  - action: create|update|append|delete
    index: indexName
    key: note-key
    reason: 简短说明（可选）
    summary: 简短摘要（可选）
    content: |
      详细内容

如果无需变更，输出：

actions: []`;

const DISTILL_PROMPT = `你是一个记忆蒸馏助手。你的任务是整理索引记忆，合并重复、精炼内容、删除无效条目，让记忆更短更有用。

## 输入内容
- Agent Prompt（用于理解角色与工作方式）
- 当前索引记忆库存（按 index 分组，包含 key/summary/content）

## 你的目标
1. 只处理 index 类型的记忆。
2. 对高度重复的笔记进行合并或重写。
3. 删除过时或无价值的笔记。
4. 保留仍然有用的笔记。

## 原则
- 内容要有信息密度，不要写空泛的一句话概括。
- 一条好的记忆应该包含：事实、决策原因、或具体方案。
- 示例：
  - 低密度：「openteam 是团队协作框架」
  - 高密度：「openteam 采用 Leader-Member 模式，通过异步消息通信，记忆系统分三层（resident/index/sessions）」

## 可用动作
- merge: 合并多条笔记到一个目标 key
- rewrite: 重写一条笔记
- delete: 删除一条笔记
- keep: 保持不变（可选）

## 输出格式
只输出 YAML，不要包含代码块。

actions:
  - action: merge|rewrite|delete|keep
    index: indexName
    reason: 简短说明（可选）
    source_keys: [key1, key2]
    target_key: merged-key
    summary: 简短摘要（可选）
    content: |
      合并后的内容
  - action: rewrite
    index: indexName
    key: note-key
    reason: 简短说明（可选）
    summary: 简短摘要（可选）
    content: |
      重写后的内容

如果无需变更，输出：

actions: []`;

function getMemoryStatePath(teamName) {
  return path.join(getTeamDir(teamName), '.memory-state.json');
}

export function readMemoryState(teamName) {
  const statePath = getMemoryStatePath(teamName);
  if (!fs.existsSync(statePath)) {
    return { ...DEFAULT_STATE };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return {
      ...DEFAULT_STATE,
      ...raw,
      pendingSessions: normalizePendingSessions(raw?.pendingSessions),
      lastConsolidation: normalizeTimestamp(raw?.lastConsolidation),
      lastDistillation: normalizeTimestamp(raw?.lastDistillation),
      lastModelHint: normalizeModelHint(raw?.lastModelHint),
    };
  } catch (error) {
    log.warn('Failed to read memory state', {
      event: 'memory_state_read_failed',
      team: teamName,
      error: error.message,
    });
    return { ...DEFAULT_STATE };
  }
}

function normalizePendingSessions(pendingSessions) {
  if (!Array.isArray(pendingSessions)) return [];

  const normalized = [];
  for (const entry of pendingSessions) {
    const sessionID = entry?.sessionID || entry?.sessionId;
    if (!sessionID) continue;

    normalized.push({
      agent: entry.agent,
      sessionID,
      messageCount: entry.messageCount,
      timestamp: normalizeTimestamp(entry.timestamp),
    });
  }

  return normalized;
}

function normalizeTimestamp(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  return null;
}

export function toTimestampMs(value) {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function normalizeModelHint(value) {
  if (!value || typeof value !== 'object') return null;
  const providerID = typeof value.providerID === 'string' && value.providerID.trim() ? value.providerID.trim() : null;
  const modelID = typeof value.modelID === 'string' && value.modelID.trim() ? value.modelID.trim() : null;
  if (!providerID && !modelID) return null;
  return { providerID, modelID };
}

function applyModelHint(state, hint) {
  const normalized = normalizeModelHint(hint);
  if (!normalized) return state;
  const current = normalizeModelHint(state?.lastModelHint);
  if (current?.providerID === normalized.providerID && current?.modelID === normalized.modelID) return state;
  return { ...state, lastModelHint: normalized };
}

export function writeMemoryState(teamName, state) {
  const statePath = getMemoryStatePath(teamName);
  const teamDir = getTeamDir(teamName);
  if (!fs.existsSync(teamDir)) {
    fs.mkdirSync(teamDir, { recursive: true });
  }

  try {
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    return { success: true };
  } catch (error) {
    log.error('Failed to write memory state', {
      event: 'memory_state_write_failed',
      team: teamName,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
}

export function markPendingSession(teamName, agentName, sessionID, messageCount) {
  const state = readMemoryState(teamName);
  const pendingSessions = normalizePendingSessions(state.pendingSessions);
  const now = new Date().toISOString();

  const existing = pendingSessions.find((entry) => entry.sessionID === sessionID && entry.agent === agentName);
  if (existing) {
    if (existing.messageCount === messageCount) {
      log.info('Pending session unchanged', {
        event: 'pending_session_unchanged',
        team: teamName,
        agent: agentName,
        sessionID,
        messageCount,
      });
      return { updated: false, reason: 'message_count_unchanged' };
    }
    existing.messageCount = messageCount;
    existing.timestamp = now;
  } else {
    pendingSessions.push({
      agent: agentName,
      sessionID,
      messageCount,
      timestamp: now,
    });
  }

  const nextState = {
    ...state,
    pendingSessions,
  };

  writeMemoryState(teamName, nextState);
  log.info('Pending session recorded', {
    event: 'pending_session_marked',
    team: teamName,
    agent: agentName,
    sessionID,
    messageCount,
  });

  return { updated: true };
}

export function parseDurationToMs(value, fallbackMs) {
  if (value === null || value === undefined) return fallbackMs;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return fallbackMs;

  const match = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)([smhd])$/i);
  if (!match) return fallbackMs;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallbackMs;

  const unit = match[2].toLowerCase();
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * (multipliers[unit] || 1);
}

export function getConsolidationThresholds(teamName) {
  const config = loadTeamConfig(teamName);
  const consolidation = config?.extractor?.consolidation || {};

  return {
    sessionThreshold: Number.isFinite(consolidation.sessionThreshold)
      ? consolidation.sessionThreshold
      : DEFAULT_CONSOLIDATION_THRESHOLD.sessionThreshold,
    timeThresholdMs: parseDurationToMs(
      consolidation.timeThreshold,
      DEFAULT_CONSOLIDATION_THRESHOLD.timeThresholdMs
    ),
  };
}

export function getDistillationThresholds(teamName) {
  const config = loadTeamConfig(teamName);
  const distillation = config?.extractor?.distillation || {};

  return {
    timeThresholdMs: parseDurationToMs(distillation.timeThreshold, DEFAULT_DISTILLATION_THRESHOLD.timeThresholdMs),
    entryThreshold: Number.isFinite(distillation.entryThreshold)
      ? distillation.entryThreshold
      : DEFAULT_DISTILLATION_THRESHOLD.entryThreshold,
  };
}

function stripCodeFences(text) {
  if (!text) return '';
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  }
  return cleaned.trim();
}

function parseActionList(text) {
  const cleaned = stripCodeFences(text);
  if (!cleaned) {
    return { actions: [], error: 'empty_response' };
  }

  try {
    const parsed = YAML.parse(cleaned);
    if (!parsed) return { actions: [], error: 'empty_yaml' };
    if (Array.isArray(parsed)) return { actions: parsed };
    if (Array.isArray(parsed.actions)) return { actions: parsed.actions };
    if (parsed.action) return { actions: [parsed] };
    return { actions: [], error: 'invalid_yaml_format' };
  } catch (error) {
    return { actions: [], error: error.message };
  }
}

function normalizeKey(value) {
  if (typeof value === 'string') return value.trim();
  return value;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeKey(item)).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function buildInventoryMap(inventory) {
  const map = new Map();
  for (const item of inventory) {
    if (!map.has(item.index)) map.set(item.index, new Map());
    map.get(item.index).set(item.key, item);
  }
  return map;
}

function indentBlock(text, indent = 4) {
  const pad = ' '.repeat(indent);
  if (!text) return `${pad}(空)`;
  return text
    .split('\n')
    .map((line) => `${pad}${line}`)
    .join('\n');
}

function formatInventory(inventory) {
  if (!inventory || inventory.length === 0) {
    return '（空）';
  }

  const grouped = new Map();
  for (const item of inventory) {
    if (!grouped.has(item.index)) grouped.set(item.index, []);
    grouped.get(item.index).push(item);
  }

  const lines = [];
  for (const [indexName, items] of grouped.entries()) {
    lines.push(`### ${indexName}`);
    for (const item of items) {
      lines.push(`- key: ${item.key}`);
      lines.push(`  summary: ${item.summary || ''}`);
      lines.push('  content: |');
      lines.push(indentBlock(item.content || '', 4));
    }
  }

  return lines.join('\n');
}

function formatRecentConversation(messages, limit = 3) {
  if (!messages || messages.length === 0) return '';

  const recentMessages = [];
  let exchangeCount = 0;

  for (let i = messages.length - 1; i >= 0 && exchangeCount < limit; i -= 1) {
    const msg = messages[i];
    recentMessages.unshift(msg);
    if (msg.info?.role === 'user') {
      exchangeCount += 1;
    }
  }

  const lines = [];
  for (const msg of recentMessages) {
    const role = msg.info?.role === 'user' ? '用户' : 'AI';
    const textPart = msg.parts?.find((part) => part.type === 'text');
    if (textPart?.text) {
      const text = textPart.text.length > 1200 ? `${textPart.text.slice(0, 1200)}...` : textPart.text;
      lines.push(`[${role}]: ${text}`);
    }
  }

  return lines.join('\n\n');
}

function extractMessageSummary(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    const summary = msg?.summary || msg?.info?.summary || null;
    if (typeof summary === 'string' && summary.trim()) return summary.trim();
    if (summary?.title && typeof summary.title === 'string' && summary.title.trim()) return summary.title.trim();
    if (summary?.text && typeof summary.text === 'string' && summary.text.trim()) return summary.text.trim();
  }

  return '';
}

async function buildPendingSummaries(serveUrl, pendingSessions) {
  const sorted = [...pendingSessions].sort((a, b) => {
    const left = toTimestampMs(a.timestamp) || 0;
    const right = toTimestampMs(b.timestamp) || 0;
    return left - right;
  });
  const summaries = [];

  for (const entry of sorted) {
    let summaryText = '';
    const sessionID = entry.sessionID || entry.sessionId;

    try {
      const session = await fetchSession(serveUrl, sessionID);
      if (typeof session?.summary === 'string' && session.summary.trim()) {
        summaryText = session.summary.trim();
      } else if (typeof session?.summary?.text === 'string' && session.summary.text.trim()) {
        summaryText = session.summary.text.trim();
      }
    } catch (error) {
      log.warn('Failed to fetch session summary', {
        event: 'pending_summary_fetch_failed',
        sessionID,
        error: error.message,
      });
    }

    if (!summaryText) {
      try {
        const messages = await fetchMessages(serveUrl, sessionID);
        summaryText = extractMessageSummary(messages);
        if (!summaryText) {
          summaryText = formatRecentConversation(messages, 3);
        }
      } catch (error) {
        summaryText = '';
        log.warn('Failed to fetch session messages', {
          event: 'pending_conversation_fetch_failed',
          sessionID,
          error: error.message,
        });
      }
    }

    summaries.push({
      sessionID,
      timestamp: entry.timestamp || new Date().toISOString(),
      summary: summaryText || '(无有效摘要)',
    });
  }

  return summaries;
}

function formatPendingNarrative(pendingSummaries) {
  if (!pendingSummaries || pendingSummaries.length === 0) return '（无待巩固会话）';

  const lines = [];
  for (const entry of pendingSummaries) {
    const timestampMs = toTimestampMs(entry.timestamp) || Date.now();
    const date = new Date(timestampMs).toLocaleString('zh-CN');
    lines.push(`- ${date} (${entry.sessionID})`);
    lines.push(entry.summary);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function resolveAgentPromptPath(teamName, agentName) {
  const agentConfig = loadAgentConfig(teamName, agentName);
  let promptPath = null;

  if (agentConfig?.prompt?.path) {
    promptPath = agentConfig.prompt.path;
  } else if (typeof agentConfig?.prompt === 'string') {
    promptPath = agentConfig.prompt;
  } else if (typeof agentConfig?.promptPath === 'string') {
    promptPath = agentConfig.promptPath;
  }

  if (promptPath) {
    if (!path.isAbsolute(promptPath)) {
      const agentDir = path.join(getTeamDir(teamName), agentName);
      promptPath = path.join(agentDir, promptPath);
    }
    return promptPath;
  }

  return path.join(getTeamDir(teamName), `${agentName}${EXTENSIONS.AGENT_PROMPT}`);
}

function readAgentPromptContent(teamName, agentName) {
  const promptPath = resolveAgentPromptPath(teamName, agentName);
  if (!fs.existsSync(promptPath)) return '';
  return fs.readFileSync(promptPath, 'utf8').trim();
}

async function getSystemSession(serveUrl, directory, teamName, agentName, kind) {
  const key = `${teamName}/${agentName}/${kind}`;
  if (systemSessions.has(key)) return systemSessions.get(key);

  const title = kind === 'distill' ? '[系统] 记忆蒸馏' : '[系统] 记忆巩固';
  const session = await createSession(serveUrl, directory, title, {
    agent: `${teamName}/${agentName}`,
    system: true,
  });

  if (!session) {
    log.error('Failed to create memory session', {
      event: 'memory_session_create_failed',
      team: teamName,
      agent: agentName,
      kind,
    });
    return null;
  }

  systemSessions.set(key, session);
  return session;
}

function getProviderEntry(providerID) {
  if (!providerID) return null;
  if (!providerModelCache.has(providerID)) {
    providerModelCache.set(providerID, { smallModel: null, mainModel: null });
  }
  return providerModelCache.get(providerID);
}

function extractModelHint(message) {
  const info = message?.info || {};
  const model = info.model || {};
  const providerID =
    model.providerID || model.provider || model.provider_id || info.providerID || info.provider || null;
  const modelID = model.modelID || model.id || info.modelID || info.modelId || info.model || null;

  return {
    providerID: providerID || null,
    modelID: modelID || null,
  };
}

function deriveProviderHintFromMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;

  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.info?.role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  if (lastUserIndex >= 0) {
    const hint = extractModelHint(messages[lastUserIndex]);
    if (hint.providerID || hint.modelID) return hint;
    for (let i = lastUserIndex; i >= 0; i -= 1) {
      const fallback = extractModelHint(messages[i]);
      if (fallback.providerID || fallback.modelID) return fallback;
    }
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const hint = extractModelHint(messages[i]);
    if (hint.providerID || hint.modelID) return hint;
  }

  return null;
}

async function getProviderHintFromPending(serveUrl, pendingSessions) {
  if (!Array.isArray(pendingSessions) || pendingSessions.length === 0) return null;

  let latest = null;
  for (const entry of pendingSessions) {
    const entryTimestamp = toTimestampMs(entry.timestamp) || 0;
    const latestTimestamp = toTimestampMs(latest?.timestamp) || 0;
    if (!latest || entryTimestamp > latestTimestamp) {
      latest = entry;
    }
  }

  const sessionID = latest?.sessionID || latest?.sessionId;
  if (!sessionID) return null;

  try {
    const messages = await fetchMessages(serveUrl, sessionID);
    return deriveProviderHintFromMessages(messages);
  } catch (error) {
    log.warn('Failed to derive provider hint', {
      event: 'memory_model_hint_failed',
      sessionID,
      error: error.message,
    });
    return null;
  }
}

async function resolveMemoryModel(teamName, serveUrl, providerHint, allowFallbackSmall = true) {
  const configuredModel = getExtractorModel(teamName);
  if (configuredModel) {
    log.info('Using configured extractor model', {
      event: 'memory_model_selected',
      model: configuredModel,
      source: 'team_config',
    });
    return configuredModel;
  }

  const providerID = providerHint?.providerID || null;
  const modelID = providerHint?.modelID || null;

  if (providerID) {
    const entry = getProviderEntry(providerID);
    if (modelID) {
      entry.mainModel = { providerID, modelID };
    }

    if (entry?.smallModel) {
      log.info('Using cached small model for provider', {
        event: 'memory_model_selected',
        model: entry.smallModel,
        source: 'provider_cache',
      });
      return entry.smallModel;
    }

    const smallModel = await findSmallModel(serveUrl, providerID);
    if (smallModel) {
      entry.smallModel = smallModel;
      log.info('Using provider small model for memory', {
        event: 'memory_model_selected',
        model: smallModel,
        source: 'provider_small',
      });
      return smallModel;
    }

    if (modelID) {
      const mainModel = { providerID, modelID };
      log.info('Using provider main model for memory', {
        event: 'memory_model_selected',
        model: mainModel,
        source: 'provider_main',
      });
      return mainModel;
    }

    if (entry?.mainModel) {
      log.info('Using cached provider main model for memory', {
        event: 'memory_model_selected',
        model: entry.mainModel,
        source: 'provider_cache_main',
      });
      return entry.mainModel;
    }
  }

  if (!allowFallbackSmall) return null;

  if (!fallbackSmallModel) {
    fallbackSmallModel = await findSmallModel(serveUrl);
    if (fallbackSmallModel) {
      log.info('Using fallback small model for memory', {
        event: 'memory_model_selected',
        model: fallbackSmallModel,
        source: 'fallback_small',
      });
    } else {
      log.warn('No small model found for memory tasks', {
        event: 'memory_model_not_found',
      });
    }
  }

  return fallbackSmallModel;
}

function buildConsolidationPrompt({ agentPrompt, inventory, pendingNarrative }) {
  return [
    CONSOLIDATE_PROMPT,
    '\n\n## Agent Prompt\n',
    agentPrompt || '(空)',
    '\n\n## 当前索引记忆\n',
    formatInventory(inventory),
    '\n\n## 待巩固会话摘要\n',
    pendingNarrative || '(无)',
  ].join('');
}

function buildDistillationPrompt({ agentPrompt, inventory }) {
  return [
    DISTILL_PROMPT,
    '\n\n## Agent Prompt\n',
    agentPrompt || '(空)',
    '\n\n## 当前索引记忆\n',
    formatInventory(inventory),
  ].join('');
}

async function applyConsolidationActions(teamName, agentName, actions, inventoryMap) {
  const results = [];

  for (const action of actions) {
    const actionType = String(action?.action || '').toLowerCase();
    const indexName = normalizeKey(action?.index);
    const key = normalizeKey(action?.key);
    const content = typeof action?.content === 'string' ? action.content : '';
    const summary = typeof action?.summary === 'string' ? action.summary : undefined;
    const reason = typeof action?.reason === 'string' ? action.reason : undefined;

    if (!actionType || !indexName || !key || (actionType !== 'delete' && !content)) {
      results.push({ success: false, error: 'invalid_action', action, reason });
      log.warn('Invalid consolidation action', {
        event: 'memory_action_invalid',
        type: actionType,
        index: indexName,
        key,
      });
      continue;
    }

    if (reason) {
      log.info('Memory action reason', {
        event: 'memory_action_reason',
        type: actionType,
        index: indexName,
        key,
        reason,
      });
    }

    try {
      if (actionType === 'delete') {
        const result = deleteNote(teamName, agentName, indexName, key);
        results.push({ ...result, action: actionType, index: indexName, key, reason });
        continue;
      }

      if (actionType === 'append') {
        const existing = readNote(teamName, agentName, indexName, key);
        const existingSummary = inventoryMap?.get(indexName)?.get(key)?.summary;
        const mergedContent = existing.success ? `${existing.content}\n\n${content}` : content;
        const result = saveNote(teamName, agentName, indexName, key, mergedContent, summary || existingSummary);
        results.push({ ...result, action: actionType, index: indexName, key, reason });
        continue;
      }

      if (actionType === 'create' || actionType === 'update') {
        const existingSummary = inventoryMap?.get(indexName)?.get(key)?.summary;
        const result = saveNote(teamName, agentName, indexName, key, content, summary || existingSummary);
        results.push({ ...result, action: actionType, index: indexName, key, reason });
        continue;
      }

      results.push({ success: false, error: 'unknown_action', action, reason });
      log.warn('Unknown consolidation action', {
        event: 'memory_action_unknown',
        type: actionType,
        index: indexName,
        key,
      });
    } catch (error) {
      results.push({ success: false, error: error.message, action: actionType, index: indexName, key, reason });
      log.error('Failed to apply consolidation action', {
        event: 'memory_action_failed',
        type: actionType,
        index: indexName,
        key,
        error: error.message,
      });
    }
  }

  return results;
}

async function applyDistillationActions(teamName, agentName, actions, inventoryMap) {
  const results = [];

  for (const action of actions) {
    const actionType = String(action?.action || '').toLowerCase();
    const indexName = normalizeKey(action?.index);
    const reason = typeof action?.reason === 'string' ? action.reason : undefined;

    if (!actionType || !indexName) {
      results.push({ success: false, error: 'invalid_action', action, reason });
      log.warn('Invalid distillation action', {
        event: 'memory_action_invalid',
        type: actionType,
        index: indexName,
      });
      continue;
    }

    if (reason) {
      log.info('Memory action reason', {
        event: 'memory_action_reason',
        type: actionType,
        index: indexName,
        key: normalizeKey(action?.key),
        reason,
      });
    }

    if (actionType === 'keep') {
      results.push({
        success: true,
        action: 'keep',
        index: indexName,
        key: normalizeKey(action?.key),
        reason,
      });
      continue;
    }

    if (actionType === 'delete') {
      const key = normalizeKey(action?.key);
      if (!key) {
        results.push({ success: false, error: 'invalid_action', action, reason });
        continue;
      }
      const result = deleteNote(teamName, agentName, indexName, key);
      results.push({ ...result, action: actionType, index: indexName, key, reason });
      continue;
    }

    if (actionType === 'rewrite') {
      const key = normalizeKey(action?.key);
      const content = typeof action?.content === 'string' ? action.content : '';
      const summary = typeof action?.summary === 'string' ? action.summary : undefined;
      if (!key || !content) {
        results.push({ success: false, error: 'invalid_action', action, reason });
        continue;
      }
      const existingSummary = inventoryMap?.get(indexName)?.get(key)?.summary;
      const result = saveNote(teamName, agentName, indexName, key, content, summary || existingSummary);
      results.push({ ...result, action: actionType, index: indexName, key, reason });
      continue;
    }

    if (actionType === 'merge') {
      const sourceKeys = normalizeArray(action?.merge_from || action?.source_keys || action?.sourceKeys);
      const targetKey = normalizeKey(action?.key || action?.target_key || action?.targetKey);
      const content = typeof action?.content === 'string' ? action.content : '';
      const summary = typeof action?.summary === 'string' ? action.summary : undefined;
      if (!targetKey || sourceKeys.length === 0 || !content) {
        results.push({ success: false, error: 'invalid_action', action, reason });
        continue;
      }

      const existingSummary = inventoryMap?.get(indexName)?.get(targetKey)?.summary;
      const result = mergeNotes(teamName, agentName, indexName, sourceKeys, targetKey, content, summary || existingSummary);
      results.push({ ...result, action: actionType, index: indexName, key: targetKey, reason });
      continue;
    }

    results.push({ success: false, error: 'unknown_action', action, reason });
  }

  return results;
}

function summarizeActionResults(results) {
  const successCount = results.filter((item) => item.success).length;
  return {
    total: results.length,
    success: successCount,
    failed: results.length - successCount,
  };
}

export async function consolidate(teamName, agentName, serveUrl, directory) {
  log.info('Starting memory consolidation', {
    event: 'memory_consolidation_started',
    team: teamName,
    agent: agentName,
  });

  const state = readMemoryState(teamName);
  const pendingSessions = normalizePendingSessions(state.pendingSessions).filter((entry) => entry.agent === agentName);

  if (pendingSessions.length === 0) {
    log.info('No pending sessions for consolidation', {
      event: 'memory_consolidation_skipped',
      team: teamName,
      agent: agentName,
      reason: 'no_pending_sessions',
    });
    return { consolidated: false, reason: 'no_pending_sessions' };
  }

  const thresholds = getConsolidationThresholds(teamName);
  const inventory = getMemoryInventory(teamName, agentName);
  const inventoryMap = buildInventoryMap(inventory);
  const agentPrompt = readAgentPromptContent(teamName, agentName);
  const pendingSummaries = await buildPendingSummaries(serveUrl, pendingSessions);
  const pendingNarrative = formatPendingNarrative(pendingSummaries);
  const prompt = buildConsolidationPrompt({ agentPrompt, inventory, pendingNarrative });

  const session = await getSystemSession(serveUrl, directory, teamName, agentName, 'consolidate');
  if (!session) {
    return { consolidated: false, reason: 'session_unavailable' };
  }

  const providerHint = (await getProviderHintFromPending(serveUrl, pendingSessions)) || state.lastModelHint;
  const model = await resolveMemoryModel(teamName, serveUrl, providerHint, true);
  let response = null;
  try {
    response = await postMessage(
      serveUrl,
      session.id,
      directory,
      `${teamName}/${agentName}`,
      prompt,
      { timeout: 60000, model }
    );
  } catch (error) {
    log.error('Consolidation request failed', {
      event: 'memory_consolidation_failed',
      team: teamName,
      agent: agentName,
      reason: error.message,
    });
    return { consolidated: false, reason: 'request_failed' };
  }

  if (!response) {
    log.error('Consolidation model response timeout', {
      event: 'memory_consolidation_failed',
      team: teamName,
      agent: agentName,
      reason: 'timeout',
    });
    return { consolidated: false, reason: 'timeout' };
  }

  const textPart = response.parts?.find((part) => part.type === 'text');
  const { actions, error } = parseActionList(textPart?.text || '');
  if (error) {
    log.warn('Failed to parse consolidation actions', {
      event: 'memory_consolidation_parse_failed',
      team: teamName,
      agent: agentName,
      error,
    });
  }

  const validActions = actions.filter(
    (action) => ['create', 'update', 'append', 'delete'].includes(String(action?.action || '').toLowerCase())
  );

  const results = await applyConsolidationActions(teamName, agentName, validActions, inventoryMap);
  const summary = summarizeActionResults(results);

  log.info('Memory consolidation applied', {
    event: 'memory_consolidation_applied',
    team: teamName,
    agent: agentName,
    ...summary,
    pendingCount: pendingSessions.length,
    thresholds,
  });

  const nextState = applyModelHint(state, providerHint);
  if (summary.failed === 0) {
    writeMemoryState(teamName, {
      ...nextState,
      pendingSessions: (state.pendingSessions || []).filter((entry) => entry.agent !== agentName),
      lastConsolidation: new Date().toISOString(),
    });
  } else if (nextState !== state) {
    writeMemoryState(teamName, nextState);
  }

  return {
    consolidated: summary.failed === 0,
    actions: validActions,
    results,
    thresholds,
  };
}

export async function distill(teamName, agentName, serveUrl, directory) {
  log.info('Starting memory distillation', {
    event: 'memory_distillation_started',
    team: teamName,
    agent: agentName,
  });

  const state = readMemoryState(teamName);
  const pendingSessions = normalizePendingSessions(state.pendingSessions).filter((entry) => entry.agent === agentName);
  const thresholds = getDistillationThresholds(teamName);
  const inventory = getMemoryInventory(teamName, agentName);
  const inventoryMap = buildInventoryMap(inventory);
  const agentPrompt = readAgentPromptContent(teamName, agentName);
  const prompt = buildDistillationPrompt({ agentPrompt, inventory });

  const session = await getSystemSession(serveUrl, directory, teamName, agentName, 'distill');
  if (!session) {
    return { distilled: false, reason: 'session_unavailable' };
  }

  const providerHint = (await getProviderHintFromPending(serveUrl, pendingSessions)) || state.lastModelHint;
  const model = await resolveMemoryModel(teamName, serveUrl, providerHint, true);
  let response = null;
  try {
    response = await postMessage(
      serveUrl,
      session.id,
      directory,
      `${teamName}/${agentName}`,
      prompt,
      { timeout: 60000, model }
    );
  } catch (error) {
    log.error('Distillation request failed', {
      event: 'memory_distillation_failed',
      team: teamName,
      agent: agentName,
      reason: error.message,
    });
    return { distilled: false, reason: 'request_failed' };
  }

  if (!response) {
    log.error('Distillation model response timeout', {
      event: 'memory_distillation_failed',
      team: teamName,
      agent: agentName,
      reason: 'timeout',
    });
    return { distilled: false, reason: 'timeout' };
  }

  const textPart = response.parts?.find((part) => part.type === 'text');
  const { actions, error } = parseActionList(textPart?.text || '');
  if (error) {
    log.warn('Failed to parse distillation actions', {
      event: 'memory_distillation_parse_failed',
      team: teamName,
      agent: agentName,
      error,
    });
  }

  const validActions = actions.filter((action) =>
    ['merge', 'rewrite', 'delete', 'keep'].includes(String(action?.action || '').toLowerCase())
  );

  const results = await applyDistillationActions(teamName, agentName, validActions, inventoryMap);
  const summary = summarizeActionResults(results);

  log.info('Memory distillation applied', {
    event: 'memory_distillation_applied',
    team: teamName,
    agent: agentName,
    ...summary,
    inventoryCount: inventory.length,
    thresholds,
  });

  const nextState = applyModelHint(state, providerHint);
  if (summary.failed === 0) {
    writeMemoryState(teamName, {
      ...nextState,
      lastDistillation: new Date().toISOString(),
    });
  } else if (nextState !== state) {
    writeMemoryState(teamName, nextState);
  }

  return {
    distilled: summary.failed === 0,
    actions: validActions,
    results,
    thresholds,
  };
}
