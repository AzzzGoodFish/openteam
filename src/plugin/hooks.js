/**
 * Plugin hooks implementation
 */

import fs from 'fs';
import path from 'path';
import { PATHS } from '../constants.js';
import { loadTeamConfig, loadAgentConfig } from '../team/config.js';
import { findActiveServeUrl } from '../team/serve.js';
import { loadAllMemories, formatMemoriesPrompt } from '../memory/memory.js';
import { saveSession, validateSessions } from '../memory/sessions.js';
import { fetchSession } from '../utils/api.js';

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
- Boss 亲自介入通常意味着工作有偏差，需反思是否更新记忆

**必须反思**：是否需要使用 \`correct\` 或 \`rethink\` 更新记忆？
</collaboration-rules>`;
}

/**
 * Create hooks for the plugin
 */
export function createHooks() {
  const processedSessions = new Set();
  const pendingPath = path.join(PATHS.AGENTS_DIR, '.pending-sessions.json');

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
     * Event hook - track session idle
     */
    event: async ({ event }) => {
      if (event.type !== 'session.idle') return;

      const sessionID = event.properties?.sessionID;
      if (!sessionID) return;

      if (processedSessions.has(sessionID)) return;
      processedSessions.add(sessionID);

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
    },

    /**
     * System transform hook - inject memory
     */
    systemTransform: async ({ sessionID }, output) => {
      try {
        // Skip special requests (title generator, etc.)
        const existingSystem = output.system?.join?.('') || output.system || '';
        if (existingSystem.includes('title generator') || existingSystem.includes('You output ONLY')) {
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

        // Get current agent
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
        console.error('[openteam] systemTransform error:', e.message);
      }
    },
  };
}
