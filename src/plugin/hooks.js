/**
 * Plugin hooks implementation — 团队协作功能
 *
 * 记忆功能已迁移到 openmemory 插件。
 * openteam 只负责:
 * - messagesTransform: 给无来源消息添加 [from boss]
 * - systemTransform: 注入团队上下文 + 协作规则
 */

import { loadTeamConfig, loadAgentConfig } from '../team/config.js';
import { findActiveServeUrl } from '../team/serve.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('hooks');

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
      return parseAgentName(lastMsg?.info?.agent);
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
- 系统会在对话结束后**自动巩固**有价值的信息到长期记忆，你无需刻意记录
- \`<memory>\` 中的 index 类型记忆显示了你所有笔记的摘要，需要详情时用 \`recall\` 查阅
- 用 \`review\` 和 \`reread\` 可以回顾历史对话
</collaboration-rules>`;
}

/**
 * Create hooks for the plugin
 */
export function createHooks() {
  return {
    /**
     * Messages transform hook - add [from boss] prefix
     */
    messagesTransform: async (_input, output) => {
      if (!output.messages || output.messages.length === 0) return;

      for (let i = output.messages.length - 1; i >= 0; i--) {
        const msg = output.messages[i];
        if (msg.info?.role !== 'user') continue;

        const textPart = msg.parts?.find((p) => p.type === 'text' && !p.synthetic);
        if (!textPart?.text) continue;

        if (/^\[from\s+\w+\]/.test(textPart.text)) break;

        textPart.text = `[from boss] ${textPart.text}`;
        break;
      }
    },

    /**
     * System transform hook - inject team context + collaboration rules
     */
    systemTransform: async (input, output) => {
      const { sessionID } = input;

      log.debug('systemTransform called', { sessionID });
      try {
        const existingSystem = output.system?.join?.('') || output.system || '';

        // 防止双份注入
        if (existingSystem.includes('<collaboration-rules>')) return;

        // 跳过特殊请求
        if (existingSystem.includes('title generator') || existingSystem.includes('You output ONLY')) return;

        const agent = await getCurrentAgent(sessionID);
        if (!agent) return;

        // 注入团队成员
        const teamConfig = loadTeamConfig(agent.team);
        if (teamConfig) {
          const teamPrompt = formatTeamPrompt(teamConfig, agent.name);
          if (teamPrompt) {
            (output.system ||= []).push(teamPrompt);
          }

          // 注入协作规则
          (output.system ||= []).push(getCollaborationRules());
        }
      } catch (e) {
        log.error('systemTransform error', { error: e.message });
      }
    },
  };
}
