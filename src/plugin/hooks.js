/**
 * Plugin hooks implementation — 团队协作功能
 *
 * 记忆功能已迁移到 openmemory 插件。
 * openteam 只负责:
 * - messagesTransform: 给无来源消息添加 [from boss]
 * - systemTransform: 注入团队上下文 + 协作规则
 */

import { loadTeamConfig } from '../team/config.js';
import { getCurrentAgent } from '../utils/agent.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('hooks');

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
      if (!output.messages || output.messages.length === 0) {
        log.debug('messagesTransform: no messages');
        return;
      }

      log.debug('messagesTransform called', { messageCount: output.messages.length });

      for (let i = output.messages.length - 1; i >= 0; i--) {
        const msg = output.messages[i];
        if (msg.info?.role !== 'user') continue;

        const textPart = msg.parts?.find((p) => p.type === 'text' && !p.synthetic);
        if (!textPart?.text) {
          log.debug('messagesTransform: user msg has no text part', { index: i, partTypes: msg.parts?.map(p => p.type) });
          continue;
        }

        if (/^\[from\s+\w+\]/.test(textPart.text)) {
          log.debug('messagesTransform: already tagged', { index: i, prefix: textPart.text.slice(0, 30) });
          break;
        }

        textPart.text = `[from boss] ${textPart.text}`;
        log.info('messagesTransform: tagged [from boss]', { index: i, preview: textPart.text.slice(0, 50) });
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
        if (existingSystem.includes('<collaboration-rules>')) {
          log.debug('systemTransform: skip duplicate', { sessionID });
          return;
        }

        // 跳过特殊请求
        if (existingSystem.includes('title generator') || existingSystem.includes('You output ONLY')) {
          log.debug('systemTransform: skip special request', { sessionID });
          return;
        }

        const agent = await getCurrentAgent(sessionID);
        if (!agent) {
          log.debug('systemTransform: agent not found', { sessionID });
          return;
        }

        // 注入团队成员
        const teamConfig = loadTeamConfig(agent.team);
        if (teamConfig) {
          const teamPrompt = formatTeamPrompt(teamConfig, agent.name);
          if (teamPrompt) {
            (output.system ||= []).push(teamPrompt);
          }

          // 注入协作规则
          (output.system ||= []).push(getCollaborationRules());
          log.info('systemTransform: injected', { sessionID, agent: agent.full });
        } else {
          log.warn('systemTransform: team config not found', { sessionID, team: agent.team });
        }
      } catch (e) {
        log.error('systemTransform error', { error: e.message });
      }
    },
  };
}
