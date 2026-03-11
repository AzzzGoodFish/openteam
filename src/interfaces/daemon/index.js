/**
 * OpenTeam Daemon — 团队生命周期的唯一 owner
 *
 * 运行在 tmux/zellij session 的 pane 0 中，拥有：
 * - openteam server（in-process HTTP + MCP）
 * - agent panes（每个运行 wrapper，健康检查 + respawn）
 * - 嵌入式 dashboard
 */

import { execSync } from 'child_process';
import { loadTeamConfig, validateTeamConfig } from '../../foundation/config.js';
import { saveRuntime, clearRuntime, findAvailablePort } from '../../foundation/state.js';
import { DEFAULTS, getSessionName } from '../../foundation/constants.js';
import { createLogger } from '../../foundation/logger.js';
import { cleanMuxEnv } from '../../foundation/terminal.js';
import { startServe, stopServe } from './serve.js';
import { createAllAgentPanes, checkAndRespawn } from './panes.js';
import { createEmbeddedDashboard } from '../dashboard/index.js';

const log = createLogger('daemon');
const HEALTH_CHECK_INTERVAL = 10000;

/**
 * Daemon 主入口
 */
export async function runDaemon(teamName, projectDir, options = {}) {
  // 标记 daemon 进程，logger 据此跳过 console.error（避免破坏 blessed TUI）
  process.env.OPENTEAM_DAEMON = '1';
  // daemon 及其子进程（wrapper）默认启用日志
  if (!process.env.OPENTEAM_LOG) process.env.OPENTEAM_LOG = '1';

  // ── 校验 ──
  const validation = validateTeamConfig(teamName);
  if (!validation.valid) {
    console.error(`团队配置无效: ${validation.error}`);
    process.exit(1);
  }

  const teamConfig = loadTeamConfig(teamName);
  const agents = teamConfig.agents;
  const muxType = options.mux || 'tmux';
  const cliType = options.cli || teamConfig.default_cli || 'claude-code';
  const sessionName = getSessionName(teamName, projectDir);
  const host = teamConfig.host || DEFAULTS.HOST;
  let port = teamConfig.port || options.port || 0;

  if (port === 0) {
    port = await findAvailablePort();
  }

  log.info(`daemon starting team=${teamName} port=${port} cli=${cliType}`);
  console.log(`OpenTeam Daemon — ${teamName}`);
  console.log(`  Port: ${port}`);
  console.log(`  Project: ${projectDir}`);
  console.log(`  CLI: ${cliType}`);
  console.log(`  Agents: ${agents.join(', ')}`);
  console.log('');

  // ── 1. 启动 server（in-process）──
  console.log('启动 server...');
  const serve = await startServe({ teamName, projectDir, teamConfig, port, host });
  console.log(`server 就绪 (${serve.url})`);

  saveRuntime(teamName, projectDir, {
    daemon: { pid: process.pid },
    server: { port: serve.port, host: serve.host },
    mux: { type: muxType, session: sessionName },
    team: teamName,
    projectDir,
    started: new Date().toISOString(),
  });

  // ── 2. 确保 agent/skill 软链接 ──
  const { ensureLinks } = await import('./links.js');
  const linkResult = ensureLinks({ teamName, projectDir, cliType, agents });
  if (!linkResult.ok) {
    console.error(`链接错误: ${linkResult.error}`);
    await stopServe(serve.close);
    clearRuntime(teamName, projectDir);
    process.exit(1);
  }
  if (linkResult.warned.length > 0) {
    for (const w of linkResult.warned) console.log(`  ⚠ ${w}`);
  }
  if (linkResult.linked.length > 0) {
    console.log(`已创建 ${linkResult.linked.length} 个链接`);
  }

  // ── 3. wrapper 环境配置 ──
  const cliArgs = teamConfig.cli_config?.[cliType]?.args || [];
  const wrapperOptions = {
    serverUrl: serve.url,
    teamName,
    projectDir,
    cliType,
    agents,
    cliArgs,
  };

  // ── 4. 创建 agent panes ──
  // zellij: layout 已在 startSession 时创建好 stacked agents
  // tmux:   需要动态创建 agent window
  if (muxType !== 'zellij') {
    console.log('创建 agent panes...');
    createAllAgentPanes(muxType, sessionName, agents, wrapperOptions, { leaderName: teamConfig.leader });
    try {
      const env = cleanMuxEnv();
      execSync(`tmux select-window -t "${sessionName}:0"`, { stdio: 'ignore', env });
    } catch {
      // ignore
    }
  }

  // ── 5. 健康检查循环 ──
  const healthInterval = setInterval(() => {
    try {
      const { checked, respawned } = checkAndRespawn(muxType, sessionName, wrapperOptions);
      if (respawned > 0) {
        log.info(`health check: ${checked} panes checked, ${respawned} respawned`);
      }
    } catch (e) {
      log.error(`health check error: ${e.message}`);
    }
  }, HEALTH_CHECK_INTERVAL);

  // ── 6. 启动嵌入式 dashboard ──
  console.log('启动 dashboard...\n');
  const dash = createEmbeddedDashboard(teamName, projectDir, serve.url);
  dash.start();

  // ── 7. 信号处理 — 优雅关闭 ──
  const shutdown = async (signal) => {
    log.info(`received ${signal}, shutting down...`);
    clearInterval(healthInterval);
    dash.stop();
    await stopServe(serve.close);
    clearRuntime(teamName, projectDir);
    log.info('daemon stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // daemon 进程不退出，由信号终止
  await new Promise(() => {});
}
