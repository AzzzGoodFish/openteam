/**
 * Dashboard data fetching logic
 */

import { getRuntime, loadActiveSessions } from '../team/serve.js';
import { loadTeamConfig } from '../team/config.js';
import { sessionExists, fetchSession, fetchMessages } from '../utils/api.js';

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
    url: `http://${runtime.host}:${runtime.port}`,
    pid: runtime.pid,
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
 *
 * 只展示团队通信消息，包括：
 * 1. user 消息带 [from xxx] 前缀的 — 成员间通信（msg 工具投递的）
 * 2. user 消息不带 [from xxx] 的 — boss 输入
 * 3. assistant 消息中的 msg 工具调用 — agent 主动发出的消息
 *
 * 不展示 agent 自己思考的中间文本。
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
            // user 消息：boss 输入或 [from xxx] 团队通信
            const text = extractFirstText(msg);
            if (!text) continue;
            // 跳过系统初始化消息
            if (text === '系统初始化完成，准备就绪。') continue;

            const fromMatch = text.match(/^\[from\s+([^\]]+)\]/);
            const from = fromMatch ? fromMatch[1] : 'boss';
            const content = text.replace(/^\[from\s+[^\]]+\]\s*/, '');
            const to = fromMatch ? agent : agent; // 收件人是这个 session 的 agent

            allMessages.push({
              timestamp,
              from,
              to,
              content: content.slice(0, 200),
              fullContent: content,
            });
          } else if (role === 'assistant') {
            // assistant 消息：只提取 msg 工具调用（agent 发出的消息）
            const toolParts = msg.parts?.filter(p => p.type === 'tool') || [];
            for (const t of toolParts) {
              if (t.tool !== 'msg') continue;
              const input = t.state?.input;
              if (!input?.message) continue;

              // msg 工具调用的时间用 tool state 的 time，没有就用消息时间
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

    // 去重：同一条 msg 在发送方和接收方都会出现，按内容+时间去重
    const seen = new Set();
    const deduped = allMessages.filter(m => {
      // 用 from+content前30字符 做去重 key
      const key = `${m.from}:${m.content.slice(0, 30)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 按时间排序（最新的在后）
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
