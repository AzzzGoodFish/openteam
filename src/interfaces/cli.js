/**
 * CLI 命令实现 — 编排 capabilities 和 foundation 完成用户操作
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { getSessionName, getSessionPrefix, getTeamDir } from '../foundation/constants.js';
import { loadTeamConfig, listTeams, validateTeamConfig } from '../foundation/config.js';
import {
  getRuntime,
  clearRuntime,
  findAvailablePort,
  listRunningInstances,
  listAllRunningInstances,
  listAllInstances,
} from '../foundation/state.js';
import { detectMultiplexer, getSessionState, hasSession, findSessionsByPrefix, attachSession, startSession, killSession, isInsideMux } from '../foundation/terminal.js';
import { buildWrapperCmd } from './daemon/panes.js';

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

  const cliType = options.cli || teamConfig.default_cli || 'claude-code';
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

  const daemonCmd = `openteam daemon ${teamName} --port ${port} --dir "${projectDir}" --mux ${mux} --cli ${cliType}`;

  // zellij: 构建 wrapper 命令，由 team layout 的 stacked panes 自动调用
  const cliArgs = teamConfig.cli_config?.[cliType]?.args || [];
  const wrapperOptions = {
    serverUrl: `http://127.0.0.1:${port}`,
    teamName, projectDir, cliType,
    agents: teamConfig.agents,
    cliArgs,
  };
  const agentCmds = mux === 'zellij' ? teamConfig.agents.map(agent => ({
    name: agent,
    cmd: buildWrapperCmd(agent, wrapperOptions, { mux, sessionName }),
    expanded: agent === teamConfig.leader,
  })) : [];

  info(`启动 ${teamName} 团队...`);
  console.log(`  复用器: ${mux}`);
  console.log(`  CLI:    ${cliType}`);
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
      port: String(inst.runtime.server?.port || inst.runtime.serverPort || '—'),
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
    for (const tn of neverRunTeams) {
      const { leader, others } = getTeamMembers(tn);
      rows.push({
        id: '—', team: tn,
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
  const daemonPid = runtime.daemon?.pid || runtime.daemonPid;
  const sessionName = runtime.mux?.session;
  info(`停止团队 ${teamName} (daemon PID: ${daemonPid})...`);

  try {
    process.kill(daemonPid, 'SIGTERM');
  } catch {
    // 进程已不存在
  }

  // 等 daemon 退出，然后清理 mux session（daemon 只管 server + runtime，不管 session）
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
 * 查看团队运行状态（从 runtime + server API 获取）
 */
export async function cmdInspect(teamName, options = {}) {
  if (!teamName) {
    error('请指定团队名称');
  }

  const { projectDir, runtime } = resolveInstance(teamName, options);
  const teamConfig = loadTeamConfig(teamName);
  const leader = teamConfig?.leader || `${RED}未配置${NC}`;
  const serveUrl = runtime.server ? `http://${runtime.server.host}:${runtime.server.port}` : 'N/A';

  console.log(`团队: ${GREEN}${teamName}${NC}`);
  console.log(`状态: ${GREEN}运行中${NC}`);
  if (runtime.daemon?.pid) {
    console.log(`Daemon: PID ${runtime.daemon.pid}`);
  }
  console.log(`Server: ${serveUrl}`);
  console.log(`Leader: ${leader}`);
  console.log(`项目: ${runtime.projectDir || projectDir}`);
  console.log(`启动于: ${runtime.started}`);
  console.log('');

  // 从 server API 获取 agent 状态
  try {
    const res = await fetch(`${serveUrl}/api/status`);
    if (res.ok) {
      const data = await res.json();
      const status = data.status || {};
      console.log('Agent 状态:');
      for (const agent of teamConfig.agents) {
        const info = status[agent];
        if (info?.online) {
          const pending = info.pending > 0 ? ` (${info.pending} pending)` : '';
          console.log(`  ${GREEN}●${NC} ${agent}${pending}`);
        } else {
          console.log(`  ${RED}○${NC} ${agent} ${DIM}(offline)${NC}`);
        }
      }
    } else {
      console.log(`${YELLOW}Server 不可达${NC}`);
    }
  } catch {
    console.log(`${YELLOW}Server 不可达${NC}`);
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

// ── readline 辅助 ──

function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (question, defaultVal) => new Promise(resolve => {
      const suffix = defaultVal ? ` (${defaultVal})` : '';
      rl.question(`${question}${suffix}: `, answer => {
        resolve(answer.trim() || defaultVal || '');
      });
    }),
    close: () => rl.close(),
  };
}

/**
 * 扫描内置团队模板
 * 模板在 examples/ 下，每个子目录含 team.json + agent .md 文件 + skills/
 * @returns {Array<{ id: string, dir: string, config: object, readme: string|null }>}
 */
function listTemplates() {
  // 从 bin/openteam.js 回溯到项目根目录
  const projectRoot = path.resolve(import.meta.url.replace('file://', ''), '..', '..', '..');
  const examplesDir = path.join(projectRoot, 'examples');
  if (!fs.existsSync(examplesDir)) return [];

  const results = [];
  for (const entry of fs.readdirSync(examplesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(examplesDir, entry.name);
    const configPath = path.join(dir, 'team.json');
    if (!fs.existsSync(configPath)) continue;

    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      let readme = null;
      const readmePath = path.join(dir, 'readme.md');
      if (fs.existsSync(readmePath)) {
        // 取第一行非空非标题行作为描述
        const lines = fs.readFileSync(readmePath, 'utf8').split('\n');
        readme = lines.find(l => l.trim() && !l.startsWith('#'))?.trim() || null;
      }
      results.push({ id: entry.name, dir, config, readme });
    } catch {
      // 跳过无效模板
    }
  }
  return results;
}

