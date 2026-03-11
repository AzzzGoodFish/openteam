/**
 * Daemon 的 pane 生命周期管理
 * 创建 agent pane（每个运行 wrapper）、健康检查、dead pane respawn
 */

import { execSync } from 'child_process';
import {
  addAgentPane,
  addStackedTab,
  cleanMuxEnv,
  listPanes,
  respawnPane,
} from '../../foundation/terminal.js';
import { createLogger } from '../../foundation/logger.js';

const log = createLogger('daemon:panes');

/**
 * 为所有 agent 创建 pane（每个 pane 运行 wrapper）
 *
 * zellij: 一个 stacked tab，所有 agent 折叠在一起，leader 默认展开
 * tmux:   每个 agent 一个 window（无 stacked 概念）
 *
 * @param {string} mux - 复用器类型
 * @param {string} sessionName - mux session 名
 * @param {string[]} agents - agent 列表
 * @param {object} wrapperOptions - wrapper 所需的环境信息
 * @param {string} wrapperOptions.serverUrl - openteam server 地址
 * @param {string} wrapperOptions.teamName - 团队名称
 * @param {string} wrapperOptions.projectDir - 项目目录
 * @param {string} wrapperOptions.cliType - CLI 类型（claude-code / opencode）
 * @param {object} [options]
 * @param {string} [options.leaderName] - leader 名称（zellij stacked 模式下默认展开）
 */
export function createAllAgentPanes(mux, sessionName, agents, wrapperOptions, options = {}) {
  const { leaderName } = options;

  if (mux === 'zellij') {
    // zellij: 所有 agent 放入一个 stacked tab，leader 默认展开
    const panes = agents.map(agent => ({
      name: agent,
      cmd: buildWrapperCmd(agent, wrapperOptions, { mux, sessionName }),
      expanded: agent === leaderName,
    }));

    if (panes.length > 0) {
      const ok = addStackedTab(sessionName, 'team', panes);
      if (ok) {
        log.info(`stacked tab created with ${panes.length} agents`);
      } else {
        log.error('failed to create stacked tab');
      }
    }
    return;
  }

  // tmux: 每个 agent 一个 window
  let first = true;
  for (const agent of agents) {
    const cmd = buildWrapperCmd(agent, wrapperOptions, { mux, sessionName });

    // 第一个 agent 开新 window，与 daemon pane 0 隔离
    if (first) {
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
export function checkAndRespawn(mux, sessionName, wrapperOptions) {
  const panes = listPanes(mux, sessionName);
  let checked = 0;
  let respawned = 0;

  for (const pane of panes) {
    // tmux 的第一个 pane 是 daemon；zellij 只跳过显式命名的 daemon tab
    if (pane.name === 'daemon' || (mux === 'tmux' && pane.id === panes[0]?.id)) continue;
    checked++;

    if (!pane.alive) {
      const agentName = pane.name;
      log.warn(`dead pane detected: ${agentName || pane.id}`);
      const cmd = buildWrapperCmd(agentName, wrapperOptions, { mux, sessionName });
      const ok = respawnPane(mux, sessionName, pane.id, cmd);
      if (ok) {
        log.info(`respawned pane for ${agentName}`);
        respawned++;
      }
    }
  }

  return { checked, respawned };
}

/**
 * 构建 wrapper 启动命令
 *
 * wrapper 通过环境变量获取所有配置，无需命令行参数。
 * 环境变量在 pane 启动命令中通过 env 前缀设置。
 *
 * @param {string} agent - agent 名称
 * @param {object} wrapperOptions - wrapper 环境信息
 * @param {object} muxInfo - { mux, sessionName }
 * @returns {string} shell 命令
 */
export function buildWrapperCmd(agent, wrapperOptions, muxInfo) {
  const { serverUrl, teamName, projectDir, cliType } = wrapperOptions;
  const agents = wrapperOptions.agents || [];
  const { mux, sessionName } = muxInfo;

  // 环境变量通过 env 命令设置（避免 export 语法差异）
  const envVars = [
    `OPENTEAM_SERVER_URL=${serverUrl}`,
    `OPENTEAM_AGENT=${agent}`,
    `OPENTEAM_TEAM=${teamName}`,
    `OPENTEAM_PROJECT_DIR=${projectDir}`,
    `OPENTEAM_CLI=${cliType}`,
    `OPENTEAM_AGENTS=${agents.join(',')}`,
    `OPENTEAM_MUX=${mux}`,
    `OPENTEAM_SESSION=${sessionName}`,
  ];

  // wrapper 入口：node bin/openteam.js wrapper
  const wrapperBin = 'openteam wrapper';

  return `env ${envVars.join(' ')} ${wrapperBin}`;
}
