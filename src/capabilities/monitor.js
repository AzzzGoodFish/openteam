/**
 * 终端监控会话的编排 — 创建、附加、动态扩展
 */

import {
  detectMultiplexer,
  hasSession,
  createSession,
  attachSession,
  launchZellijSession,
  addPane,
} from '../foundation/terminal.js';
import { isServeRunning, setMonitorInfo, getMonitorInfo, clearMonitorInfo } from '../foundation/state.js';
import { loadTeamConfig } from '../foundation/config.js';
import { getAgentInstances } from '../foundation/state.js';

/**
 * 启动监控会话
 * options: { dir?, tmux?, zellij? }
 */
export async function startMonitor(teamName, options = {}) {
  const teamConfig = loadTeamConfig(teamName);
  if (!teamConfig) {
    throw new Error(`团队配置不存在`);
  }

  const agents = teamConfig.agents || [];
  if (agents.length === 0) {
    throw new Error('团队没有配置任何 agent');
  }

  // 检测 mux
  const mux = detectMultiplexer(options);
  if (!mux) {
    throw new Error('未找到 tmux 或 zellij，请先安装其中一个');
  }

  // 确认团队运行中
  if (!isServeRunning(teamName)) {
    throw new Error(`团队 ${teamName} 未运行`);
  }

  const sessionName = `openteam-${teamName}`;

  // 检查已有会话
  if (hasSession(mux, sessionName)) {
    attachSession(mux, sessionName);
    return { mux, sessionName, attached: true };
  }

  // 记录 monitor 信息
  setMonitorInfo(teamName, { mux, sessionName });

  // 创建并附加
  if (mux === 'tmux') {
    createSession(mux, sessionName, teamName, agents);
    attachSession(mux, sessionName);
  } else {
    launchZellijSession(sessionName, teamName, agents);
  }

  // 退出后清理 monitor 信息
  clearMonitorInfo(teamName);

  return { mux, sessionName, attached: false };
}

/**
 * 为新唤醒 agent 添加监控 pane
 */
export function addPaneForAgent(teamName, agentName, cwd) {
  const monitorInfo = getMonitorInfo(teamName);
  if (!monitorInfo) return false;

  const teamConfig = loadTeamConfig(teamName);
  const isInTeam = teamConfig?.agents?.includes(agentName);
  const instances = getAgentInstances(teamName, agentName);

  // 只在新增实例时添加 pane
  if (isInTeam && instances.length <= 1) return false;

  const { mux, sessionName } = monitorInfo;
  return addPane(mux, sessionName, teamName, agentName, cwd);
}
