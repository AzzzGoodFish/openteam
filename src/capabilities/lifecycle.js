/**
 * Agent 生命周期管理 — 身份识别、会话创建/查找/回收/释放/重定向
 */

import { createSession, postMessage, sessionExists, fetchMessages } from '../foundation/opencode.js';
import { createLogger } from '../foundation/logger.js';
import {
  findActiveServeUrl,
  loadActiveSessions,
  saveActiveSessions,
  getAgentInstances,
  findInstance,
  addInstance,
  removeInstance,
} from '../foundation/state.js';
import { listTeams, loadTeamConfig } from '../foundation/config.js';

const log = createLogger('lifecycle');

// ── 身份识别 ──

/**
 * 解析 agent 名称（"team/agent" 或 "agent"）
 * @returns {{ team: string, name: string, full: string } | null}
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
 * 通过 active-sessions 反查 session 对应的团队成员
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
 */
export async function getCurrentAgent(sessionID, timeoutMs = 2000) {
  try {
    // 优先从运行时映射反查，避免被模型 mode 干扰
    const mappedAgent = resolveAgentFromSessionMap(sessionID);
    if (mappedAgent) return mappedAgent;

    const serveUrl = findActiveServeUrl();

    try {
      const messages = await fetchMessages(serveUrl, sessionID, timeoutMs);
      if (!messages || messages.length === 0) return null;

      const lastMsg = messages[messages.length - 1];
      const parsed = parseAgentName(lastMsg?.info?.agent);
      if (parsed) return parsed;

      // 兼容 info.agent 仅返回成员名的场景
      const team = process.env.OPENTEAM_TEAM;
      if (team && lastMsg?.info?.agent) {
        const teamConfig = loadTeamConfig(team);
        if (teamConfig?.agents?.includes(lastMsg.info.agent)) {
          return { team, name: lastMsg.info.agent, full: `${team}/${lastMsg.info.agent}` };
        }
      }

      return null;
    } catch (err) {
      log.error('getCurrentAgent fetchMessages failed', { sessionID, error: err.message });
      return null;
    }
  } catch (err) {
    log.error('getCurrentAgent failed', { sessionID, error: err.message });
    return null;
  }
}

// ── 会话管理 ──

/**
 * 获取已有或创建新 session（创建时发送初始化消息），返回 sessionId
 */
export async function ensureAgent(teamName, agentName, serveUrl, projectDir) {
  // 先找已有 session
  const existingId = await findAgentSession(teamName, agentName, serveUrl, { cwd: projectDir, matchAny: true });
  if (existingId) return existingId;

  // 创建新 session
  const title = `${agentName} 控制台`;
  const metadata = {
    agent: `${teamName}/${agentName}`,
    team: teamName,
    role: agentName,
  };

  const session = await createSession(serveUrl, projectDir, title, metadata);
  if (!session) return null;

  const sessionId = session.id;

  // 发送初始化消息建立 agent 身份标记（不等回复）
  await postMessage(serveUrl, sessionId, projectDir, agentName, '系统初始化完成，准备就绪。', { wait: false });

  // 保存 session 映射
  addInstance(teamName, agentName, { sessionId, cwd: projectDir });

  return sessionId;
}

/**
 * 仅查找已有 session，不创建
 * options: { cwd?, matchAny? }
 *   - cwd: 匹配指定目录
 *   - matchAny: 如果 cwd 匹配失败，允许回退到任意单实例
 */
async function findAgentSession(teamName, agentName, serveUrl, options = {}) {
  const { cwd, matchAny = false } = options;

  // 按 cwd 查找
  if (cwd) {
    const instance = findInstance(teamName, agentName, { cwd });
    if (instance) {
      const exists = await sessionExists(serveUrl, instance.sessionId);
      if (exists) return instance.sessionId;
    }
  }

  // matchAny: 如果只有一个实例，直接返回
  if (matchAny) {
    const instances = getAgentInstances(teamName, agentName);
    if (instances.length === 1) {
      const exists = await sessionExists(serveUrl, instances[0].sessionId);
      if (exists) return instances[0].sessionId;
    }
  }

  // 无 matchAny: 逐一检查实例
  if (!matchAny && cwd) return null;

  const instances = getAgentInstances(teamName, agentName);
  for (const inst of instances) {
    if (cwd && inst.cwd !== cwd) continue;
    const exists = await sessionExists(serveUrl, inst.sessionId);
    if (exists) return inst.sessionId;
  }

  return null;
}

