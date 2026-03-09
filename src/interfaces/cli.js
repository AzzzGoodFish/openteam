/**
 * CLI 命令实现 — 编排 capabilities 和 foundation 完成用户操作
 */

import { execSync } from 'child_process';
import { getSessionName, getSessionPrefix } from '../foundation/constants.js';
import { loadTeamConfig, getTeamLeader, listTeams, isAgentInTeam, validateTeamConfig } from '../foundation/config.js';
import {
  getRuntime,
  clearRuntime,
  getServeUrl,
  findAvailablePort,
  loadActiveSessions,
  getAgentInstances,
  listRunningInstances,
  listAllRunningInstances,
  listAllInstances,
} from '../foundation/state.js';
import { sessionExists, fetchSession } from '../foundation/opencode.js';
import { detectMultiplexer, getSessionState, hasSession, findSessionsByPrefix, attachSession, startSession, killSession, isInsideMux } from '../foundation/terminal.js';
import { ensureAgent } from '../capabilities/lifecycle.js';

// ── 输出辅助 ──

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const BLUE = '\x1b[34m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

/**
 * 计算终端可见长度（剥离 ANSI 转义码）
 */
function visibleLength(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * 按可见宽度填充（ANSI 安全的 padEnd）
 */
function padV(str, width) {
  return str + ' '.repeat(Math.max(0, width - visibleLength(str)));
}

/**
 * ISO 时间戳 → 相对时间（"3m ago", "2h ago", "5d ago"）
 */
function relativeTime(isoString) {
  if (!isoString) return '—';
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return '—';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

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

  const sessionName = getSessionName(teamName, projectDir);
  const sessionState = getSessionState(mux, sessionName);

  // 以 runtime 作为权威来源：有 mux 会话但无 runtime => 残留；有 runtime 但无 mux 会话 => 残留
  const runtime = getRuntime(teamName, projectDir);
  if (sessionState && !runtime) {
    const suffix = sessionState === 'exited' ? '（已退出，可复活快照）' : '';
    info(`检测到残留 ${mux} 会话${suffix}，正在清理后重建...`);
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

  // zellij: 构建 agent-attach 命令，由 team layout 的 stacked panes 自动调用
  const agentCmds = mux === 'zellij' ? teamConfig.agents.map(agent => ({
    name: agent,
    cmd: `openteam agent-attach ${teamName} ${agent} --dir "${projectDir}"`,
    expanded: agent === teamConfig.leader,
  })) : [];

  info(`启动 ${teamName} 团队...`);
  console.log(`  复用器: ${mux}`);
  console.log(`  端口:   ${port}`);
  console.log(`  项目:   ${projectDir}`);
  console.log(`  Leader: ${teamConfig.leader}`);
  console.log('');

  // 创建 mux session
  // zellij: team layout（daemon + stacked agents 同屏）
  // tmux:   daemon only，agent panes 由 daemon 动态创建
  startSession(mux, sessionName, daemonCmd, { foreground: !options.detach, agents: agentCmds });

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
 * 从 team config 提取 leader 和其他成员
 */
function getTeamMembers(teamName) {
  const config = loadTeamConfig(teamName);
  if (!config?.agents) return { leader: '—', others: '—' };
  const leader = config.leader;
  const others = config.agents.filter(a => a !== leader);
  return { leader, others: others.join(',') || '—' };
}

/**
 * 列出运行中的团队实例（docker ps 风格）
 */
export function cmdList(options = {}) {
  const fullList = listAllInstances();
  const runningInstances = fullList.filter(i => i.alive);

  if (runningInstances.length === 0 && !options.all) {
    console.log('没有运行中的团队');
    return;
  }

  // 构建行数据
  const rows = [];
  for (const inst of runningInstances) {
    const { leader, others } = getTeamMembers(inst.teamName);
    rows.push({
      id: inst.hash,
      team: inst.teamName,
      status: `${GREEN}Running${NC}`,
      project: inst.projectDir,
      leader,
      members: others,
      port: String(inst.runtime.servePort || '—'),
      created: relativeTime(inst.started),
    });
  }

  if (options.all) {
    const stoppedInstances = fullList.filter(i => !i.alive);

    for (const inst of stoppedInstances) {
      const { leader, others } = getTeamMembers(inst.teamName);
      rows.push({
        id: inst.hash, team: inst.teamName,
        status: 'Stopped',
        project: inst.projectDir || '—',
        leader, members: others, port: '—',
        created: relativeTime(inst.started),
        stopped: true,
      });
    }

    // 从未运行过的团队（没有任何状态文件）
    const teamsWithInstances = new Set(fullList.map(i => i.teamName));
    const neverRunTeams = listTeams().filter(t => !teamsWithInstances.has(t));
    for (const teamName of neverRunTeams) {
      const { leader, others } = getTeamMembers(teamName);
      rows.push({
        id: '—', team: teamName,
        status: 'Created',
        project: '—',
        leader, members: others, port: '—',
        created: '—',
        stopped: true,
      });
    }
  }

  if (rows.length === 0) {
    console.log('没有已配置的团队');
    return;
  }

  // 动态计算列宽（基于可见长度）
  const cols = ['id', 'team', 'status', 'project', 'leader', 'members', 'port', 'created'];
  const headers = { id: 'ID', team: 'TEAM', status: 'STATUS', project: 'PROJECT', leader: 'LEADER', members: 'MEMBERS', port: 'PORT', created: 'CREATED' };
  const widths = {};
  for (const col of cols) {
    widths[col] = Math.max(
      headers[col].length,
      ...rows.map(r => visibleLength(r[col])),
    ) + 2;
  }

  // 表头
  console.log(BOLD + cols.map(c => headers[c].padEnd(widths[c])).join('') + NC);

  // 数据行
  for (const row of rows) {
    const line = cols.map(c => padV(row[c], widths[c])).join('');
    console.log(row.stopped ? `${DIM}${line}${NC}` : line);
  }
}

/**
 * 停止实例 — SIGTERM daemon，daemon 自行清理；兜底清 runtime + kill session
 */
function stopInstance(inst) {
  const { teamName, projectDir, runtime } = inst;
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
 * 停止团队实例（docker stop 风格，支持 ID 前缀或团队名称）
 */
export function cmdStop(target) {
  if (!target) {
    error('请指定团队名称或实例 ID');
  }

  const allInstances = listAllRunningInstances();

  // 1. 尝试 ID 前缀匹配
  const idMatches = allInstances.filter(i => i.hash.startsWith(target));
  if (idMatches.length === 1) {
    stopInstance(idMatches[0]);
    return;
  }
  if (idMatches.length > 1) {
    const list = idMatches.map(i => `  ${i.hash}  ${i.teamName}  ${i.projectDir}`).join('\n');
    error(`匹配到多个实例，请提供更精确的 ID:\n${list}`);
  }

  // 2. 尝试团队名称匹配
  const nameMatches = allInstances.filter(i => i.teamName === target);
  if (nameMatches.length === 1) {
    stopInstance(nameMatches[0]);
    return;
  }
  if (nameMatches.length > 1) {
    const list = nameMatches.map(i => `  ${i.hash}  ${i.projectDir}`).join('\n');
    error(`团队 ${target} 有多个运行实例，请用 ID 指定:\n${list}`);
  }

  // 3. 无运行实例匹配 — 尝试清理残留 mux 会话
  const staleSessions = findSessionsByPrefix(getSessionPrefix(target));
  if (staleSessions.length === 1) {
    info(`未找到运行实例，但发现残留 mux 会话，正在清理...`);
    killSession(staleSessions[0]);
    success('已清理残留会话');
    return;
  }
  if (staleSessions.length > 1) {
    const list = staleSessions.map(s => `  ${s}`).join('\n');
    error(`发现多个残留 mux 会话:\n${list}`);
  }

  error('未找到匹配的运行实例');
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

/**
 * 等待 agent 会话就绪后 attach（由 zellij team layout 自动调用）
 *
 * 轮询 state 文件，直到 serve URL + session ID 可用，然后 exec 到 opencode attach。
 * 超时 120s — 考虑 serve 启动 + session 创建耗时。
 */
export async function cmdAgentAttach(teamName, agentName, options = {}) {
  const projectDir = options.dir || process.cwd();
  const timeout = 120000;
  const start = Date.now();

  console.log(`等待 ${agentName} 会话就绪...`);

  while (Date.now() - start < timeout) {
    const serveUrl = getServeUrl(teamName, projectDir);
    if (serveUrl) {
      const instances = getAgentInstances(teamName, projectDir, agentName);
      if (instances.length > 0) {
        console.log(`连接到 ${agentName}...`);
        execSync(`opencode attach "${serveUrl}" -s "${instances[0].sessionId}"`, { stdio: 'inherit' });
        return;
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.error(`${RED}超时:${NC} ${agentName} 会话未在 ${timeout / 1000}s 内就绪`);
  process.exit(1);
}
