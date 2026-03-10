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
 * 通用消息投递 — 投递一条消息给 agent，带唤醒能力，不加任何前缀
 *
 * 与 sendMessage 的区别：
 * - 没有 from 参数
 * - 不拼接 [from xxx] 前缀，消息原样投递
 * - callerCwd 可选，用于唤醒时的 defaultCwd（无则用 projectDir）
 *
 * @returns {Promise<string>} 结果描述
 */
export async function deliverMessage({ to, message, teamName, projectDir, serveUrl, trace, callerCwd }) {
  const defaultCwd = callerCwd || projectDir;
  let instances = getAgentInstances(teamName, projectDir, to);
  let wasWoken = false;

  log.info('deliverMessage.start', {
    trace,
    to,
    teamName,
    serveUrl,
    defaultCwd,
    instanceCount: instances.length,
  });

  // 唤醒离线 agent
  if (instances.length === 0) {
    const wakeResult = await wakeAgent(teamName, to, defaultCwd, serveUrl, projectDir, { trace, reason: 'deliverMessage' });
    if (wakeResult) {
      instances = [wakeResult];
      wasWoken = true;
      log.info(`[${to}] event=agent_wake`, { trace, sessionId: wakeResult.sessionId, cwd: wakeResult.cwd });
    } else {
      return `${to}: 唤醒失败 [trace=${trace}]`;
    }
  }

  // 投递消息到第一个可用实例
  let sent = false;
  let lastError = '';

  for (const inst of instances) {
    log.info('deliverMessage.checkInstance', {
      trace,
      to,
      sessionId: inst.sessionId,
      cwd: inst.cwd,
    });
    let exists;
    try {
      exists = await sessionExists(serveUrl, inst.sessionId, { trace, reason: 'deliverMessage' });
    } catch (err) {
      lastError = `sessionExists threw: ${err.message}`;
      log.error('deliverMessage.sessionExists threw', { trace, to, sessionId: inst.sessionId, error: err.message });
      continue;
    }
    if (!exists) {
      lastError = `session ${inst.sessionId} not found on ${serveUrl}`;
      log.warn('deliverMessage.instanceMissing', { trace, to, sessionId: inst.sessionId, serveUrl });
      continue;
    }

    try {
      // 使用 projectDir 作为 HTTP directory（serve 的 bootstrapped 目录），避免 InstanceBootstrap 挂起
      const result = await postMessage(
        serveUrl, inst.sessionId, projectDir, to,
        message, { wait: false, trace }
      );
      sent = !!result;
      if (!sent) lastError = `postMessage returned falsy`;
      log.info('deliverMessage.postMessage.done', {
        trace,
        to,
        sessionId: inst.sessionId,
        sent,
      });
    } catch (err) {
      lastError = `postMessage threw: ${err.message}`;
      log.error('postMessage failed', { trace, to, sessionId: inst.sessionId, error: err.message });
    }
    break;
  }

  if (!sent) return `${to}: 发送失败 [trace=${trace}, instances=${instances.length}, serveUrl=${serveUrl}, ${lastError}]`;
  return wasWoken ? `${to}: 已唤醒 [trace=${trace}]` : `${to}: 已通知 [trace=${trace}]`;
}

/**
 * 向指定 agent 发送消息（带 [from xxx] 前缀）
 *
 * @param {object} params
 * @param {{ team, name, full }} params.from - 发送者身份
 * @param {string} params.to - 目标 agent 名称
 * @param {string} params.message - 消息内容
 * @param {string} params.teamName
 * @param {string} params.serveUrl
 * @returns {Promise<string>} 结果描述
 */
export async function sendMessage({ from, to, message, teamName, projectDir, serveUrl, trace }) {
  const callerCwd = getAgentInstances(teamName, projectDir, from.name)[0]?.cwd || undefined;
  const prefixedMessage = `[from ${from.name}] ${message}`;
  return deliverMessage({ to, message: prefixedMessage, teamName, projectDir, serveUrl, trace, callerCwd });
}

/**
 * 向所有成员广播（排除发送者自己）
 */
export async function broadcast({ from, message, teamName, projectDir, serveUrl, trace }) {
  const teamConfig = loadTeamConfig(teamName);
  if (!teamConfig) return 'Error: 团队配置不存在';

  const targets = teamConfig.agents.filter((a) => a !== from.name);
  const results = [];

  log.info('broadcast.start', { trace, from: from.name, targets, teamName, serveUrl });

  for (const target of targets) {
    const result = await sendMessage({ from, to: target, message, teamName, projectDir, serveUrl, trace });
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
## Team Collaboration Rules

### Message Sources
- \`[from xxx]\` prefix identifies the sender
- \`[from boss]\` = direct instruction from the boss, highest priority
- \`[from <agent>]\` = message from another agent (e.g., architect, developer)

### Communication
- **Your text output is invisible to other agents** — use the \`msg\` tool to communicate
- When you receive \`[from <agent>]\`, reply with \`msg\` so they can see your response

### Boss Messages (IMPORTANT)
- When you receive \`[from boss]\`, **reply directly in your output** — boss is in your session, not an agent
- **NEVER** use \`msg(who="boss", ...)\` — msg is only for team agents
- Boss can see your output directly, no tool needed

### Task Reporting (IMPORTANT)
- **After completing a task, use \`msg\` to report results to whoever assigned it**
- Include: what was done, key outputs, any remaining issues
- No report = the assigner doesn't know you finished, collaboration breaks

### Task System
- A message starting with \`[task #N]\` means you have a new task ready — start working on it
- When done, call \`taskboard(action="done", id=N)\` to mark complete — the system auto-notifies downstream
- Use \`taskboard(action="list")\` to view all tasks and their status
- After marking a task done, no extra msg report is needed (system handles flow automatically)
</collaboration-rules>`;
}
