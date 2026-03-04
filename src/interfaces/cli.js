/**
 * CLI 命令实现 — 编排 capabilities 和 foundation 完成用户操作
 */

import { spawn, execSync } from 'child_process';
import path from 'path';
import { PATHS, DEFAULTS } from '../foundation/constants.js';
import { loadTeamConfig, getTeamLeader, listTeams, isAgentInTeam, validateTeamConfig } from '../foundation/config.js';
import {
  getRuntime,
  saveRuntime,
  clearRuntime,
  isServeRunning,
  getServeUrl,
  findAvailablePort,
  getAgentInstances,
  loadActiveSessions,
} from '../foundation/state.js';
import { sessionExists, fetchSession, listAllSessions } from '../foundation/opencode.js';
import { killSession } from '../foundation/terminal.js';
import { ensureAgent, findAgentSession, recoverSessions } from '../capabilities/lifecycle.js';
import { startMonitor } from '../capabilities/monitor.js';

// ── 输出辅助 ──

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const YELLOW = '\x1b[33m';
const NC = '\x1b[0m';

function error(msg) {
  console.error(`${RED}错误:${NC} ${msg}`);
  process.exit(1);
}

function info(msg) {
  console.log(`${BLUE}${msg}${NC}`);
}

function success(msg) {
  console.log(`${GREEN}${msg}${NC}`);
}

function warn(msg) {
  console.log(`${YELLOW}${msg}${NC}`);
}

// ── 命令实现 ──

/**
 * 启动团队
 */
