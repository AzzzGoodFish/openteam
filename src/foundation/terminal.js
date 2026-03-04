/**
 * 终端复用器（tmux / zellij）统一抽象
 */

import fs from 'fs';
import { execSync } from 'child_process';

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
    execSync(`zellij delete-session "${sessionName}" --force 2>/dev/null`, { stdio: 'ignore' });
  } catch {
    // zellij session doesn't exist or zellij not installed
  }
}

// ── Daemon 导向的 pane 管理 API ──

/**
 * 清理 TMUX 环境变量，避免嵌套 tmux 问题
 */
function cleanTmuxEnv() {
  const env = { ...process.env };
  delete env.TMUX;
  delete env.TMUX_PANE;
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
 * 创建 mux session，首个 pane 运行指定命令
 * 用于 daemon 启动：pane 0 = daemon 进程
 */
export function createSessionWithCmd(mux, sessionName, cmd) {
  if (mux === 'tmux') {
    const env = cleanTmuxEnv();
    execSync(`tmux new-session -d -s "${sessionName}" "${cmd}"`, { stdio: 'ignore', env });
  } else if (mux === 'zellij') {
    const layout = `layout {
    tab name="${sessionName}" {
        pane command="bash" name="daemon" {
            args "-c" "${cmd}"
        }
    }
}`;
    const layoutPath = `/tmp/openteam-daemon-${sessionName}.kdl`;
    fs.writeFileSync(layoutPath, layout);
    execSync(`zellij -n "${layoutPath}" -s "${sessionName}" &`, { stdio: 'ignore' });
    // 等待 session 创建
    for (let i = 0; i < 10; i++) {
      if (hasSession('zellij', sessionName)) break;
      execSync('sleep 0.5');
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
      const env = cleanTmuxEnv();
      const paneCount = getTmuxPaneCount(sessionName, env);
      if (paneCount > 0 && paneCount % 4 === 0) {
        execSync(`tmux new-window -t "${sessionName}" -n "${paneName}" "${cmd}"`, { stdio: 'ignore', env });
      } else {
        execSync(`tmux split-window -t "${sessionName}" "${cmd}"`, { stdio: 'ignore', env });
        execSync(`tmux select-layout -t "${sessionName}" tiled`, { stdio: 'ignore', env });
      }
      return paneName;
    } else if (mux === 'zellij') {
      const env = { ...process.env, ZELLIJ_SESSION_NAME: sessionName };
      execSync(`zellij run --name "${paneName}" -- bash -c '${cmd}'`, { stdio: 'ignore', env });
      return paneName;
    }
  } catch {
    return null;
  }
}

/**
 * 列出 session 中所有 pane 的状态
 * @returns {Array<{id: string, name: string, alive: boolean, cmd: string}>}
 */
export function listPanes(mux, sessionName) {
  try {
    if (mux === 'tmux') {
      const env = cleanTmuxEnv();
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
      const env = { ...process.env, ZELLIJ_SESSION_NAME: sessionName };
      const layout = execSync('zellij action dump-layout', { encoding: 'utf8', env });
      const panes = [];
      const matches = layout.matchAll(/pane.*?name="([^"]+)"/g);
      for (const m of matches) {
        panes.push({ id: m[1], name: m[1], alive: true, cmd: '' });
      }
      return panes;
    }
  } catch {
    return [];
  }
}

/**
 * 重启指定 pane
 */
export function respawnPane(mux, sessionName, paneId, cmd) {
  try {
    if (mux === 'tmux') {
      const env = cleanTmuxEnv();
      execSync(`tmux respawn-pane -t "${paneId}" -k "${cmd}"`, { stdio: 'ignore', env });
      return true;
    } else if (mux === 'zellij') {
      const env = { ...process.env, ZELLIJ_SESSION_NAME: sessionName };
      execSync(`zellij run --name "${paneId}" -- bash -c '${cmd}'`, { stdio: 'ignore', env });
      return true;
    }
  } catch {
    return false;
  }
}
