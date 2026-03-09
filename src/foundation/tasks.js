/**
 * 任务数据持久化 — 纯 CRUD，不含业务逻辑
 */

import fs from 'fs';
import path from 'path';
import { FILES, getTeamStateDir } from './constants.js';

/**
 * 读取任务数据
 * @returns {{ nextId: number, tasks: Array }}
 */
export function loadTasks(teamName, projectDir) {
  const filePath = path.join(getTeamStateDir(teamName, projectDir), FILES.TASKS);
  if (!fs.existsSync(filePath)) return { nextId: 1, tasks: [] };
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { nextId: 1, tasks: [] };
  }
}

/**
 * 保存任务数据
 */
export function saveTasks(teamName, projectDir, data) {
  const stateDir = getTeamStateDir(teamName, projectDir);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(stateDir, FILES.TASKS),
    JSON.stringify(data, null, 2)
  );
}

/**
 * 按 ID 获取单个任务
 * @returns {object|null}
 */
export function getTask(teamName, projectDir, id) {
  const { tasks } = loadTasks(teamName, projectDir);
  return tasks.find(t => t.id === id) || null;
}