/**
 * 为离线 agent 创建 session 并注册状态（不发初始化消息）
 */
export async function wakeAgent(teamName, agentName, cwd, serveUrl) {
  const metadata = {
    agent: `${teamName}/${agentName}`,
    team: teamName,
    role: agentName,
  };
  const session = await createSession(serveUrl, cwd, `${agentName} 工作区`, metadata);
  if (!session) return null;

  addInstance(teamName, agentName, { sessionId: session.id, cwd });
  return { sessionId: session.id, cwd };
}

/**
 * 校验并清理失效的 session 映射
 */
export async function recoverSessions(teamName, serveUrl) {
  const activeSessions = loadActiveSessions(teamName);
  let recovered = 0;
  let cleaned = 0;

  for (const [agentName, instances] of Object.entries(activeSessions)) {
    const instanceList = Array.isArray(instances)
      ? instances
      : [{ sessionId: instances, cwd: null }];

    const validInstances = [];
    for (const inst of instanceList) {
      const exists = await sessionExists(serveUrl, inst.sessionId);
      if (exists) {
        validInstances.push(inst);
        recovered++;
      } else {
        cleaned++;
      }
    }

    if (validInstances.length > 0) {
      activeSessions[agentName] = validInstances;
    } else {
      delete activeSessions[agentName];
    }
  }

  saveActiveSessions(teamName, activeSessions);
  return { recovered, cleaned };
}

// ── Agent 管控 ──

/**
 * 释放 agent 实例
 */
export function freeAgent(teamName, agentName, options = {}) {
  const { cwd, alias } = options;
  const instances = getAgentInstances(teamName, agentName);

  if (instances.length === 0) return `${agentName} 已经在休息了`;

  if (instances.length > 1 && !cwd && !alias) {
    const list = instances.map((i) => `  - ${i.cwd}${i.alias ? ` @${i.alias}` : ''}`).join('\n');
    return `${agentName} 有多个实例，请指定 cwd 或 alias:\n${list}`;
  }

  if (instances.length === 1) {
    removeInstance(teamName, agentName, { cwd: instances[0].cwd });
  } else {
    removeInstance(teamName, agentName, { cwd, alias });
  }

  return `${agentName} 去休息了`;
}

/**
 * 迁移 agent 到新目录
 */
export async function redirectAgent(teamName, agentName, newCwd, serveUrl, options = {}) {
  const { alias } = options;
  const instances = getAgentInstances(teamName, agentName);

  // 清除所有旧实例
  for (const inst of instances) {
    removeInstance(teamName, agentName, { cwd: inst.cwd });
  }

  const metadata = {
    agent: `${teamName}/${agentName}`,
    team: teamName,
    role: agentName,
  };
  const session = await createSession(serveUrl, newCwd, `${agentName} 工作区`, metadata);
  if (!session) return 'Error: 创建会话失败';

  addInstance(teamName, agentName, { sessionId: session.id, cwd: newCwd, alias });
  return `${agentName} 已切换到 ${newCwd}`;
}

/**
 * 获取状态（who 为空返回全部成员）
 */
export async function getStatus(teamName, serveUrl, who = null) {
  const teamConfig = loadTeamConfig(teamName);
  if (!teamConfig) return 'Error: 团队配置不存在';

  const agents = who ? [who] : teamConfig.agents;
  const lines = [];

  for (const agentName of agents) {
    const instances = getAgentInstances(teamName, agentName);
    if (instances.length === 0) {
      lines.push(`${agentName}: 休息中`);
    } else {
      for (const inst of instances) {
        const aliasHint = inst.alias ? ` @${inst.alias}` : '';
        const valid = await sessionExists(serveUrl, inst.sessionId);
        const status = valid ? '工作中' : '已断开';
        lines.push(`${agentName}${aliasHint}: ${inst.cwd || '(未知目录)'} [${status}]`);
      }
    }
  }

  return lines.join('\n') || '没有团队成员';
}
