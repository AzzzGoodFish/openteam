/**
 * CLI 命令实现 — 编排 capabilities 和 foundation 完成用户操作
 */

import { execSync } from 'child_process';
import { PATHS, projectDirHash } from '../foundation/constants.js';
import { loadTeamConfig, getTeamLeader, listTeams, isAgentInTeam, validateTeamConfig } from '../foundation/config.js';
import {
  getRuntime,
  clearRuntime,
  getServeUrl,
  findAvailablePort,
  loadActiveSessions,
  listRunningInstances,
} from '../foundation/state.js';
import { sessionExists, fetchSession } from '../foundation/opencode.js';
import { detectMultiplexer, hasSession, hasSessionAny, attachSession, startSession, killSession, isInsideMux } from '../foundation/terminal.js';
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

// ── 辅助：自动选择运行实例 ──

/**
 * 根据 --dir 或自动扫描找到唯一运行实例
 * @returns {{ projectDir: string, runtime: object }}
 */
function resolveInstance(teamName, options = {}) {
  if (options.dir) {
    const projectDir = options.dir;
    const runtime = getRuntime(teamName, projectDir);
    if (!runtime) error(`团队 ${teamName} 在 ${projectDir} 未运行`);
    return { projectDir, runtime };
  }

  const instances = listRunningInstances(teamName);
  if (instances.length === 0) error(`团队 ${teamName} 未运行`);
  if (instances.length > 1) {
    const list = instances.map(i => `  ${i.projectDir}`).join('\n');
    error(`团队 ${teamName} 有多个运行实例，请指定 --dir:\n${list}`);
  }
  return instances[0];
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

  const sessionName = `openteam-${teamName}-${projectDirHash(projectDir)}`;

  // 以 runtime 作为权威来源：有 mux 会话但无 runtime => 残留；有 runtime 但无 mux 会话 => 残留
  const runtime = getRuntime(teamName, projectDir);
  if (hasSession(mux, sessionName) && !runtime) {
    info(`检测到残留 ${mux} 会话，正在清理后重建...`);
    killSession(sessionName);
  }
  if (!hasSession(mux, sessionName) && runtime) {
    info('检测到残留 runtime 状态，正在清理后重建...');
    clearRuntime(teamName, projectDir);
  }

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
export async function cmdAttach(teamName, agentName, options = {}) {
  teamName = teamName || 'team1';

  const { projectDir, runtime } = resolveInstance(teamName, options);
  const serveUrl = getServeUrl(teamName, projectDir);

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
    const leader = teamConfig?.leader || `${RED}未配置${NC}`;
    const agents = teamConfig?.agents?.join(', ') || `${RED}未配置${NC}`;
    const instances = listRunningInstances(teamName);

    console.log(`${teamName}`);
    console.log(`  Leader:  ${leader}`);
    console.log(`  成员:    ${agents}`);

    if (instances.length === 0) {
      console.log(`  状态:    ${YELLOW}已停止${NC}`);
    } else {
      for (const inst of instances) {
        const serveUrl = `http://${inst.runtime.serveHost}:${inst.runtime.servePort}`;
        console.log(`  ${GREEN}运行中${NC}: ${inst.projectDir}`);
        console.log(`    URL: ${serveUrl}`);
      }
    }
    console.log('');
  }
}

/**
 * 停止团队 — SIGTERM daemon，daemon 自行清理；兜底清 runtime + kill session
 */
export function cmdStop(teamName, options = {}) {
  if (!teamName) {
    error('请指定团队名称');
  }

  // 查找运行实例
  let projectDir, runtime;
  if (options.dir) {
    projectDir = options.dir;
    runtime = getRuntime(teamName, projectDir);
  } else {
    const instances = listRunningInstances(teamName);
    if (instances.length === 1) {
      ({ projectDir, runtime } = instances[0]);
    } else if (instances.length > 1) {
      const list = instances.map(i => `  ${i.projectDir}`).join('\n');
      error(`团队 ${teamName} 有多个运行实例，请指定 --dir:\n${list}`);
    }
  }

  if (!runtime) {
    // 完全没有 runtime 且没有指定 --dir：用前缀扫描兜底
    // 这是迁移期兼容逻辑 — 旧格式 session 名为 openteam-<team>（无 hash 后缀），
    // 新格式为 openteam-<team>-<hash>，两者都能匹配到前缀
    const sessionPrefix = `openteam-${teamName}`;
    const staleMuxSession = hasSessionAny(sessionPrefix).any;
    if (staleMuxSession) {
      info(`团队 ${teamName} 没有 runtime，但发现残留 mux 会话，正在清理...`);
      killSession(sessionPrefix);
      success('已清理残留会话');
      return;
    }
    error(`团队 ${teamName} 未运行`);
  }

  // 优先 SIGTERM daemon 进程
  const daemonPid = runtime.daemonPid;
  const sessionName = runtime.mux?.session;
  info(`停止团队 ${teamName} (daemon PID: ${daemonPid})...`);

  try {
    process.kill(daemonPid, 'SIGTERM');
  } catch {
    // 进程已不存在
  }

  // 等 daemon 退出，然后清理 mux session（daemon 只管 serve + runtime，不管 session）
  setTimeout(() => {
    if (sessionName) {
      killSession(sessionName);
    }
    clearRuntime(teamName, projectDir); // 幂等：daemon 可能已清
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
export async function cmdStatus(teamName, options = {}) {
  if (!teamName) {
    error('请指定团队名称');
  }

  const { projectDir, runtime } = resolveInstance(teamName, options);

  const teamConfig = loadTeamConfig(teamName);
  const leader = teamConfig?.leader || `${RED}未配置${NC}`;
  const serveUrl = getServeUrl(teamName, projectDir);

  console.log(`团队: ${GREEN}${teamName}${NC}`);
  console.log(`状态: ${GREEN}运行中${NC}`);
  if (runtime.daemonPid) {
    console.log(`Daemon: PID ${runtime.daemonPid}`);
  }
  console.log(`Serve: ${serveUrl} (PID: ${runtime.servePid})`);
  console.log(`Leader: ${leader}`);
  console.log(`项目: ${runtime.projectDir}`);
  console.log(`启动于: ${runtime.started}`);
  console.log('');

  console.log('活跃会话:');
  const activeSessions = loadActiveSessions(teamName, projectDir);

  for (const [agent, instances] of Object.entries(activeSessions)) {
    for (const inst of instances) {
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
export async function cmdDashboard(teamName, options = {}) {
  const { projectDir } = resolveInstance(teamName, options);
  const { dashboard } = await import('./dashboard/index.js');
  await dashboard(teamName, projectDir);
}
