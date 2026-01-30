/**
 * Agent 身份识别工具
 *
 * 从 session 消息中解析当前 agent 身份，供 hooks 和 tools 共用。
 */

import { findActiveServeUrl } from '../team/serve.js';

/**
 * 解析 agent 名称（"team/agent" 或 "agent"）
 * @returns {{ team: string, name: string, full: string } | null}
 */
export function parseAgentName(agentName, defaultTeam = null) {
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
 * 从 session 消息中获取当前 agent 身份
 * @param {string} sessionID
 * @param {number} timeoutMs - 超时时间（默认 2000ms）
 * @returns {Promise<{ team: string, name: string, full: string } | null>}
 */
export async function getCurrentAgent(sessionID, timeoutMs = 2000) {
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
