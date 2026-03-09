/**
 * Dashboard data fetching logic
 */

import { getRuntime, getServeUrl, loadActiveSessions } from '../../foundation/state.js';
import { loadTeamConfig } from '../../foundation/config.js';
import { sessionExists, fetchSession, fetchMessages } from '../../foundation/opencode.js';
import { loadTasks } from '../../foundation/tasks.js';

/**
 * 获取团队状态数据
 */
export async function fetchTeamStatus(teamName, projectDir) {
  const runtime = getRuntime(teamName, projectDir);

  if (!runtime) {
    return {
      running: false,
      error: '团队未启动'
    };
  }

  const teamConfig = loadTeamConfig(teamName);
  const leader = teamConfig?.leader || 'N/A';

  return {
    running: true,
    url: getServeUrl(teamName, projectDir),
    pid: runtime.servePid,
    leader,
    projectDir: runtime.projectDir || 'N/A',
    started: runtime.started,
  };
}

/**
 * 获取 Agent 状态数据
 */
export async function fetchAgentStatus(teamName, projectDir, serveUrl) {
  const activeSessions = loadActiveSessions(teamName, projectDir);
  const agentStatuses = [];

  for (const [agent, instances] of Object.entries(activeSessions)) {
    for (const inst of instances) {
      try {
        const exists = await sessionExists(serveUrl, inst.sessionId);
        const session = exists ? await fetchSession(serveUrl, inst.sessionId) : null;
        const activity = exists ? await detectAgentActivity(serveUrl, inst.sessionId) : 'idle';

        agentStatuses.push({
          name: agent,
          sessionId: inst.sessionId,
          cwd: inst.cwd || 'N/A',
          online: exists,
          title: session?.title || 'Unknown',
          activity,
        });
      } catch (err) {
        agentStatuses.push({
          name: agent,
          sessionId: inst.sessionId,
          cwd: inst.cwd || 'N/A',
          online: false,
          title: 'Error',
          activity: 'idle',
          error: err.message,
        });
      }
    }
  }

  return agentStatuses;
}

/**
 * 获取消息流数据
 */
export async function fetchMessageStream(teamName, projectDir, serveUrl, limit = 20) {
  try {
    const activeSessions = loadActiveSessions(teamName, projectDir);
    const sessionEntries = [];
    for (const [agent, instances] of Object.entries(activeSessions)) {
      for (const inst of instances) {
        sessionEntries.push({ sessionId: inst.sessionId, agent });
      }
    }

    if (sessionEntries.length === 0) return [];

    const allMessages = [];

    for (const { sessionId, agent } of sessionEntries) {
      try {
        const messages = await fetchMessages(serveUrl, sessionId);
        if (!messages) continue;

        for (const msg of messages) {
          const role = msg.info?.role;
          const created = msg.info?.time?.created;
          if (!created) continue;
          const timestamp = new Date(created).toISOString();

          if (role === 'user') {
            const text = extractFirstText(msg);
            if (!text) continue;
            if (text === '系统初始化完成，准备就绪。') continue;

            const fromMatch = text.match(/^\[from\s+([^\]]+)\]/);
            const from = fromMatch ? fromMatch[1] : 'boss';
            const content = text.replace(/^\[from\s+[^\]]+\]\s*/, '');
            const to = agent;

            allMessages.push({
              timestamp,
              from,
              to,
              content: content.slice(0, 200),
              fullContent: content,
            });
          } else if (role === 'assistant') {
            const toolParts = msg.parts?.filter(p => p.type === 'tool') || [];
            for (const t of toolParts) {
              if (t.tool !== 'msg') continue;
              const input = t.state?.input;
              if (!input?.message) continue;

              const toolTime = t.state?.time?.start;
              const toolTs = toolTime ? new Date(toolTime).toISOString() : timestamp;

              allMessages.push({
                timestamp: toolTs,
                from: agent,
                to: input.who || input.to || '?',
                content: input.message.slice(0, 200),
                fullContent: input.message,
              });
            }
          }
        }
      } catch (err) {
        // 忽略单个会话的错误
      }
    }

    // 去重
    const seen = new Set();
    const deduped = allMessages.filter(m => {
      const key = `${m.from}:${m.content.slice(0, 30)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    deduped.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return deduped.slice(-limit);
  } catch (err) {
    return [];
  }
}

/**
 * 获取任务看板数据
 */
export function fetchTaskBoard(teamName, projectDir) {
  const { tasks } = loadTasks(teamName, projectDir);
  return tasks;
}

/**
 * 检测 agent 活动状态
 *
 * 规则（基于最后一条消息）：
 * - 无消息 → idle（刚创建）
 * - assistant + finish → idle（待机，已完成回复）
 * - assistant 无 finish → outputting（输出中，正在生成）
 * - user → thinking（思考中，等待模型响应）
 */
async function detectAgentActivity(serveUrl, sessionId) {
  try {
    const messages = await fetchMessages(serveUrl, sessionId);
    if (!messages || messages.length === 0) return 'idle';

    const last = messages[messages.length - 1];
    const role = last.info?.role;

    if (role === 'user') return 'thinking';
    if (role === 'assistant') {
      return last.info?.finish ? 'idle' : 'outputting';
    }
    return 'idle';
  } catch {
    return 'idle';
  }
}

/**
 * 从消息对象中提取第一段文本
 */
function extractFirstText(msg) {
  if (msg.parts && Array.isArray(msg.parts)) {
    const textPart = msg.parts.find(p => p.type === 'text' && p.text);
    return textPart?.text || '';
  }
  return '';
}
