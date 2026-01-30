/**
 * Plugin hooks implementation
 */

import fs from 'fs';
import path from 'path';
import { PATHS } from '../constants.js';
import { loadTeamConfig, loadAgentConfig } from '../team/config.js';
import { findActiveServeUrl } from '../team/serve.js';
import {
  loadAllMemories,
  formatMemoriesPrompt,
  findRelevantEntries,
  formatMemoryHints,
  getMemoryInventory,
} from '../memory/memory.js';
import { saveSession, validateSessions } from '../memory/sessions.js';
import {
  consolidate,
  distill,
  markPendingSession,
  readMemoryState,
  getConsolidationThresholds,
  getDistillationThresholds,
  toTimestampMs,
} from '../memory/extractor.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('hooks');
import { fetchSession, fetchMessages } from '../utils/api.js';

const lifecycleLocks = new Map();
const lastEventTime = new Map();
const lifecycleQueue = new Map();

/**
 * Parse agent name from full format (team/agent or just agent)
 */
function parseAgentName(agentName, defaultTeam = null) {
  if (!agentName) return null;

  if (agentName.includes('/')) {
    const [team, name] = agentName.split('/');
    return { team, name, full: agentName };
  }

  if (defaultTeam) {
    return { team: defaultTeam, name: agentName, full: `${defaultTeam}/${agentName}` };
  }

  return null;
}

/**
 * Get current agent from session messages
 */
async function getCurrentAgent(sessionID, timeoutMs = 2000) {
  try {
    const serveUrl = findActiveServeUrl();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${serveUrl}/session/${sessionID}/message`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) return null;
      const messages = await res.json();

      if (!messages || messages.length === 0) return null;

      const lastMsg = messages[messages.length - 1];
      const agentName = lastMsg?.info?.agent;

      return parseAgentName(agentName);
    } catch {
      clearTimeout(timeoutId);
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Format team members prompt
 */
function formatTeamPrompt(teamConfig, currentAgentName) {
  if (!teamConfig?.agents?.length) return '';

  const teamMembers = teamConfig.agents
    .map((a) => (a === currentAgentName ? `- \`${a}\` (你)` : `- \`${a}\``))
    .join('\n');

  return `<team>\n团队成员：\n${teamMembers}\n</team>`;
}

/**
 * Get team collaboration rules prompt
 */
function getCollaborationRules() {
  return `<collaboration-rules>
## 团队协作规则

### 消息来源识别
- \`[from xxx]\` 前缀表示消息来源
- \`[from boss]\` = 老板直接指示，优先级最高
- \`[from <agent>]\` = 来自其他 agent（如 architect、developer 等）

### 通信方式
- **直接输出文字对方看不到**，必须用 \`msg\` 工具
- 收到 \`[from agent]\` 消息后，必须用 \`msg\` 回复对方才能看到

### 任务汇报（重要）
- **任务完成后必须用 \`msg\` 向任务分配者汇报结果**
- 汇报内容：完成了什么、关键产出、是否有遗留问题
- 不汇报 = 对方不知道你完成了，协作链断裂

### Boss 消息回复方式
- 收到 \`[from boss]\` 时**直接回复**即可（boss 在同一会话中）
- **禁止**用 \`msg(who="boss", ...)\`，boss 不是 agent

### 记忆系统
- 系统会**自动提取**对话中值得记住的信息，你无需刻意记录
- 当看到 \`<memory-hints>\` 提示时，说明有相关笔记可以查阅
- 记忆工具（remember/note 等）用于**主动精细控制**，非必需
</collaboration-rules>`;
}

/**
 * Extract latest user message text from messages array
 */
function getLatestUserMessage(messages) {
  if (!messages || messages.length === 0) return null;

  // Find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.info?.role !== 'user') continue;

    // Find first text part
    const textPart = msg.parts?.find((p) => p.type === 'text');
    if (textPart?.text) {
      // Remove [from xxx] prefix if present
      return textPart.text.replace(/^\[from\s+\w+\]\s*/, '').trim();
    }
  }

  return null;
}

