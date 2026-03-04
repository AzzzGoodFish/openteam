/**
 * OpenTeam Daemon — 团队生命周期的唯一 owner
 *
 * 运行在 tmux/zellij session 的 pane 0 中，拥有：
 * - serve 子进程（非 detach，生命周期绑定）
 * - agent panes（健康检查 + respawn）
 * - 嵌入式 dashboard
 */

import { loadTeamConfig, validateTeamConfig } from '../../foundation/config.js';
import { saveRuntime, clearRuntime, findAvailablePort } from '../../foundation/state.js';
import { DEFAULTS } from '../../foundation/constants.js';
import { createLogger } from '../../foundation/logger.js';
import { ensureAgent, recoverSessions } from '../../capabilities/lifecycle.js';
import { startServe, stopServe, onServeCrash } from './serve.js';
import { createAllAgentPanes, checkAndRespawn } from './panes.js';
import { createEmbeddedDashboard } from '../dashboard/index.js';

const log = createLogger('daemon');
const HEALTH_CHECK_INTERVAL = 10000;

/**
 * Daemon 主入口
 */
export async function runDaemon(teamName, projectDir, options = {}) {
  // ── 校验 ──
  const validation = validateTeamConfig(teamName);
  if (!validation.valid) {
    console.error(`团队配置无效: ${validation.error}`);
    process.exit(1);
  }

  const teamConfig = loadTeamConfig(teamName);
  const agents = teamConfig.agents;
  const muxType = options.mux || 'tmux';
  const sessionName = `openteam-${teamName}`;
  const host = teamConfig.host || DEFAULTS.HOST;
  let port = teamConfig.port || options.port || 0;

  if (port === 0) {
    port = await findAvailablePort();
  }

  log.info(`daemon starting team=${teamName} port=${port}`);
  console.log(`OpenTeam Daemon — ${teamName}`);
  console.log(`  Port: ${port}`);
  console.log(`  Project: ${projectDir}`);
  console.log(`  Agents: ${agents.join(', ')}`);
  console.log('');

  // ── 1. 启动 serve ──
  console.log('启动 serve...');
  let serve = await startServe(teamName, port, host);
  console.log(`serve 就绪 (PID: ${serve.pid})`);

  const buildRuntimeData = () => ({
    daemon: { pid: process.pid },
    serve: { pid: serve.pid, port: serve.port, host: serve.host },
    mux: { type: muxType, session: sessionName },
    team: teamName,
    projectDir,
    started: new Date().toISOString(),
  });

  saveRuntime(teamName, buildRuntimeData());

  // ── 2. 恢复/创建 sessions ──
  console.log('准备 agent sessions...');
  const { recovered, cleaned } = await recoverSessions(teamName, serve.url);
  if (recovered > 0 || cleaned > 0) {
    console.log(`  会话恢复: ${recovered} 个有效, ${cleaned} 个已清理`);
  }

  const sessionMap = new Map();
  for (const agent of agents) {
    const sessionId = await ensureAgent(teamName, agent, serve.url, projectDir);
    if (sessionId) {
      sessionMap.set(agent, sessionId);
      console.log(`  ${agent}: ${sessionId}`);
    } else {
      console.error(`  ${agent}: 创建失败`);
    }
  }

  // ── 3. 创建 agent panes ──
  console.log('创建 agent panes...');
  createAllAgentPanes(muxType, sessionName, agents, serve.url, sessionMap);

  // ── 4. serve 崩溃重启 ──
  let restarting = false;
  function handleServeCrash(code, signal) {
    if (restarting) return;
    restarting = true;
    console.log(`\nserve 崩溃 (code=${code}, signal=${signal})，正在重启...`);
    startServe(teamName, port, host)
      .then(newServe => {
        serve = newServe;
        saveRuntime(teamName, buildRuntimeData());
        onServeCrash(serve.process, handleServeCrash);
        console.log(`serve 已重启 (PID: ${serve.pid})`);
      })
      .catch(e => {
        console.error(`serve 重启失败: ${e.message}`);
      })
      .finally(() => {
        restarting = false;
      });
  }
  onServeCrash(serve.process, handleServeCrash);

  // ── 5. 健康检查循环 ──
  const healthInterval = setInterval(() => {
    try {
      const { checked, respawned } = checkAndRespawn(muxType, sessionName, teamName, serve.url);
      if (respawned > 0) {
        log.info(`health check: ${checked} panes checked, ${respawned} respawned`);
      }
    } catch (e) {
      log.error(`health check error: ${e.message}`);
    }
  }, HEALTH_CHECK_INTERVAL);

  // ── 6. 启动嵌入式 dashboard ──
  console.log('启动 dashboard...\n');
  const dash = createEmbeddedDashboard(teamName, serve.url);
  dash.start();

  // ── 7. 信号处理 — 优雅关闭 ──
  const shutdown = async (signal) => {
    log.info(`received ${signal}, shutting down...`);
    clearInterval(healthInterval);
    dash.stop();
    await stopServe(serve.process);
    clearRuntime(teamName);
    log.info('daemon stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // daemon 进程不退出，由信号终止
  await new Promise(() => {});
}
