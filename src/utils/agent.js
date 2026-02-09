/**
 * Agent 身份识别工具
 *
 * 从 session 消息中解析当前 agent 身份，供 hooks 和 tools 共用。
 */

import { findActiveServeUrl } from '../team/serve.js';
import { loadActiveSessions } from '../team/serve.js';
import { listTeams, loadTeamConfig } from '../team/config.js';

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
 * 通过 active-sessions 反查 session 对应的团队成员
 * @param {string} sessionID
 * @returns {{ team: string, name: string, full: string } | null}
 */
function resolveAgentFromSessionMap(sessionID) {
  const preferredTeam = process.env.OPENTEAM_TEAM;
  const teams = preferredTeam ? [preferredTeam] : listTeams();

  for (const team of teams) {
    const sessions = loadActiveSessions(team);

    for (const [agentName, instances] of Object.entries(sessions)) {
      if (typeof instances === 'string') {
        if (instances === sessionID) {
          return { team, name: agentName, full: `${team}/${agentName}` };
        }
        continue;
      }

      if (!Array.isArray(instances)) continue;
      if (instances.some((inst) => inst?.sessionId === sessionID)) {
        return { team, name: agentName, full: `${team}/${agentName}` };
      }
    }
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
    // 优先从运行时映射反查，避免被模型 mode（如 build）干扰
    const mappedAgent = resolveAgentFromSessionMap(sessionID);
    if (mappedAgent) return mappedAgent;

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
      const parsed = parseAgentName(lastMsg?.info?.agent);
      if (parsed) return parsed;

      // 兼容某些场景下 info.agent 仅返回成员名（无 team 前缀）
      const team = process.env.OPENTEAM_TEAM;
      if (team && lastMsg?.info?.agent) {
        const teamConfig = loadTeamConfig(team);
        if (teamConfig?.agents?.includes(lastMsg.info.agent)) {
          return { team, name: lastMsg.info.agent, full: `${team}/${lastMsg.info.agent}` };
        }
      }

      return null;
    } catch {
      clearTimeout(timeoutId);
      return null;
    }
  } catch {
    return null;
  }
}
