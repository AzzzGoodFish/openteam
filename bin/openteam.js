#!/usr/bin/env node

/**
 * OpenTeam CLI
 *
 * Team management commands for OpenCode.
 */

import { program } from 'commander';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import from src
import { PATHS, DEFAULTS } from '../src/constants.js';
import { loadTeamConfig, getTeamLeader, listTeams, isAgentInTeam } from '../src/team/config.js';
import {
  getRuntime,
  saveRuntime,
  clearRuntime,
  isServeRunning,
  getServeUrl,
  findAvailablePort,
  loadActiveSessions,
  saveActiveSessions,
  getAgentInstances,
  findInstance,
  addInstance,
  setMonitorInfo,
  clearMonitorInfo,
} from '../src/team/serve.js';
import { createSession, postMessage, fetchSession, sessionExists } from '../src/utils/api.js';

// Colors
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

/**
 * Get existing session for an agent in a specific directory
 */
async function getExistingSession(teamName, agentName, serveUrl, projectDir) {
  // Find instance matching the directory
  const instance = findInstance(teamName, agentName, { cwd: projectDir });
  if (instance) {
    const exists = await sessionExists(serveUrl, instance.sessionId);
    if (exists) {
      return instance.sessionId;
    }
  }

  // Fallback: check if there's a single instance (any directory)
  const instances = getAgentInstances(teamName, agentName);
  if (instances.length === 1) {
    const exists = await sessionExists(serveUrl, instances[0].sessionId);
    if (exists) {
      return instances[0].sessionId;
    }
  }

  return null;
}

/**
 * Get or create session for an agent
 */
async function getOrCreateSession(teamName, agentName, serveUrl, projectDir) {
  // Try to find existing session
  const existingId = await getExistingSession(teamName, agentName, serveUrl, projectDir);
  if (existingId) {
    return existingId;
  }

  // Create new session with metadata
  const title = `${agentName} 控制台`;
  const metadata = {
    agent: `${teamName}/${agentName}`,
    team: teamName,
    role: agentName,
  };

  const session = await createSession(serveUrl, projectDir, title, metadata);
  if (!session) {
    return null;
  }

  const sessionId = session.id;

  // Initialize agent
  await postMessage(serveUrl, sessionId, projectDir, `${teamName}/${agentName}`, '系统初始化完成，准备就绪。');

  // Save active session
  addInstance(teamName, agentName, { sessionId, cwd: projectDir });

  return sessionId;
}

/**
 * Start command
 */