/**
 * Create hooks for the plugin
 */
export function createHooks() {
  // Track last analyzed message count per session (instead of just processed/not)
  const lastAnalyzedCount = new Map(); // sessionID -> number of messages when last analyzed
  const pendingPath = path.join(PATHS.AGENTS_DIR, '.pending-sessions.json');
  // Track hints already shown in this session to avoid repetition
  const shownHints = new Map(); // sessionID -> Set of "indexName/key"
  return {
    /**
     * Messages transform hook - add [from boss] prefix to user messages without [from xxx] tag
     */
    messagesTransform: async (_input, output) => {
      if (!output.messages || output.messages.length === 0) return;

      // Find the last user message and add [from boss] prefix if needed
      for (let i = output.messages.length - 1; i >= 0; i--) {
        const msg = output.messages[i];
        if (msg.info?.role !== 'user') continue;

        // Find first non-synthetic text part
        const textPart = msg.parts?.find((p) => p.type === 'text' && !p.synthetic);
        if (!textPart?.text) continue;

        // Skip if already has [from xxx] prefix
        if (/^\[from\s+\w+\]/.test(textPart.text)) break;

        // Add [from boss] prefix
        textPart.text = `[from boss] ${textPart.text}`;
        break;
      }
    },

    /**
     * Event hook - track session idle and trigger memory extraction
     */
    event: async ({ event }) => {
      if (event.type !== 'session.idle') return;

      const sessionID = event.properties?.sessionID;
      if (!sessionID) return;

      // opencode 对同一个 idle 事件会调用两次 handler，去重
      const dedupeKey = `${event.type}:${sessionID}`;
      const now = Date.now();
      if (lastEventTime.get(dedupeKey) && now - lastEventTime.get(dedupeKey) < 1000) return;
      lastEventTime.set(dedupeKey, now);

      log.info('Session idle detected', { sessionID });

      // Save to pending for session history tracking
      let pending = [];
      if (fs.existsSync(pendingPath)) {
        try {
          pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
        } catch {
          // Ignore
        }
      }
      pending.push({ sessionID, time: Date.now() });

      const pendingDir = path.dirname(pendingPath);
      if (!fs.existsSync(pendingDir)) {
        fs.mkdirSync(pendingDir, { recursive: true });
      }
      fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2));

      // Memory Extractor: Analyze conversation and extract memories
      // Run asynchronously to not block the event handler
      (async () => {
        log.debug('Starting extraction async block', { sessionID });
        try {
          const serveUrl = findActiveServeUrl();
          log.debug('Serve URL', { serveUrl });
          if (!serveUrl) return;

          const agent = await getCurrentAgent(sessionID);
          if (!agent) {
            log.debug('No agent found for session', { sessionID });
            return;
          }

          // Get session directory (support both old and new API)
          // 跨项目 session 可能查不到（不同 projectID），fallback 到 serve 启动目录
          const session = await fetchSession(serveUrl, sessionID);
          const directory = session?.directory || session?.share?.directory || process.cwd();

          // Skip system sessions (like extractor session itself)
          // session 可能为 null（跨项目时查不到），此时不是系统 session
          if (session?.metadata?.system || session?.title?.startsWith('[系统]')) {
            log.debug('Skipping system session', { sessionID, title: session.title });
            return;
          }

          // Get message count to check if there are new messages
          const messages = await fetchMessages(serveUrl, sessionID);
          const messageCount = messages?.length || 0;
          const lastCount = lastAnalyzedCount.get(sessionID) || 0;

          if (messageCount <= lastCount) {
            log.debug('No new messages since last analysis', { sessionID, messageCount, lastCount });
            return;
          }

          // Update last analyzed count before checking lifecycle lock
          lastAnalyzedCount.set(sessionID, messageCount);
          log.info('Recording pending session', {
            sessionID,
            agent: agent.full,
            newMessages: messageCount - lastCount,
          });
          markPendingSession(agent.team, agent.name, sessionID, messageCount);

          const runLifecycle = async (context) => {
            const state = readMemoryState(context.agent.team, context.agent.name);
            const pendingSessions = state.pendingSessions || [];
            const consolidationThresholds = getConsolidationThresholds(context.agent.team);
            const now = Date.now();
            const lastConsolidationMs = toTimestampMs(state.lastConsolidation);
            const timeSinceConsolidation = lastConsolidationMs ? now - lastConsolidationMs : null;
            const consolidationDue =
              pendingSessions.length >= consolidationThresholds.sessionThreshold ||
              (timeSinceConsolidation !== null &&
                timeSinceConsolidation >= consolidationThresholds.timeThresholdMs);

            if (!consolidationDue) {
              log.info('Consolidation not due', {
                agent: context.agent.full,
                pendingCount: pendingSessions.length,
                threshold: consolidationThresholds.sessionThreshold,
              });
              return;
            }

            log.info('Triggering memory consolidation', {
              sessionID: context.sessionID,
              agent: context.agent.full,
              pendingCount: pendingSessions.length,
              thresholds: consolidationThresholds,
            });
            await consolidate(context.agent.team, context.agent.name, context.serveUrl, context.directory);

            const distillationThresholds = getDistillationThresholds(context.agent.team);
            const distillationState = readMemoryState(context.agent.team, context.agent.name);
            const inventory = getMemoryInventory(context.agent.team, context.agent.name);
            const lastDistillationMs = toTimestampMs(distillationState.lastDistillation);
            const timeSinceDistillation = lastDistillationMs ? now - lastDistillationMs : null;
            const distillationDue =
              (timeSinceDistillation !== null &&
                timeSinceDistillation >= distillationThresholds.timeThresholdMs) ||
              inventory.length >= distillationThresholds.entryThreshold;

            if (!distillationDue) {
              log.info('Distillation not due', {
                agent: context.agent.full,
                inventoryCount: inventory.length,
                threshold: distillationThresholds.entryThreshold,
              });
              return;
            }

            log.info('Triggering memory distillation', {
              sessionID: context.sessionID,
              agent: context.agent.full,
              inventoryCount: inventory.length,
              thresholds: distillationThresholds,
            });
            await distill(context.agent.team, context.agent.name, context.serveUrl, context.directory);
          };

          const runLifecycleWithLock = async (context) => {
            const lockKey = `${context.agent.team}/${context.agent.name}`;
            if (lifecycleLocks.has(lockKey)) {
              const existing = lifecycleQueue.get(lockKey);
              if (existing) {
                const previousCount = existing.lastCounts.get(context.sessionID);
                const nextCount = Number.isFinite(previousCount)
                  ? Math.min(previousCount, context.lastCount)
                  : context.lastCount;
                existing.lastCounts.set(context.sessionID, nextCount);
                existing.context = context;
              } else {
                lifecycleQueue.set(lockKey, {
                  context,
                  lastCounts: new Map([[context.sessionID, context.lastCount]]),
                });
              }
              log.info('Memory lifecycle queued', {
                agent: context.agent.full,
              });
              return;
            }

            lifecycleLocks.set(lockKey, true);
            try {
              await runLifecycle(context);
            } catch (e) {
              if (context.lastCounts) {
                for (const [queuedSessionID, queuedLastCount] of context.lastCounts.entries()) {
                  lastAnalyzedCount.set(queuedSessionID, queuedLastCount);
                }
              } else {
                lastAnalyzedCount.set(context.sessionID, context.lastCount);
              }
              log.error('Memory lifecycle error', { error: e.message, stack: e.stack });
            } finally {
              lifecycleLocks.delete(lockKey);
              const queued = lifecycleQueue.get(lockKey);
              if (queued) {
                lifecycleQueue.delete(lockKey);
                await runLifecycleWithLock({
                  ...queued.context,
                  lastCounts: queued.lastCounts,
                });
              }
            }
          };

          await runLifecycleWithLock({
            agent,
            serveUrl,
            directory,
            sessionID,
            lastCount,
            lastCounts: new Map([[sessionID, lastCount]]),
          });
        } catch (e) {
          log.error('Memory lifecycle error', { error: e.message, stack: e.stack });
        }
      })();
    },

    /**
     * System transform hook - inject memory and memory hints
     */
    systemTransform: async (input, output) => {
      const { sessionID } = input;

      log.debug('systemTransform called', { sessionID });
      try {
        const existingSystem = output.system?.join?.('') || output.system || '';

        // opencode 对同一轮会话可能调用两次 systemTransform（双实例加载），
        // 通过检查 output 内容判断是否已注入
        if (existingSystem.includes('<collaboration-rules>')) return;

        // Skip special requests (title generator, etc.)
        if (existingSystem.includes('title generator') || existingSystem.includes('You output ONLY')) {
          log.debug('Skipping special request');
          return;
        }

        const serveUrl = findActiveServeUrl();

        // Process pending sessions
        if (fs.existsSync(pendingPath)) {
          try {
            const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));

            for (const item of pending) {
              try {
                const agent = await getCurrentAgent(item.sessionID);
                if (!agent) continue;

                const session = await fetchSession(serveUrl, item.sessionID);
                if (!session) continue;

                saveSession(agent.team, agent.name, item.sessionID, session.title || 'Untitled');
              } catch {
                // Ignore errors
              }
            }

            fs.unlinkSync(pendingPath);
          } catch {
            // Ignore errors
          }
        }

        const agent = await getCurrentAgent(sessionID);
        if (!agent) return;

        // Validate sessions
        validateSessions(agent.team, agent.name, serveUrl).catch(() => {});

        // Load and inject memory
        const config = loadAgentConfig(agent.team, agent.name);
        if (config?.memories) {
          const memories = loadAllMemories(agent.team, agent.name);
          const memoriesPrompt = formatMemoriesPrompt(memories);
          if (memoriesPrompt) {
            (output.system ||= []).push(memoriesPrompt);
          }

          // Memory Injector: Find and hint relevant index entries
          // Fetch messages via API since systemTransform doesn't provide them
          const messages = await fetchMessages(serveUrl, sessionID);
          const userMessage = getLatestUserMessage(messages);
          if (userMessage) {
            const relevantEntries = findRelevantEntries(agent.team, agent.name, userMessage);

            // Filter out already shown hints in this session
            if (!shownHints.has(sessionID)) {
              shownHints.set(sessionID, new Set());
            }
            const sessionShown = shownHints.get(sessionID);

            const newMatches = relevantEntries.filter((entry) => {
              const hintKey = `${entry.indexName}/${entry.key}`;
              if (sessionShown.has(hintKey)) return false;
              sessionShown.add(hintKey);
              return true;
            });

            if (newMatches.length > 0) {
              log.info('Memory hints injected', {
                sessionID,
                agent: agent.full,
                hints: newMatches.map((m) => `${m.indexName}/${m.key}`),
              });
              const hintsPrompt = formatMemoryHints(newMatches);
              if (hintsPrompt) {
                (output.system ||= []).push(hintsPrompt);
              }
            }
          }
        }

        // Inject team members
        const teamConfig = loadTeamConfig(agent.team);
        if (teamConfig) {
          const teamPrompt = formatTeamPrompt(teamConfig, agent.name);
          if (teamPrompt) {
            (output.system ||= []).push(teamPrompt);
          }

          // Inject collaboration rules
          (output.system ||= []).push(getCollaborationRules());
        }
      } catch (e) {
        log.error('systemTransform error', { error: e.message });
      }
    },
  };
}
