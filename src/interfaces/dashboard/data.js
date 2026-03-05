/**
 * Dashboard data fetching logic
 */

import { getRuntime, getServeUrl, loadActiveSessions } from '../../foundation/state.js';
import { loadTeamConfig } from '../../foundation/config.js';
import { sessionExists, fetchSession, fetchMessages } from '../../foundation/opencode.js';

/**
 * 获取团队状态数据
 */
export async function fetchTeamStatus(teamName) {
  const runtime = getRuntime(teamName);

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
    url: getServeUrl(teamName),
    pid: runtime.serve?.pid || runtime.pid,
    leader,
    projectDir: runtime.projectDir || 'N/A',
    started: runtime.started,
  };
}

/**
 * 获取 Agent 状态数据
 */
export async function fetchAgentStatus(teamName, serveUrl) {
  const activeSessions = loadActiveSessions(teamName);
  const agentStatuses = [];

  for (const [agent, instances] of Object.entries(activeSessions)) {
    const instanceList = Array.isArray(instances)
      ? instances
      : [{ sessionId: instances, cwd: null }];

    for (const inst of instanceList) {
      try {
        const exists = await sessionExists(serveUrl, inst.sessionId);
        const session = exists ? await fetchSession(serveUrl, inst.sessionId) : null;

        agentStatuses.push({
          name: agent,
          sessionId: inst.sessionId,
          cwd: inst.cwd || 'N/A',
          online: exists,
          title: session?.title || 'Unknown',
        });
      } catch (err) {
        agentStatuses.push({
          name: agent,
          sessionId: inst.sessionId,
          cwd: inst.cwd || 'N/A',
          online: false,
          title: 'Error',
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
export async function fetchMessageStream(teamName, serveUrl, limit = 20) {
  try {
    const activeSessions = loadActiveSessions(teamName);
    const sessionEntries = [];
    for (const [agent, instances] of Object.entries(activeSessions)) {
      const instanceList = Array.isArray(instances)
        ? instances
        : [{ sessionId: instances }];
      for (const inst of instanceList) {
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
 * 从消息对象中提取第一段文本
 */
function extractFirstText(msg) {
  if (msg.parts && Array.isArray(msg.parts)) {
    const textPart = msg.parts.find(p => p.type === 'text' && p.text);
    return textPart?.text || '';
  }
  return '';
}
