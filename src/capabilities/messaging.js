/**
 * Agent 间通信（消息投递 + 广播）+ 团队上下文注入
 */

import { wakeAgent, getCurrentAgent } from './lifecycle.js';
import { sessionExists, postMessage } from '../foundation/opencode.js';
import { getAgentInstances } from '../foundation/state.js';
import { loadTeamConfig } from '../foundation/config.js';
import { createLogger } from '../foundation/logger.js';

const log = createLogger('messaging');

// ── 消息投递 ──

/**
 * 向指定 agent 发送消息
 *
 * @param {object} params
 * @param {{ team, name, full }} params.from - 发送者身份
 * @param {string} params.to - 目标 agent 名称
 * @param {string} params.message - 消息内容
 * @param {string} params.teamName
 * @param {string} params.serveUrl
 * @returns {Promise<string>} 结果描述
 */
export async function sendMessage({ from, to, message, teamName, serveUrl }) {
  const defaultCwd = getAgentInstances(teamName, from.name)[0]?.cwd || process.cwd();
  let instances = getAgentInstances(teamName, to);
  let wasWoken = false;

  // 唤醒离线 agent
  if (instances.length === 0) {
    const wakeResult = await wakeAgent(teamName, to, defaultCwd, serveUrl);
    if (wakeResult) {
      instances = [wakeResult];
      wasWoken = true;
      log.info(`[${to}] event=agent_wake`);
    } else {
      return `${to}: 唤醒失败`;
    }
  }

  // 投递消息到第一个可用实例
  let sent = false;

  for (const inst of instances) {
    const exists = await sessionExists(serveUrl, inst.sessionId);
    if (!exists) continue;

    try {
      const result = await postMessage(
        serveUrl, inst.sessionId, inst.cwd, to,
        `[from ${from.name}] ${message}`, { wait: false }
      );
      sent = !!result;
    } catch {
      // ignore
    }
    break;
  }

  if (!sent) return `${to}: 发送失败`;
  return wasWoken ? `${to}: 已唤醒` : `${to}: 已通知`;
}

/**
 * 向所有成员广播（排除发送者自己）
 */
export async function broadcast({ from, message, teamName, serveUrl }) {
  const teamConfig = loadTeamConfig(teamName);
  if (!teamConfig) return 'Error: 团队配置不存在';

  const targets = teamConfig.agents.filter((a) => a !== from.name);
  const results = [];

  for (const target of targets) {
    const result = await sendMessage({ from, to: target, message, teamName, serveUrl });
    results.push(result);
  }

  return results.join('\n') || '没有可通知的人';
}

// ── 团队上下文 ──

/**
 * 在最后一条无标记 user 消息前添加 [from boss]
 * 直接修改 messages 数组
 */
export function tagBossMessage(messages) {
  if (!messages || messages.length === 0) return;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.info?.role !== 'user') continue;

    const textPart = msg.parts?.find((p) => p.type === 'text' && !p.synthetic);
    if (!textPart?.text) continue;

    if (/^\[from\s+\w+\]/.test(textPart.text)) break;

    textPart.text = `[from boss] ${textPart.text}`;
    log.info('tagged [from boss]', { index: i, preview: textPart.text.slice(0, 50) });
    break;
  }
}

/**
 * 向 system prompt 注入团队成员 + 协作规则
 * 直接修改 output.system
 */
export async function injectTeamContext(sessionID, output) {
  try {
    const existingSystem = output.system?.join?.('') || output.system || '';

    // 防止双份注入
    if (existingSystem.includes('<collaboration-rules>')) return;

    // 跳过特殊请求
    if (existingSystem.includes('title generator') || existingSystem.includes('You output ONLY')) return;

    const agent = await getCurrentAgent(sessionID);
    if (!agent) return;

    const teamConfig = loadTeamConfig(agent.team);
    if (!teamConfig) {
      log.warn('team config not found', { sessionID, team: agent.team });
      return;
    }

    const teamPrompt = formatTeamPrompt(teamConfig, agent.name);
    if (teamPrompt) {
      (output.system ||= []).push(teamPrompt);
    }

    (output.system ||= []).push(getCollaborationRules());
    log.info('injected team context', { sessionID, agent: agent.full });
  } catch (e) {
    log.error('injectTeamContext error', { error: e.message });
  }
}

/**
 * 格式化团队成员提示词
 */
function formatTeamPrompt(teamConfig, currentAgentName) {
  if (!teamConfig?.agents?.length) return '';

  const teamMembers = teamConfig.agents
    .map((a) => (a === currentAgentName ? `- \`${a}\` (你)` : `- \`${a}\``))
    .join('\n');

  return `<team>\n团队成员：\n${teamMembers}\n</team>`;
}

/**
 * 获取协作规则全文
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
