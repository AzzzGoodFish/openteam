/**
 * Daemon 的 pane 生命周期管理
 * 创建 agent pane、健康检查、dead pane respawn
 */

import { execSync } from 'child_process';
import {
  addAgentPane,
  cleanMuxEnv,
  listPanes,
  respawnPane,
} from '../../foundation/terminal.js';
import { getAgentInstances } from '../../foundation/state.js';
import { createLogger } from '../../foundation/logger.js';

const log = createLogger('daemon:panes');

/**
 * 为所有 agent 创建 pane
 * @param {string} mux - 复用器类型
 * @param {string} sessionName - mux session 名
 * @param {string[]} agents - agent 列表
 * @param {string} serveUrl - serve URL
 * @param {Map<string, string>} sessionMap - agentName → sessionId
 */
export function createAllAgentPanes(mux, sessionName, agents, serveUrl, sessionMap) {
  let first = true;
  for (const agent of agents) {
    const sessionId = sessionMap.get(agent);
    if (!sessionId) {
      log.warn(`skip pane for ${agent}: no session`);
      continue;
    }
    const cmd = buildAttachCmd(serveUrl, sessionId);

    // 第一个 agent 开新 window，与 daemon pane 0 隔离
    if (first && mux === 'tmux') {
      try {
        const env = cleanMuxEnv();
        execSync(`tmux new-window -t "${sessionName}" -n "${agent}" "${cmd}"`, { stdio: 'ignore', env });
        log.info(`pane created for ${agent} (new window)`);
        first = false;
        continue;
      } catch {
        log.error(`failed to create window for ${agent}`);
        continue;
      }
    }
    first = false;

    const result = addAgentPane(mux, sessionName, cmd, agent);
    if (result) {
      log.info(`pane created for ${agent}`);
    } else {
      log.error(`failed to create pane for ${agent}`);
    }
  }
}

/**
 * 健康检查：检测 dead pane 并 respawn
 * @returns {{ checked: number, respawned: number }}
 */
export function checkAndRespawn(mux, sessionName, teamName, serveUrl) {
  const panes = listPanes(mux, sessionName);
  let checked = 0;
  let respawned = 0;

  for (const pane of panes) {
    // 跳过 daemon 自己的 pane（通常是第一个）
    if (pane.name === 'daemon' || pane.id === panes[0]?.id) continue;
    checked++;

    if (!pane.alive) {
      log.warn(`dead pane detected: ${pane.name || pane.id}`);
      const agentName = pane.name;
      const instances = getAgentInstances(teamName, agentName);
      if (instances.length > 0) {
        const cmd = buildAttachCmd(serveUrl, instances[0].sessionId);
        const ok = respawnPane(mux, sessionName, pane.id, cmd);
        if (ok) {
          log.info(`respawned pane for ${agentName}`);
          respawned++;
        }
      }
    }
  }

  return { checked, respawned };
}

/**
 * 构建 opencode attach 命令
 */
function buildAttachCmd(serveUrl, sessionId) {
  return `opencode attach "${serveUrl}" -s "${sessionId}"`;
}
