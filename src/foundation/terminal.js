/**
 * 终端复用器（tmux / zellij）统一抽象
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createLogger } from './logger.js';

const log = createLogger('terminal');
const ANSI_ESCAPE_REGEX = /\x1b\[[0-9;]*m/g;

/**
 * 解析 zellij list-sessions 输出
 */
export function parseZellijSessions(output) {
  return output
    .split('\n')
    .map(line => line.replace(ANSI_ESCAPE_REGEX, '').trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(.+?)(?:\s+\[|$)/);
      const name = match?.[1]?.trim() || line;
      return {
        name,
        exited: line.includes('(EXITED'),
        raw: line,
      };
    });
}

function getZellijSessions() {
  const output = execSync('zellij list-sessions 2>/dev/null', { encoding: 'utf8' });
  return parseZellijSessions(output);
}

/**
 * 获取会话状态
 * @returns {'active'|'exited'|null}
 */
export function getSessionState(mux, sessionName) {
  try {
    if (mux === 'tmux') {
      execSync(`tmux has-session -t "${sessionName}" 2>/dev/null`, { stdio: 'ignore' });
      return 'active';
    }
    if (mux === 'zellij') {
      const session = getZellijSessions().find(item => item.name === sessionName);
      if (!session) return null;
      return session.exited ? 'exited' : 'active';
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * 清理 zellij resurrection 缓存
 */
export function cleanupZellijSessionArtifacts(sessionName, cacheRoot = path.join(process.env.HOME, '.cache', 'zellij')) {
  if (!fs.existsSync(cacheRoot)) return;
  for (const ver of fs.readdirSync(cacheRoot)) {
    const sessionDir = path.join(cacheRoot, ver, 'session_info', sessionName);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  }
}

/**
 * 检测可用的终端复用器
 * @param {object} options - { tmux?, zellij? } 可强制指定
 * @returns {'tmux' | 'zellij' | null}
 */
export function detectMultiplexer(options = {}) {
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
 * 检查 multiplexer 会话是否存在
 */
export function hasSession(mux, sessionName) {
  return getSessionState(mux, sessionName) === 'active';
}

/**
 * 同时检查 tmux/zellij 是否存在该会话（含 exited 快照）
 * @returns {{ any: boolean, tmux: boolean, zellij: boolean }}
 */
export function hasSessionAny(sessionName) {
  const tmux = getSessionState('tmux', sessionName) !== null;
  const zellij = getSessionState('zellij', sessionName) !== null;
  return { any: tmux || zellij, tmux, zellij };
}

/**
 * 按前缀查找所有 mux 会话名（含 exited 快照），用于清理残留
 * @returns {string[]}
 */
export function findSessionsByPrefix(prefix) {
  const results = [];
  // tmux
  try {
    const output = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null', { encoding: 'utf8' });
    for (const name of output.split('\n').filter(Boolean)) {
      if (name.startsWith(prefix)) results.push(name);
    }
  } catch {
    // tmux not running or not installed
  }
  // zellij（含 exited）
  try {
    for (const s of getZellijSessions()) {
      if (s.name.startsWith(prefix)) results.push(s.name);
    }
  } catch {
    // zellij not installed
  }
  return [...new Set(results)];
}

/**
 * 附加到已有 mux 会话（阻塞直到用户退出）
 */
export function attachSession(mux, sessionName) {
  if (mux === 'tmux') {
    execSync(`tmux attach -t "${sessionName}"`, { stdio: 'inherit' });
  } else if (mux === 'zellij') {
    execSync(`zellij attach "${sessionName}"`, { stdio: 'inherit' });
  }
}

/**
 * 销毁 mux 会话（同时尝试 tmux 和 zellij）
 */
export function killSession(sessionName) {
  try {
    execSync(`tmux kill-session -t "${sessionName}" 2>/dev/null`, { stdio: 'ignore' });
  } catch {
    // tmux session doesn't exist or tmux not installed
  }
  try {
    execSync(`zellij kill-session "${sessionName}" 2>/dev/null`, { stdio: 'ignore' });
  } catch {
    // zellij active session doesn't exist or zellij not installed
  }
  try {
    execSync(`zellij delete-session "${sessionName}" --force 2>/dev/null`, { stdio: 'ignore' });
  } catch {
    // zellij session doesn't exist or zellij not installed
  }
  // 清理 zellij session resurrection 缓存，防止新建同名 session 时恢复旧 layout
  try {
    cleanupZellijSessionArtifacts(sessionName);
  } catch {
    // ignore
  }
}

// ── Daemon 导向的 pane 管理 API ──

/**
 * 检测当前是否在 tmux/zellij session 内部
 */
export function isInsideMux() {
  return !!(process.env.TMUX || process.env.ZELLIJ);
}

/**
 * 清理 mux 环境变量，让子进程能操作目标 session 而非嵌套
 */
export function cleanMuxEnv() {
  const env = { ...process.env };
  delete env.TMUX;
  delete env.TMUX_PANE;
  delete env.ZELLIJ;
  delete env.ZELLIJ_SESSION_NAME;
  return env;
}

/**
 * 获取 tmux session 的 pane 总数
 */
function getTmuxPaneCount(sessionName, env) {
  try {
    const output = execSync(
      `tmux list-panes -t "${sessionName}" -a | wc -l`,
      { encoding: 'utf8', env }
    ).trim();
    return parseInt(output) || 0;
  } catch {
    return 0;
  }
}

/**
 * 等待 zellij session 出现
 */
function waitForZellijSession(sessionName) {
  for (let i = 0; i < 10; i++) {
    if (hasSession('zellij', sessionName)) return true;
    execSync('sleep 0.5');
  }
  return false;
}

/**
 * 生成 zellij 单 pane tab layout，保留默认 tab/status bar
 */
function writeZellijTabLayout(sessionName, tabName, cmd) {
  const safeName = tabName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const escapedTabName = tabName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedCmd = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const layout = `layout {
  tab name="${escapedTabName}" {
    pane size=1 borderless=true {
      plugin location="zellij:tab-bar"
    }
    pane command="bash" name="${escapedTabName}" {
      args "-lc" "exec ${escapedCmd}"
    }
    pane size=1 borderless=true {
      plugin location="zellij:status-bar"
    }
  }
}`;
  const layoutPath = path.join('/tmp', `openteam-zellij-${sessionName}-${safeName}.kdl`);
  fs.writeFileSync(layoutPath, layout);
  return layoutPath;
}

/**
 * 生成 zellij stacked tab layout，所有 panes 折叠在一个 tab 中
 *
 * stacked pane：只有一个 pane 展开全屏，其余折叠为标题栏。
 * expanded=true 的 pane 启动时默认展开（通常是 leader）。
 *
 * @param {string} sessionName - session 名
 * @param {string} tabName - tab 名
 * @param {Array<{name: string, cmd: string, expanded?: boolean}>} panes - pane 定义
 * @returns {string} layout 文件路径
 */
function writeZellijStackedTabLayout(sessionName, tabName, panes) {
  const escapedTabName = tabName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const paneEntries = panes.map(p => {
    const eName = p.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const eCmd = p.cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const attrs = p.expanded ? ' expanded=true' : '';
    return `      pane command="bash" name="${eName}"${attrs} {\n        args "-lc" "exec ${eCmd}"\n      }`;
  }).join('\n');

  const layout = `layout {
  tab name="${escapedTabName}" {
    pane size=1 borderless=true {
      plugin location="zellij:tab-bar"
    }
    pane stacked=true {
${paneEntries}
    }
    pane size=1 borderless=true {
      plugin location="zellij:status-bar"
    }
  }
}`;
  const layoutPath = path.join('/tmp', `openteam-zellij-${sessionName}-stacked.kdl`);
  fs.writeFileSync(layoutPath, layout);
  return layoutPath;
}

/**
 * 生成 zellij session layout（daemon only，含 default_tab_template）
 */
function writeZellijSessionLayout(sessionName, daemonTabName, cmd) {
  const escapedTabName = daemonTabName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const escapedCmd = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const layout = `layout {
  default_tab_template {
    pane size=1 borderless=true {
      plugin location="zellij:tab-bar"
    }
    children
    pane size=1 borderless=true {
      plugin location="zellij:status-bar"
    }
  }

  tab name="${escapedTabName}" focus=true {
    pane command="bash" name="${escapedTabName}" {
      args "-lc" "exec ${escapedCmd}"
    }
  }
}`;
  const layoutPath = path.join('/tmp', `openteam-zellij-${sessionName}-session.kdl`);
  fs.writeFileSync(layoutPath, layout);
  return layoutPath;
}

/**
 * 生成 zellij team layout — 同屏显示 dashboard + stacked agents
 *
 * 左侧 30%: daemon（嵌入式 dashboard）
 * 右侧 70%: stacked agents（leader 默认展开，其余折叠为标题栏）
 *
 * @param {string} sessionName
 * @param {string} daemonCmd - daemon 启动命令
 * @param {Array<{name: string, cmd: string, expanded?: boolean}>} agents
 */
function writeZellijTeamLayout(sessionName, daemonCmd, agents) {
  const eDaemonCmd = daemonCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const paneEntries = agents.map(a => {
    const eName = a.name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const eCmd = a.cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const attrs = a.expanded ? ' expanded=true' : '';
    return `        pane command="bash" name="${eName}"${attrs} {\n          args "-lc" "exec ${eCmd}"\n        }`;
  }).join('\n');

  const layout = `layout {
  default_tab_template {
    pane size=1 borderless=true {
      plugin location="zellij:tab-bar"
    }
    children
    pane size=1 borderless=true {
      plugin location="zellij:status-bar"
    }
  }

  tab name="team" focus=true {
    pane split_direction="vertical" {
      pane command="bash" name="daemon" size="30%" {
        args "-lc" "exec ${eDaemonCmd}"
      }
      pane stacked=true {
${paneEntries}
      }
    }
  }
}`;
  const layoutPath = path.join('/tmp', `openteam-zellij-${sessionName}-team.kdl`);
  fs.writeFileSync(layoutPath, layout);
  return layoutPath;
}

/**
 * 创建 zellij session，daemon 作为 command pane 运行
 *
 * 用 -l layout 一步创建 session + daemon tab。
 * background session 没有 focus 状态，rename-tab/close-pane 等依赖 focus 的 action 全部不可靠，
 * 只有 layout 方式能可靠地定义 tab 名称和 command pane。
 */
function bootstrapZellijSession(sessionName, cmd) {
  const env = cleanMuxEnv();
  const layoutPath = writeZellijSessionLayout(sessionName, 'daemon', cmd);
  execSync(`zellij -l "${layoutPath}" attach "${sessionName}" --create-background`, { stdio: 'ignore', env });
  if (!waitForZellijSession(sessionName)) {
    throw new Error(`zellij session not ready: ${sessionName}`);
  }
}

/**
 * 统一启动 mux session — 正确处理 tmux/zellij 的根本差异
 *
 * tmux: 先 new-session -d（detached），foreground 时再 attach；agent panes 由 daemon 动态创建
 * zellij: 用 layout 一步创建 session（background session 无 focus，不能用 action 操作 pane）
 *   - 有 agents: team layout — daemon 左侧 30% + stacked agents 右侧 70%，agent 自行 attach
 *   - 无 agents: daemon-only layout（兼容非团队模式）
 *
 * @param {'tmux'|'zellij'} mux
 * @param {string} sessionName
 * @param {string} cmd - daemon 命令
 * @param {object} options
 * @param {boolean} options.foreground - true = 阻塞直到用户退出
 * @param {Array<{name: string, cmd: string, expanded?: boolean}>} options.agents - agent pane 定义（仅 zellij）
 */
export function startSession(mux, sessionName, cmd, { foreground = false, agents = [] } = {}) {
  if (mux === 'tmux') {
    const env = cleanMuxEnv();
    execSync(`tmux new-session -d -s "${sessionName}" "${cmd}"`, { stdio: 'ignore', env });
    if (foreground) {
      execSync(`tmux attach -t "${sessionName}"`, { stdio: 'inherit', env });
    }
  } else if (mux === 'zellij') {
    if (agents.length > 0) {
      // team layout: daemon + stacked agents 同屏
      const env = cleanMuxEnv();
      const layoutPath = writeZellijTeamLayout(sessionName, cmd, agents);
      execSync(`zellij -l "${layoutPath}" attach "${sessionName}" --create-background`, { stdio: 'ignore', env });
      if (!waitForZellijSession(sessionName)) {
        throw new Error(`zellij session not ready: ${sessionName}`);
      }
    } else {
      bootstrapZellijSession(sessionName, cmd);
    }
    if (foreground) {
      attachSession(mux, sessionName);
    }
  }
}

/**
 * 向已有 session 添加单个 agent pane
 * @returns {string|null} pane 标识符
 */
export function addAgentPane(mux, sessionName, cmd, paneName) {
  try {
    if (mux === 'tmux') {
      const env = cleanMuxEnv();
      const paneCount = getTmuxPaneCount(sessionName, env);
      if (paneCount > 0 && paneCount % 4 === 0) {
        execSync(`tmux new-window -t "${sessionName}" -n "${paneName}" "${cmd}"`, { stdio: 'ignore', env });
      } else {
        execSync(`tmux split-window -t "${sessionName}" "${cmd}"`, { stdio: 'ignore', env });
        execSync(`tmux select-layout -t "${sessionName}" tiled`, { stdio: 'ignore', env });
      }
      return paneName;
    } else if (mux === 'zellij') {
      const env = cleanMuxEnv();
      const layoutPath = writeZellijTabLayout(sessionName, paneName, cmd);
      execSync(`zellij --session "${sessionName}" action new-tab --name "${paneName}" --layout "${layoutPath}"`, { stdio: 'ignore', env });
      return paneName;
    }
  } catch (err) {
    log.warn('addAgentPane failed', { mux, sessionName, paneName, error: err.message });
    return null;
  }
}

/**
 * 创建 zellij stacked tab（所有 agent panes 折叠在一个 tab 中）
 *
 * @param {string} sessionName - session 名
 * @param {string} tabName - tab 名
 * @param {Array<{name: string, cmd: string, expanded?: boolean}>} panes
 * @returns {boolean}
 */
export function addStackedTab(sessionName, tabName, panes) {
  try {
    const env = cleanMuxEnv();
    const layoutPath = writeZellijStackedTabLayout(sessionName, tabName, panes);
    execSync(`zellij --session "${sessionName}" action new-tab --layout "${layoutPath}"`, { stdio: 'ignore', env });
    return true;
  } catch (err) {
    log.warn('addStackedTab failed', { sessionName, tabName, error: err.message });
    return false;
  }
}

/**
 * 列出 session 中所有 pane 的状态
 * @returns {Array<{id: string, name: string, alive: boolean, cmd: string}>}
 */
export function listPanes(mux, sessionName) {
  try {
    if (mux === 'tmux') {
      const env = cleanMuxEnv();
      const output = execSync(
        `tmux list-panes -t "${sessionName}" -a -F "#{pane_id}|#{pane_title}|#{pane_dead}|#{pane_current_command}"`,
        { encoding: 'utf8', env }
      ).trim();
      if (!output) return [];
      return output.split('\n').map(line => {
        const [id, name, dead, cmd] = line.split('|');
        return { id, name: name || '', alive: dead !== '1', cmd: cmd || '' };
      });
    } else if (mux === 'zellij') {
      const env = cleanMuxEnv();
      const layout = execSync(`zellij --session "${sessionName}" action dump-layout`, { encoding: 'utf8', env });
      const panes = [];
      const matches = layout.matchAll(/pane.*?name="([^"]+)"/g);
      for (const m of matches) {
        panes.push({ id: m[1], name: m[1], alive: true, cmd: '' });
      }
      return panes;
    }
  } catch (err) {
    log.warn('listPanes failed', { mux, sessionName, error: err.message });
    return [];
  }
}

/**
 * 重启指定 pane
 */
export function respawnPane(mux, sessionName, paneId, cmd) {
  try {
    if (mux === 'tmux') {
      const env = cleanMuxEnv();
      execSync(`tmux respawn-pane -t "${paneId}" -k "${cmd}"`, { stdio: 'ignore', env });
      return true;
    } else if (mux === 'zellij') {
      const env = cleanMuxEnv();
      const layoutPath = writeZellijTabLayout(sessionName, paneId, cmd);
      execSync(`zellij --session "${sessionName}" action new-tab --name "${paneId}" --layout "${layoutPath}"`, { stdio: 'ignore', env });
      return true;
    }
  } catch (err) {
    log.warn('respawnPane failed', { mux, sessionName, paneId, error: err.message });
    return false;
  }
}
