/**
 * Dashboard data fetching logic
 *
 * v2: 数据源从 opencode API 切换到 openteam server REST API
 * - Agent 状态: GET /api/status
 * - 任务列表: GET /api/tasks
 * - 消息流: 暂无持久化历史，从 hub status 推断
 */

import { getRuntime } from '../../foundation/state.js';
import { loadTeamConfig } from '../../foundation/config.js';
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
    url: runtime.server ? `http://${runtime.server.host}:${runtime.server.port}` : 'N/A',
    daemonPid: runtime.daemonPid || 'N/A',
    leader,
    projectDir: runtime.projectDir || projectDir || 'N/A',
    started: runtime.started,
  };
}

/**
 * 获取 Agent 状态数据
 *
 * 从 server REST API /api/status 获取 agent 在线状态。
 * 返回格式与旧版兼容（UI 不需要改）。
 */
export async function fetchAgentStatus(teamName, projectDir, serveUrl) {
  try {
    const res = await fetch(`${serveUrl}/api/status`);
    if (!res.ok) return [];
    const data = await res.json();
    const status = data.status || {};

    // 补充团队中所有 agent（即使未注册的也显示为 offline）
    const teamConfig = loadTeamConfig(teamName);
    const agents = teamConfig?.agents || [];

    return agents.map(agent => {
      const info = status[agent];
      return {
        name: agent,
        online: info?.online || false,
        active: info?.active || false,
        pending: info?.pending || 0,
      };
    });
  } catch {
    // server 不可达，返回空
    return [];
  }
}

/**
 * 获取消息流数据
 *
 * v2: 从 hub 消息日志 API 获取真实消息历史。
 * 回退：API 不可用时降级到任务事件。
 */
export async function fetchMessageStream(teamName, projectDir, serveUrl, limit = 20) {
  // 优先从 hub 消息日志获取
  try {
    const res = await fetch(`${serveUrl}/api/messages/log?limit=${limit}`);
    if (res.ok) {
      const data = await res.json();
      const messages = data.messages || [];
      if (messages.length > 0) {
        return messages.map(m => ({
          timestamp: m.timestamp,
          from: m.from,
          to: m.to,
          content: m.message.replace(/\n/g, ' ').slice(0, 80),
          fullContent: m.message,
        }));
      }
    }
  } catch {
    // API 不可用，降级到任务事件
  }

  // 降级：用任务事件填充
  try {
    const { tasks } = loadTasks(teamName, projectDir);
    const events = [];

    for (const task of tasks) {
      if (task.createdAt) {
        events.push({
          timestamp: task.createdAt,
          from: 'system',
          to: task.assignee,
          content: `[task #${task.id}] ${task.title}`,
          fullContent: task.description ? `[task #${task.id}] ${task.title}：${task.description}` : `[task #${task.id}] ${task.title}`,
        });
      }
      if (task.doneAt) {
        events.push({
          timestamp: task.doneAt,
          from: task.assignee,
          to: 'system',
          content: `✓ #${task.id} ${task.title}`,
          fullContent: `[task #${task.id} done] ${task.title}`,
        });
      }
    }

    events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    return events.slice(-limit);
  } catch {
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