/**
 * 安装团队模板 — 从 examples/ 复制到 ~/.openteam/
 *
 * 交互流程：
 *   1. 选择内置团队模板
 *   2. 设置团队名称
 *   3. 选择默认 CLI
 *   4. 是否跳过权限检查
 *   5. 复制 team.json + agent 定义 + skills
 */
export async function cmdSetup(options = {}) {
  const prompt = createPrompt();

  try {
    // ── 1. 扫描模板 ──
    const templates = listTemplates();
    if (templates.length === 0) {
      error('未找到内置团队模板（examples/ 目录缺失）');
    }

    // ── 2. 选择模板 ──
    let template;
    if (options.template) {
      template = templates.find(t => t.id === options.template);
      if (!template) error(`未找到模板 "${options.template}"，可用: ${templates.map(t => t.id).join(', ')}`);
    } else {
      console.log(`${BOLD}可用团队模板:${NC}\n`);
      templates.forEach((t, i) => {
        const agents = t.config.agents?.join(', ') || '—';
        const desc = t.readme || '';
        console.log(`  ${GREEN}${i + 1})${NC} ${BOLD}${t.id}${NC}`);
        console.log(`     ${desc}`);
        console.log(`     ${DIM}agents: ${agents}${NC}`);
        console.log('');
      });

      if (templates.length === 1) {
        const confirm = await prompt.ask(`安装 "${templates[0].id}"? (Y/n)`, 'Y');
        if (confirm.toLowerCase() === 'n') { info('已取消'); return; }
        template = templates[0];
      } else {
        const choice = await prompt.ask('选择模板 (序号)', '1');
        const idx = parseInt(choice) - 1;
        if (idx < 0 || idx >= templates.length) error('无效选择');
        template = templates[idx];
      }
    }

    // ── 3. 团队名称 ──
    let teamName;
    if (options.name) {
      teamName = options.name;
    } else {
      teamName = await prompt.ask('团队名称', template.config.name || 'team1');
    }

    // 检查是否已存在
    const existing = loadTeamConfig(teamName);
    if (existing) {
      const overwrite = await prompt.ask(`团队 "${teamName}" 已存在，是否覆盖? (y/N)`, 'N');
      if (overwrite.toLowerCase() !== 'y') { info('已取消'); return; }
    }

    // ── 4. 默认 CLI ──
    let defaultCli;
    if (options.cli) {
      defaultCli = options.cli;
    } else {
      defaultCli = await prompt.ask('默认 CLI', template.config.default_cli || 'claude-code');
    }

    // ── 5. 权限模式 ──
    let bypass = false;
    if (options.bypass) {
      bypass = true;
    } else if (defaultCli === 'claude-code') {
      const answer = await prompt.ask('启用 yolo 模式? (y/N)', 'N');
      bypass = answer.toLowerCase() === 'y';
    }

    // ── 6. 写入 team.json ──
    const config = {
      ...template.config,
      name: teamName,
      default_cli: defaultCli,
    };
    // 清理模板中可能有的占位字段
    delete config.host;
    delete config.port;

    if (bypass && defaultCli === 'claude-code') {
      config.cli_config = {
        'claude-code': {
          args: ['--permission-mode', 'bypassPermissions'],
        },
      };
    }

    const teamDir = getTeamDir(teamName);
    if (!fs.existsSync(teamDir)) {
      fs.mkdirSync(teamDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(teamDir, 'team.json'),
      JSON.stringify(config, null, 2) + '\n',
    );

    // ── 7. 复制 agent 定义文件 ──
    const { PATHS } = await import('../foundation/constants.js');
    const agentsDefsDir = PATHS.AGENTS_DEFS_DIR;
    if (!fs.existsSync(agentsDefsDir)) fs.mkdirSync(agentsDefsDir, { recursive: true });

    let agentsCopied = 0;
    for (const agent of config.agents) {
      const src = path.join(template.dir, `${agent}.md`);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(agentsDefsDir, `${agent}.md`));
        agentsCopied++;
      }
    }

    // ── 8. 复制 skills ──
    const skillsDir = PATHS.SKILLS_DIR;
    if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });

    let skillsCopied = 0;
    const templateSkillsDir = path.join(template.dir, 'skills');
    if (fs.existsSync(templateSkillsDir)) {
      for (const entry of fs.readdirSync(templateSkillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const src = path.join(templateSkillsDir, entry.name);
        const dest = path.join(skillsDir, entry.name);
        copyDirSync(src, dest);
        skillsCopied++;
      }
    }

    // ── 输出结果 ──
    console.log('');
    success(`团队 "${teamName}" 安装完成`);
    console.log('');
    console.log(`  模板:     ${template.id}`);
    console.log(`  团队配置: ${path.join(teamDir, 'team.json')}`);
    console.log(`  Leader:   ${config.leader}`);
    console.log(`  Agents:   ${config.agents.join(', ')}`);
    console.log(`  CLI:      ${defaultCli}`);
    if (bypass) console.log(`  权限:     ${YELLOW}bypassPermissions${NC}`);
    if (agentsCopied > 0) console.log(`  Agent 定义: ${agentsCopied} 个 → ${agentsDefsDir}`);
    if (skillsCopied > 0) console.log(`  Skills:   ${skillsCopied} 个 → ${skillsDir}`);
    console.log('');
    console.log(`使用 ${GREEN}openteam start ${teamName}${NC} 启动团队`);
  } finally {
    prompt.close();
  }
}

/**
 * 递归复制目录
 */
function copyDirSync(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}


