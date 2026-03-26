/**
 * 任务看板 — 创建/完成/依赖检查/自动通知
 *
 * 通知通过 hub.deliver() 投递到消息队列，由 wrapper 轮询取走注入 CLI。
 */

import { loadTasks, saveTasks } from '../foundation/tasks.js';
import { isAgentInTeam, getTeamLeader } from '../foundation/config.js';
import { createLogger } from '../foundation/logger.js';

const log = createLogger('taskboard');

/**
 * 创建任务（仅 leader 可调，权限校验由 mcp.js 负责）
 * @param {object} params
 * @param {string} params.teamName
 * @param {string} params.projectDir
 * @param {MessageHub} params.hub - 消息中枢
 * @param {string} params.title
 * @param {string} params.description
 * @param {string} params.assignee
 * @param {number[]} params.dependsOn
 * @param {string} params.trace
 * @returns {{ ok: true, task: object, triggered: string[] } | { ok: false, error: string }}
 */
export async function createTask({ teamName, projectDir, hub, title, description, assignee, dependsOn = [], trace }) {
  // 1. 校验 assignee 在团队中
  if (!isAgentInTeam(teamName, assignee)) {
    return { ok: false, error: `团队中没有 "${assignee}"` };
  }

  // 2. 校验 dependsOn 的 ID 都存在
  const data = loadTasks(teamName, projectDir);
  for (const depId of dependsOn) {
    if (!data.tasks.find(t => t.id === depId)) {
      return { ok: false, error: `依赖任务 #${depId} 不存在` };
    }
  }

  // 3. 创建任务
  const task = {
    id: data.nextId,
    title,
    description: description || '',
    assignee,
    dependsOn,
    status: 'pending',
    createdAt: new Date().toISOString(),
    doneAt: null,
  };
  data.tasks.push(task);
  data.nextId++;
  saveTasks(teamName, projectDir, data);

  log.info('task.created', { trace, id: task.id, title, assignee, dependsOn });

  // 4. 检查依赖是否已满足，满足则通知
  const triggered = notifyIfReady(task, data.tasks, hub, trace);

  return { ok: true, task, triggered };
}

/**
 * 完成任务
 * @param {object} params
 * @param {string} params.teamName
 * @param {string} params.projectDir
 * @param {MessageHub} params.hub - 消息中枢
 * @param {string} params.agentName
 * @param {number} params.taskId
 * @param {string} params.trace
 * @returns {{ ok: true, task: object, triggered: string[] } | { ok: false, error: string }}
 */
export async function completeTask({ teamName, projectDir, hub, agentName, taskId, trace }) {
  const data = loadTasks(teamName, projectDir);
  const task = data.tasks.find(t => t.id === taskId);

  if (!task) return { ok: false, error: `任务 #${taskId} 不存在` };
  if (task.assignee !== agentName) return { ok: false, error: `任务 #${taskId} 分配给 ${task.assignee}，不是你` };
  if (task.status === 'done') return { ok: false, error: `任务 #${taskId} 已完成` };

  // 标记完成
  task.status = 'done';
  task.doneAt = new Date().toISOString();
  saveTasks(teamName, projectDir, data);

  log.info('task.done', { trace, id: taskId, agentName });

  // 扫描下游：哪些 pending 任务的 dependsOn 现在全部满足了
  const triggered = [];
  for (const t of data.tasks) {
    if (t.status !== 'pending') continue;
    if (t.dependsOn.length === 0) continue;
    if (!t.dependsOn.includes(taskId)) continue;

    const allDone = t.dependsOn.every(depId => {
      const dep = data.tasks.find(d => d.id === depId);
      return dep && dep.status === 'done';
    });

    if (allDone) {
      const result = notifyAssignee(t, hub, trace);
      triggered.push(`#${t.id} ${t.title} → ${t.assignee} (${result})`);
    }
  }

  // 通知 leader（如果 leader 不是完成任务的人自己）
  const leader = getTeamLeader(teamName);
  if (leader && leader !== agentName) {
    const leaderMsg = `[task #${taskId} done] ${task.title} — ${agentName} 已完成`;
    try {
      hub.deliver({ from: agentName, to: leader, message: leaderMsg });
    } catch (err) {
      log.warn('notifyLeader failed', { trace, taskId, leader, error: err.message });
    }
  }

  return { ok: true, task, triggered };
}

/**
 * 列出所有任务
 */
export function listTasks(teamName, projectDir) {
  const { tasks } = loadTasks(teamName, projectDir);
  return tasks;
}

// ── 内部函数 ──

/**
 * 检查任务依赖是否满足，满足则通知 assignee
 */
function notifyIfReady(task, allTasks, hub, trace) {
  if (task.dependsOn.length === 0) {
    // 无依赖，立即通知
    const result = notifyAssignee(task, hub, trace);
    return [`#${task.id} ${task.title} → ${task.assignee} (${result})`];
  }

  const allDone = task.dependsOn.every(depId => {
    const dep = allTasks.find(d => d.id === depId);
    return dep && dep.status === 'done';
  });

  if (allDone) {
    const result = notifyAssignee(task, hub, trace);
    return [`#${task.id} ${task.title} → ${task.assignee} (${result})`];
  }

  return []; // 依赖未满足，不通知
}

/**
 * 发送任务就绪通知（通知失败不影响任务操作本身）
 */
function notifyAssignee(task, hub, trace) {
  const message = task.description
    ? `[task #${task.id}] ${task.title}：${task.description}`
    : `[task #${task.id}] ${task.title}`;

  try {
    const result = hub.deliver({ from: 'system', to: task.assignee, message });
    return `${task.assignee}: ${result.online ? 'delivered' : 'queued'}`;
  } catch (err) {
    log.warn('notifyAssignee failed', { trace, taskId: task.id, assignee: task.assignee, error: err.message });
    return `${task.assignee}: 通知失败 (${err.message})`;
  }
}
