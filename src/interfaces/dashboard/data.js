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
    url: runtime.serve ? `http://${runtime.serve.host}:${runtime.serve.port}` : 'N/A',
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
        pending: info?.pending || 0,
        activity: info?.online ? 'active' : 'offline',
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
 * v2: hub 是纯内存队列，pull 是消耗性的，无持久化历史。
 * Dashboard 消息流改为显示最近任务通知 + 占位说明。
 * 未来可在 hub 中添加消息历史 ring buffer。
 */
export async function fetchMessageStream(teamName, projectDir, serveUrl, limit = 20) {
  // v2: 消息历史需要 hub 支持 ring buffer（暂未实现）
  // 暂用任务事件作为消息流的补充数据源
  try {
    const { tasks } = loadTasks(teamName, projectDir);
    const events = [];

    for (const task of tasks) {
      // 任务创建事件
      if (task.createdAt) {
        events.push({
          timestamp: task.createdAt,
          from: 'system',
          to: task.assignee,
          content: `[task #${task.id}] ${task.title}`,
          fullContent: task.description ? `[task #${task.id}] ${task.title}：${task.description}` : `[task #${task.id}] ${task.title}`,
        });
      }
      // 任务完成事件
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
