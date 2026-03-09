/**
 * 任务看板 — 创建/完成/依赖检查/自动通知
 */

import { loadTasks, saveTasks } from '../foundation/tasks.js';
import { deliverMessage } from './messaging.js';
import { isAgentInTeam } from '../foundation/config.js';
import { createLogger } from '../foundation/logger.js';

const log = createLogger('taskboard');

/**
 * 创建任务（仅 leader 可调，权限校验由 tools.js 负责）
 * @returns {{ ok: true, task: object, triggered: string[] } | { ok: false, error: string }}
 */
export async function createTask({ teamName, projectDir, serveUrl, title, description, assignee, dependsOn = [], trace }) {
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
  const triggered = await notifyIfReady(task, data.tasks, teamName, projectDir, serveUrl, trace);

  return { ok: true, task, triggered };
}

/**
 * 完成任务
 * @returns {{ ok: true, task: object, triggered: string[] } | { ok: false, error: string }}
 */
export async function completeTask({ teamName, projectDir, serveUrl, agentName, taskId, trace }) {
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
    if (!t.dependsOn.includes(taskId)) continue; // 不依赖刚完成的任务，跳过

    const allDone = t.dependsOn.every(depId => {
      const dep = data.tasks.find(d => d.id === depId);
      return dep && dep.status === 'done';
    });

    if (allDone) {
      const result = await notifyAssignee(t, teamName, projectDir, serveUrl, trace);
      triggered.push(`#${t.id} ${t.title} → ${t.assignee} (${result})`);
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
async function notifyIfReady(task, allTasks, teamName, projectDir, serveUrl, trace) {
  if (task.dependsOn.length === 0) {
    // 无依赖，立即通知
    const result = await notifyAssignee(task, teamName, projectDir, serveUrl, trace);
    return [`#${task.id} ${task.title} → ${task.assignee} (${result})`];
  }

  const allDone = task.dependsOn.every(depId => {
    const dep = allTasks.find(d => d.id === depId);
    return dep && dep.status === 'done';
  });

  if (allDone) {
    const result = await notifyAssignee(task, teamName, projectDir, serveUrl, trace);
    return [`#${task.id} ${task.title} → ${task.assignee} (${result})`];
  }

  return []; // 依赖未满足，不通知
}

/**
 * 发送任务就绪通知（通知失败不影响任务操作本身）
 */
async function notifyAssignee(task, teamName, projectDir, serveUrl, trace) {
  const message = task.description
    ? `[task #${task.id}] ${task.title}：${task.description}`
    : `[task #${task.id}] ${task.title}`;

  try {
    return await deliverMessage({ to: task.assignee, message, teamName, projectDir, serveUrl, trace });
  } catch (err) {
    log.warn('notifyAssignee failed', { trace, taskId: task.id, assignee: task.assignee, error: err.message });
    return `${task.assignee}: 通知失败 (${err.message})`;
  }
}