export async function cmdStart(teamName, options) {
  teamName = teamName || 'team1';
  const projectDir = options.dir || process.cwd();

  const validation = validateTeamConfig(teamName);
  if (!validation.valid) {
    error(`团队配置无效: ${validation.error}\n配置文件: ${path.join(PATHS.AGENTS_DIR, teamName, 'team.json')}`);
  }

  const teamConfig = loadTeamConfig(teamName);
  const leader = teamConfig.leader;
  let host = teamConfig.host || DEFAULTS.HOST;
  let port = teamConfig.port || 0;

  if (isServeRunning(teamName)) {
    const runtime = getRuntime(teamName);
    info(`团队 ${teamName} 已在运行 (PID: ${runtime.pid}, Port: ${runtime.port})`);
    port = runtime.port;
    host = runtime.host;
  } else {
    if (port === 0) {
      port = await findAvailablePort();
    }

    info(`启动 ${teamName} 团队...`);
    console.log(`   Host: ${host}`);
    console.log(`   Port: ${port}`);
    console.log(`   项目: ${projectDir}`);
    console.log(`   Leader: ${leader}`);

    const serveProcess = spawn('opencode', ['serve', '--port', String(port)], {
      detached: true,
      stdio: options.detach ? 'ignore' : 'inherit',
      env: { ...process.env, OPENTEAM_TEAM: teamName, OPENMEMORY: process.env.OPENMEMORY || '' },
    });

    if (options.detach) {
      serveProcess.unref();
    }

    const servePid = serveProcess.pid;

    console.log('   等待 serve 就绪...');
    const serveUrl = `http://${host}:${port}`;

    for (let i = 0; i < 30; i++) {
      try {
        // 用 listAllSessions 作为健康检查，避免 raw fetch
        await listAllSessions(serveUrl);
        break;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    saveRuntime(teamName, {
      host,
      port,
      pid: servePid,
      team: teamName,
      projectDir,
      started: new Date().toISOString(),
    });

    success(`Serve 已启动 (PID: ${servePid})`);
  }

  const serveUrl = `http://${host}:${port}`;

  // 恢复 session
  const { recovered, cleaned } = await recoverSessions(teamName, serveUrl);
  if (recovered > 0 || cleaned > 0) {
    info(`会话恢复: ${recovered} 个有效, ${cleaned} 个已失效`);
  }

  // 确保 leader 会话
  info(`准备 ${leader} 会话...`);
  const leaderSession = await ensureAgent(teamName, leader, serveUrl, projectDir);

  if (!leaderSession) {
    error(`无法创建 ${leader} 会话`);
  }

  success(`${leader} 会话: ${leaderSession}`);

  if (options.detach) {
    console.log('');
    success('团队已在后台启动');
    console.log(`使用 'openteam attach ${teamName}' 进入 ${leader} 会话`);
  } else {
    console.log('');
    info(`进入 ${leader} 控制台...`);
    execSync(`opencode attach "${serveUrl}" -s "${leaderSession}"`, { stdio: 'inherit' });
  }
}

/**
 * 附加到 agent 会话
 */
export async function cmdAttach(teamName, agentName, options) {
  teamName = teamName || 'team1';

  if (!isServeRunning(teamName)) {
    error(`团队 ${teamName} 未运行，请先执行 'openteam start ${teamName}'`);
  }

  const runtime = getRuntime(teamName);
  const serveUrl = `http://${runtime.host}:${runtime.port}`;

  if (!agentName) {
    agentName = getTeamLeader(teamName);
  }

  if (!isAgentInTeam(teamName, agentName)) {
    const teamConfig = loadTeamConfig(teamName);
    error(`团队 ${teamName} 中没有 ${agentName}，可选: ${teamConfig.agents.join(', ')}`);
  }

  // Watch mode
  if (options.watch) {
    const cwdHint = options.cwd ? ` (${options.cwd})` : '';
    console.log(`${BLUE}监视 ${teamName}/${agentName}${cwdHint}...${NC}`);
    console.log(`${YELLOW}按 Ctrl+C 退出${NC}`);
    console.log('');

    while (true) {
      const sessionId = await findAgentSession(teamName, agentName, serveUrl, { cwd: options.cwd });

      if (sessionId) {
        success(`连接到会话: ${sessionId}`);

        const attachProcess = spawn('opencode', ['attach', serveUrl, '-s', sessionId], {
          stdio: 'inherit',
          shell: true,
        });

        const checkInterval = setInterval(async () => {
          const currentSession = await findAgentSession(teamName, agentName, serveUrl, { cwd: options.cwd });
          if (currentSession !== sessionId) {
            attachProcess.kill('SIGTERM');
          }
        }, 2000);

        await new Promise((resolve) => {
          attachProcess.on('exit', resolve);
          attachProcess.on('error', resolve);
        });

        clearInterval(checkInterval);

        process.stdout.write('\x1b[2J\x1b[H');
        console.log(`${BLUE}监视 ${teamName}/${agentName}${cwdHint}...${NC}`);
        console.log(`${YELLOW}按 Ctrl+C 退出${NC}`);
        console.log('');
        info(`会话结束，继续监视...`);
      } else {
        process.stdout.write(`\r${YELLOW}等待 ${agentName} 会话...${NC}  `);
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // Normal mode
  info(`附加到 ${teamName}/${agentName}...`);

  const sessionId = await ensureAgent(teamName, agentName, serveUrl, runtime.projectDir);

  if (!sessionId) {
    error(`无法获取 ${agentName} 会话`);
  }

  success(`会话: ${sessionId}`);
  execSync(`opencode attach "${serveUrl}" -s "${sessionId}"`, { stdio: 'inherit' });
}

/**
 * 列出所有团队
 */
export function cmdList() {
  const teams = listTeams();

  if (teams.length === 0) {
    console.log('未配置任何团队');
    console.log(`在 ${PATHS.AGENTS_DIR}/<team>/team.json 创建团队配置`);
    return;
  }

  console.log('团队列表:');
  console.log('');

  for (const teamName of teams) {
    const teamConfig = loadTeamConfig(teamName);
    const runtime = getRuntime(teamName);
    const isRunning = runtime !== null;

    const status = isRunning ? `${GREEN}运行中${NC}` : `${YELLOW}已停止${NC}`;
    const leader = teamConfig?.leader || `${RED}未配置${NC}`;
    const agents = teamConfig?.agents?.join(', ') || `${RED}未配置${NC}`;

    console.log(`${teamName}`);
    console.log(`  状态:    ${status}`);
    console.log(`  Leader:  ${leader}`);
    console.log(`  成员:    ${agents}`);
    if (isRunning) {
      console.log(`  URL:     http://${runtime.host}:${runtime.port}`);
    }
    console.log('');
  }
}

/**
 * 停止团队
 */
export function cmdStop(teamName) {
  if (!teamName) {
    error('请指定团队名称');
  }

  const runtime = getRuntime(teamName);
  if (!runtime) {
    error(`团队 ${teamName} 未运行`);
  }

  info(`停止团队 ${teamName} (PID: ${runtime.pid})...`);

  try {
    process.kill(runtime.pid);
  } catch {
    // Already dead
  }

  clearRuntime(teamName);

  // 关闭 monitor 会话
  killSession(`openteam-${teamName}`);

  success('已停止');
}

/**
 * 监控（委托给 capabilities/monitor）
 */
export async function cmdMonitor(teamName, options) {
  teamName = teamName || 'team1';
  const projectDir = options.dir || process.cwd();

  // 团队未运行时先启动
  if (!isServeRunning(teamName)) {
    info(`团队 ${teamName} 未运行，正在启动...`);
    await cmdStart(teamName, { detach: true, dir: projectDir });
  }

  const teamConfig = loadTeamConfig(teamName);
  if (!teamConfig) {
    error(`团队配置不存在: ${path.join(PATHS.AGENTS_DIR, teamName, 'team.json')}`);
  }

  const agents = teamConfig.agents || [];
  const numWindows = Math.ceil(agents.length / 4);
  info(`使用终端复用器监控 ${teamName}...`);
  info('各 pane 将自动监视对应 agent 的会话状态');
  console.log(`  agents: ${agents.join(', ')}`);
  if (numWindows > 1) {
    console.log(`  布局: ${numWindows} 个窗口/tab，每个 2x2`);
  }
  console.log('');

  try {
    await startMonitor(teamName, options);
  } catch (e) {
    error(e.message);
  }
}

/**
 * 展示团队运行状态
 */
export async function cmdStatus(teamName) {
  if (!teamName) {
    error('请指定团队名称');
  }

  const runtime = getRuntime(teamName);
  if (!runtime) {
    console.log(`团队 ${teamName}: ${RED}未运行${NC}`);
    return;
  }

  const teamConfig = loadTeamConfig(teamName);
  const leader = teamConfig?.leader || `${RED}未配置${NC}`;

  console.log(`团队: ${GREEN}${teamName}${NC}`);
  console.log(`状态: ${GREEN}运行中${NC}`);
  console.log(`Serve: http://${runtime.host}:${runtime.port} (PID: ${runtime.pid})`);
  console.log(`Leader: ${leader}`);
  console.log(`项目: ${runtime.projectDir}`);
  console.log(`启动于: ${runtime.started}`);
  console.log('');

  console.log('活跃会话:');
  const activeSessions = loadActiveSessions(teamName);
  const serveUrl = `http://${runtime.host}:${runtime.port}`;

  for (const [agent, instances] of Object.entries(activeSessions)) {
    const instanceList = Array.isArray(instances)
      ? instances
      : [{ sessionId: instances, cwd: null }];

    for (const inst of instanceList) {
      const exists = await sessionExists(serveUrl, inst.sessionId);
      const cwdHint = inst.cwd ? ` @ ${inst.cwd}` : '';
      if (exists) {
        const session = await fetchSession(serveUrl, inst.sessionId);
        const title = session?.title || 'Untitled';
        console.log(`  - ${agent}: ${inst.sessionId} (${title})${cwdHint}`);
      } else {
        console.log(`  - ${agent}: ${inst.sessionId} ${RED}(已失效)${NC}${cwdHint}`);
      }
    }
  }
}

/**
 * 启动 Dashboard TUI
 */
export async function cmdDashboard(teamName) {
  const { dashboard } = await import('./dashboard/index.js');
  await dashboard(teamName);
}
