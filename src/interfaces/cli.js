/**
 * CLI 命令实现 — 编排 capabilities 和 foundation 完成用户操作
 */

import { execSync } from 'child_process';
import { PATHS } from '../foundation/constants.js';
import { loadTeamConfig, getTeamLeader, listTeams, isAgentInTeam, validateTeamConfig } from '../foundation/config.js';
import {
  getRuntime,
  clearRuntime,
  isServeRunning,
  getServeUrl,
  findAvailablePort,
  loadActiveSessions,
} from '../foundation/state.js';
import { sessionExists, fetchSession } from '../foundation/opencode.js';
import { detectMultiplexer, hasSession, attachSession, startSession, killSession, isInsideMux } from '../foundation/terminal.js';
import { ensureAgent } from '../capabilities/lifecycle.js';

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

// ── 命令实现 ──

/**
 * 启动团队 — 创建 mux session + daemon pane，然后 attach
 */
export async function cmdStart(teamName, options) {
  teamName = teamName || 'team1';
  const projectDir = options.dir || process.cwd();

  const validation = validateTeamConfig(teamName);
  if (!validation.valid) {
    error(`团队配置无效: ${validation.error}`);
  }

  const teamConfig = loadTeamConfig(teamName);
  const mux = detectMultiplexer(options);
  if (!mux) {
    error('未找到 tmux 或 zellij，请先安装其中一个');
  }

  const sessionName = `openteam-${teamName}`;

  // 已有 session → 直接 attach（幂等）
  if (hasSession(mux, sessionName)) {
    if (options.detach) {
      info(`团队 ${teamName} 已在运行`);
      return;
    }
    info(`团队 ${teamName} 已在运行，正在连接...`);
    attachSession(mux, sessionName);
    return;
  }

  // 前台模式下禁止在 mux 内部嵌套
  if (!options.detach && isInsideMux()) {
    error(`当前已在终端复用器中，无法嵌套创建\n请在终端复用器外运行，或使用 --detach 后台启动：\n  openteam start ${teamName} --detach`);
  }

  // 构建 daemon 启动命令
  let port = teamConfig.port || 0;
  if (port === 0) {
    port = await findAvailablePort();
  }

  const daemonCmd = `openteam daemon ${teamName} --port ${port} --dir "${projectDir}" --mux ${mux}`;

  info(`启动 ${teamName} 团队...`);
  console.log(`  复用器: ${mux}`);
  console.log(`  端口:   ${port}`);
  console.log(`  项目:   ${projectDir}`);
  console.log(`  Leader: ${teamConfig.leader}`);
  console.log('');

  // 创建 mux session，pane 0 运行 daemon
  // foreground: 前台模式阻塞直到用户退出；detach: 后台创建后立即返回
  startSession(mux, sessionName, daemonCmd, { foreground: !options.detach });

  if (options.detach) {
    success('团队已在后台启动');
    console.log(`使用 'openteam start ${teamName}' 进入团队`);
  }
}

/**
 * 附加到 agent 会话
 */
export async function cmdAttach(teamName, agentName) {
  teamName = teamName || 'team1';

  if (!isServeRunning(teamName)) {
    error(`团队 ${teamName} 未运行，请先执行 'openteam start ${teamName}'`);
  }

  const runtime = getRuntime(teamName);
  const serveUrl = getServeUrl(teamName);

  if (!agentName) {
    agentName = getTeamLeader(teamName);
  }

  if (!isAgentInTeam(teamName, agentName)) {
    const teamConfig = loadTeamConfig(teamName);
    error(`团队 ${teamName} 中没有 ${agentName}，可选: ${teamConfig.agents.join(', ')}`);
  }

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
      const serveUrl = getServeUrl(teamName);
      console.log(`  URL:     ${serveUrl}`);
    }
    console.log('');
  }
}

/**
 * 停止团队 — SIGTERM daemon，daemon 自行清理；兜底清 runtime + kill session
 */
export function cmdStop(teamName) {
  if (!teamName) {
    error('请指定团队名称');
  }

  const runtime = getRuntime(teamName);
  if (!runtime) {
    error(`团队 ${teamName} 未运行`);
  }

  // 优先 SIGTERM daemon 进程
  const daemonPid = runtime.daemon?.pid || runtime.pid;
  info(`停止团队 ${teamName} (daemon PID: ${daemonPid})...`);

  try {
    process.kill(daemonPid, 'SIGTERM');
  } catch {
    // 进程已不存在
  }

  // 等待 daemon 清理，然后兜底
  setTimeout(() => {
    const stillRunning = getRuntime(teamName);
    if (stillRunning) {
      clearRuntime(teamName);
      const sessionName = runtime.mux?.session || `openteam-${teamName}`;
      killSession(sessionName);
    }
    success('已停止');
  }, 1000);
}

/**
 * 监控 — start 的别名
 */
export async function cmdMonitor(teamName, options) {
  return cmdStart(teamName, { ...options, dir: options.dir || process.cwd() });
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
  const serveUrl = getServeUrl(teamName);

  // 兼容新旧格式显示
  const daemonPid = runtime.daemon?.pid;
  const servePid = runtime.serve?.pid || runtime.pid;

  console.log(`团队: ${GREEN}${teamName}${NC}`);
  console.log(`状态: ${GREEN}运行中${NC}`);
  if (daemonPid) {
    console.log(`Daemon: PID ${daemonPid}`);
  }
  console.log(`Serve: ${serveUrl} (PID: ${servePid})`);
  console.log(`Leader: ${leader}`);
  console.log(`项目: ${runtime.projectDir}`);
  console.log(`启动于: ${runtime.started}`);
  console.log('');

  console.log('活跃会话:');
  const activeSessions = loadActiveSessions(teamName);

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