async function cmdStart(teamName, options) {
  teamName = teamName || 'team1';
  const projectDir = options.dir || process.cwd();

  // Check team config
  const teamConfig = loadTeamConfig(teamName);
  if (!teamConfig) {
    error(`团队配置不存在: ${path.join(PATHS.AGENTS_DIR, teamName, 'team.json')}`);
  }

  const leader = teamConfig.leader || 'pm';
  let host = teamConfig.host || DEFAULTS.HOST;
  let port = teamConfig.port || 0;

  // Check if already running
  if (isServeRunning(teamName)) {
    const runtime = getRuntime(teamName);
    info(`团队 ${teamName} 已在运行 (PID: ${runtime.pid}, Port: ${runtime.port})`);
    port = runtime.port;
    host = runtime.host;
  } else {
    // Auto assign port if needed
    if (port === 0) {
      port = await findAvailablePort();
    }

    info(`启动 ${teamName} 团队...`);
    console.log(`   Host: ${host}`);
    console.log(`   Port: ${port}`);
    console.log(`   项目: ${projectDir}`);
    console.log(`   Leader: ${leader}`);

    // Start serve
    const serveProcess = spawn('opencode', ['serve', '--port', String(port)], {
      detached: true,
      stdio: options.detach ? 'ignore' : 'inherit',
    });

    if (options.detach) {
      serveProcess.unref();
    }

    const servePid = serveProcess.pid;

    // Wait for serve to be ready
    console.log('   等待 serve 就绪...');
    const serveUrl = `http://${host}:${port}`;

    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`${serveUrl}/session?directory=${encodeURIComponent(projectDir)}`, {
          headers: { Accept: 'application/json' },
        });
        if (res.ok) break;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // Save runtime
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

  // Get or create leader session
  info(`准备 ${leader} 会话...`);
  const leaderSession = await getOrCreateSession(teamName, leader, serveUrl, projectDir);

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
 * Get any active session for an agent (for watch mode)
 */
async function getAnyExistingSession(teamName, agentName, serveUrl, cwd = null) {
  const instances = getAgentInstances(teamName, agentName);

  for (const inst of instances) {
    // If cwd specified, only match that instance
    if (cwd && inst.cwd !== cwd) continue;

    const exists = await sessionExists(serveUrl, inst.sessionId);
    if (exists) {
      return inst.sessionId;
    }
  }

  return null;
}

/**
 * Attach command
 */
async function cmdAttach(teamName, agentName, options) {
  teamName = teamName || 'team1';

  // Check if running
  if (!isServeRunning(teamName)) {
    error(`团队 ${teamName} 未运行，请先执行 'openteam start ${teamName}'`);
  }

  const runtime = getRuntime(teamName);
  const serveUrl = `http://${runtime.host}:${runtime.port}`;

  // Use leader if agent not specified
  if (!agentName) {
    agentName = getTeamLeader(teamName);
  }

  // Validate agent
  if (!isAgentInTeam(teamName, agentName)) {
    const teamConfig = loadTeamConfig(teamName);
    error(`团队 ${teamName} 中没有 ${agentName}，可选: ${teamConfig.agents.join(', ')}`);
  }

  // Watch mode: loop until interrupted
  if (options.watch) {
    const cwdHint = options.cwd ? ` (${options.cwd})` : '';
    console.log(`${BLUE}监视 ${teamName}/${agentName}${cwdHint}...${NC}`);
    console.log(`${YELLOW}按 Ctrl+C 退出${NC}`);
    console.log('');

    while (true) {
      const sessionId = await getAnyExistingSession(teamName, agentName, serveUrl, options.cwd);

      if (sessionId) {
        success(`连接到会话: ${sessionId}`);

        // Use spawn for non-blocking attach
        const attachProcess = spawn('opencode', ['attach', serveUrl, '-s', sessionId], {
          stdio: 'inherit',
          shell: true,
        });

        // Periodically check if session is still active (for free command)
        const checkInterval = setInterval(async () => {
          const currentSession = await getAnyExistingSession(teamName, agentName, serveUrl, options.cwd);
          if (currentSession !== sessionId) {
            // Session was freed, kill attach process
            attachProcess.kill('SIGTERM');
          }
        }, 2000);

        // Wait for attach to exit
        await new Promise((resolve) => {
          attachProcess.on('exit', resolve);
          attachProcess.on('error', resolve);
        });

        clearInterval(checkInterval);

        // Clear screen after TUI exits to clean up residual rendering
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

  // Normal mode: get or create session
  info(`附加到 ${teamName}/${agentName}...`);

  const sessionId = await getOrCreateSession(teamName, agentName, serveUrl, runtime.projectDir);

  if (!sessionId) {
    error(`无法获取 ${agentName} 会话`);
  }

  success(`会话: ${sessionId}`);
  execSync(`opencode attach "${serveUrl}" -s "${sessionId}"`, { stdio: 'inherit' });
}

/**
 * List command - show all configured teams with status
 */
function cmdList() {
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
    const leader = teamConfig?.leader || 'pm';
    const agents = teamConfig?.agents?.join(', ') || '-';

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
 * Stop command
 */
function cmdStop(teamName) {
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

  // Clear active sessions (they're no longer valid after stop)
  saveActiveSessions(teamName, {});

  // Close monitor session (tmux/zellij)
  const sessionName = `openteam-${teamName}`;
  try {
    execSync(`tmux kill-session -t "${sessionName}" 2>/dev/null`, { stdio: 'ignore' });
    info('tmux 会话已关闭');
  } catch {
    // tmux session doesn't exist or tmux not installed
  }
  try {
    execSync(`zellij delete-session "${sessionName}" --force 2>/dev/null`, { stdio: 'ignore' });
    info('zellij 会话已关闭');
  } catch {
    // zellij session doesn't exist or zellij not installed
  }

  success('已停止');
}

/**
 * Detect available terminal multiplexer
 */
function detectMultiplexer(options) {
  if (options.tmux) return 'tmux';
  if (options.zellij) return 'zellij';

  // Auto-detect: prefer zellij
  try {
    execSync('which zellij', { stdio: 'ignore' });
    return 'zellij';
  } catch {
    try {
      execSync('which tmux', { stdio: 'ignore' });
      return 'tmux';
    } catch {
      return null;
    }
  }
}

/**
 * Check if multiplexer session exists
 */
function sessionExistsInMux(mux, sessionName) {
  try {
    if (mux === 'tmux') {
      execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, { stdio: 'ignore' });
      return true;
    } else if (mux === 'zellij') {
      const output = execSync('zellij list-sessions 2>/dev/null', { encoding: 'utf8' });
      return output.includes(sessionName);
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Split agents into groups of 4
 */
function chunkAgents(agents, size = 4) {
  const chunks = [];
  for (let i = 0; i < agents.length; i += size) {
    const chunk = agents.slice(i, i + size);
    // Pad to 4 if less
    while (chunk.length < size) {
      chunk.push(chunk[chunk.length - 1]);
    }
    chunks.push(chunk);
  }
  return chunks;
}

/**
 * Create a 2x2 grid in tmux window
 */
function createTmux2x2Grid(sessionName, windowIndex, teamName, agents) {
  const cmds = agents.map((agent) => `openteam attach ${teamName} ${agent} --watch`);
  const target = `${sessionName}:${windowIndex}`;

  if (windowIndex === 0) {
    // First window: create session
    execSync(`tmux new-session -d -s "${sessionName}" "${cmds[0]}"`, { stdio: 'ignore' });
  } else {
    // Additional windows
    execSync(`tmux new-window -t "${sessionName}" "${cmds[0]}"`, { stdio: 'ignore' });
  }

  // Split horizontally (top-right)
  execSync(`tmux split-window -h -t "${target}" "${cmds[1]}"`, { stdio: 'ignore' });
  execSync(`tmux select-layout -t "${target}" tiled`, { stdio: 'ignore' });

  // Split top-left vertically (bottom-left)
  execSync(`tmux select-pane -t "${target}.0"`, { stdio: 'ignore' });
  execSync(`tmux split-window -v -t "${target}" "${cmds[2]}"`, { stdio: 'ignore' });

  // Split top-right vertically (bottom-right)
  execSync(`tmux select-pane -t "${target}.1"`, { stdio: 'ignore' });
  execSync(`tmux split-window -v -t "${target}" "${cmds[3]}"`, { stdio: 'ignore' });

  // Apply tiled layout
  execSync(`tmux select-layout -t "${target}" tiled`, { stdio: 'ignore' });
}

/**
 * Create tmux session with multiple windows (each 2x2 grid)
 */
function createTmuxSession(sessionName, teamName, agents) {
  const chunks = chunkAgents(agents);

  chunks.forEach((chunk, index) => {
    createTmux2x2Grid(sessionName, index, teamName, chunk);
  });

  // Select first window and pane
  execSync(`tmux select-window -t "${sessionName}:0"`, { stdio: 'ignore' });
  execSync(`tmux select-pane -t "${sessionName}:0.0"`, { stdio: 'ignore' });
}

/**
 * Generate zellij tab content for a group of 4 agents
 */
function generateZellijTab(tabName, teamName, agents) {
  const cmds = agents.map((agent) => `openteam attach ${teamName} ${agent} --watch`);

  return `    tab name="${tabName}" {
        pane split_direction="vertical" {
            pane split_direction="horizontal" {
                pane command="bash" name="${agents[0]}" {
                    args "-c" "${cmds[0]}"
                }
                pane command="bash" name="${agents[2]}" {
                    args "-c" "${cmds[2]}"
                }
            }
            pane split_direction="horizontal" {
                pane command="bash" name="${agents[1]}" {
                    args "-c" "${cmds[1]}"
                }
                pane command="bash" name="${agents[3]}" {
                    args "-c" "${cmds[3]}"
                }
            }
        }
    }`;
}

/**
 * Create zellij layout file with multiple tabs
 */
function createZellijLayout(sessionName, teamName, agents) {
  const chunks = chunkAgents(agents);

  const tabs = chunks.map((chunk, index) => {
    const tabName = chunks.length === 1 ? sessionName : `${sessionName}-${index + 1}`;
    return generateZellijTab(tabName, teamName, chunk);
  }).join('\n');

  const layoutContent = `layout {
    default_tab_template {
        pane size=1 borderless=true {
            plugin location="tab-bar"
        }
        children
        pane size=2 borderless=true {
            plugin location="status-bar"
        }
    }
${tabs}
}`;

  const layoutPath = `/tmp/openteam-${sessionName}.kdl`;
  fs.writeFileSync(layoutPath, layoutContent);
  return layoutPath;
}

/**
 * Monitor command - open all agents in split terminal
 */
async function cmdMonitor(teamName, options) {
  teamName = teamName || 'team1';
  const projectDir = options.dir || process.cwd();

  // Check team config
  const teamConfig = loadTeamConfig(teamName);
  if (!teamConfig) {
    error(`团队配置不存在: ${path.join(PATHS.AGENTS_DIR, teamName, 'team.json')}`);
  }

  const agents = teamConfig.agents || [];
  if (agents.length === 0) {
    error('团队没有配置任何 agent');
  }

  // Detect multiplexer
  const mux = detectMultiplexer(options);
  if (!mux) {
    error('未找到 tmux 或 zellij，请先安装其中一个');
  }

  info(`使用 ${mux} 监控 ${teamName}...`);

  // Check if team is running, start if not
  if (!isServeRunning(teamName)) {
    info(`团队 ${teamName} 未运行，正在启动...`);
    await cmdStart(teamName, { detach: true, dir: projectDir });
  }

  const sessionName = `openteam-${teamName}`;

  // Check for existing session
  if (sessionExistsInMux(mux, sessionName)) {
    info(`发现已有会话 ${sessionName}，正在附加...`);
    if (mux === 'tmux') {
      execSync(`tmux attach -t "${sessionName}"`, { stdio: 'inherit' });
    } else {
      execSync(`zellij attach "${sessionName}"`, { stdio: 'inherit' });
    }
    return;
  }

  const numWindows = Math.ceil(agents.length / 4);
  info('各 pane 将自动监视对应 agent 的会话状态');
  console.log(`  agents: ${agents.join(', ')}`);
  if (numWindows > 1) {
    console.log(`  布局: ${numWindows} 个窗口/tab，每个 2x2`);
  }
  console.log('');

  // Create session with layout
  info(`创建 ${mux} 会话...`);

  // Record monitor info to runtime
  setMonitorInfo(teamName, { mux, sessionName });

  if (mux === 'tmux') {
    createTmuxSession(sessionName, teamName, agents);
    success(`会话 ${sessionName} 已创建`);
    execSync(`tmux attach -t "${sessionName}"`, { stdio: 'inherit' });
  } else {
    const layoutPath = createZellijLayout(sessionName, teamName, agents);
    success(`会话 ${sessionName} 创建中...`);
    // -n forces new session even if inside existing session, -s names it
    execSync(`zellij -n "${layoutPath}" -s "${sessionName}"`, { stdio: 'inherit' });
  }

  // Clear monitor info when exiting
  clearMonitorInfo(teamName);
}

/**
 * Status command
 */
async function cmdStatus(teamName) {
  if (!teamName) {
    error('请指定团队名称');
  }

  const runtime = getRuntime(teamName);
  if (!runtime) {
    console.log(`团队 ${teamName}: ${RED}未运行${NC}`);
    return;
  }

  const teamConfig = loadTeamConfig(teamName);
  const leader = teamConfig?.leader || 'pm';

  console.log(`团队: ${GREEN}${teamName}${NC}`);
  console.log(`状态: ${GREEN}运行中${NC}`);
  console.log(`Serve: http://${runtime.host}:${runtime.port} (PID: ${runtime.pid})`);
  console.log(`Leader: ${leader}`);
  console.log(`项目: ${runtime.projectDir}`);
  console.log(`启动于: ${runtime.started}`);
  console.log('');

  // Show active sessions
  console.log('活跃会话:');
  const activeSessions = loadActiveSessions(teamName);
  const serveUrl = `http://${runtime.host}:${runtime.port}`;

  for (const [agent, instances] of Object.entries(activeSessions)) {
    // Handle both new format (array) and legacy format (string)
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

// CLI setup
program
  .name('openteam')
  .description('Team management for OpenCode')
  .version('0.1.0');

program
  .command('start [team]')
  .description('启动团队 serve')
  .option('-d, --detach', '后台运行')
  .option('--dir <directory>', '项目目录')
  .action(cmdStart);

program
  .command('attach [team] [agent]')
  .description('附加到 agent 会话')
  .option('-w, --watch', '监视模式，自动跟随会话状态')
  .option('--cwd <directory>', '指定实例的工作目录')
  .action(cmdAttach);

program
  .command('list')
  .description('列出运行中的团队')
  .action(cmdList);

program
  .command('stop <team>')
  .description('停止团队')
  .action(cmdStop);

program
  .command('status <team>')
  .description('查看团队状态')
  .action(cmdStatus);

program
  .command('monitor [team]')
  .description('分屏监控所有 agent')
  .option('--tmux', '强制使用 tmux')
  .option('--zellij', '强制使用 zellij')
  .option('--dir <directory>', '项目目录')
  .action(cmdMonitor);

program.parse();
