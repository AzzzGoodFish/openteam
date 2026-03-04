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
 * 按组拆分 agent 列表
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
 * tmux 单窗口 2×2 布局
 */
function createTmux2x2Grid(sessionName, windowIndex, teamName, agents) {
  const cmds = agents.map((agent) => `openteam attach ${teamName} ${agent} --watch`);
  const target = `${sessionName}:${windowIndex}`;

  if (windowIndex === 0) {
    execSync(`tmux new-session -d -s "${sessionName}" "${cmds[0]}"`, { stdio: 'ignore' });
  } else {
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
 * 创建完整 tmux 会话
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
 * 生成 zellij tab 内容
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
 * 生成 zellij KDL 布局文件并返回路径
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
 * 创建 mux 会话（2×2 网格，超过 4 个 agent 创建多 window/tab）
 */
export function createSession(mux, sessionName, teamName, agents) {
  if (mux === 'tmux') {
    createTmuxSession(sessionName, teamName, agents);
  } else if (mux === 'zellij') {
    createZellijLayout(sessionName, teamName, agents);
  }
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
 * 启动 zellij 并同时创建+附加会话
 */
export function launchZellijSession(sessionName, teamName, agents) {
  const layoutPath = createZellijLayout(sessionName, teamName, agents);
  execSync(`zellij -n "${layoutPath}" -s "${sessionName}"`, { stdio: 'inherit' });
}

/**
 * 向已有会话动态添加 pane
 */
export function addPane(mux, sessionName, teamName, agentName, cwd) {
  const cmd = `openteam attach ${teamName} ${agentName} --watch --cwd '${cwd}'`;

  try {
    if (mux === 'tmux') {
      const paneCount = parseInt(
        execSync(`tmux list-panes -t "${sessionName}" -a | wc -l`, { encoding: 'utf8' }).trim()
      );

      if (paneCount % 4 === 0) {
        execSync(`tmux new-window -t "${sessionName}" "${cmd}"`, { stdio: 'ignore' });
      } else {
        execSync(`tmux split-window -t "${sessionName}" "${cmd}"`, { stdio: 'ignore' });
        execSync(`tmux select-layout -t "${sessionName}" tiled`, { stdio: 'ignore' });
      }
    } else if (mux === 'zellij') {
      const env = { ...process.env, ZELLIJ_SESSION_NAME: sessionName };

      const layout = execSync('zellij action dump-layout', { encoding: 'utf8', env });
      const paneCount = (layout.match(/pane command=/g) || []).length;

      if (paneCount > 0 && paneCount % 4 === 0) {
        const tabLayout = `layout {
    tab name="${agentName}" cwd="${cwd}" {
        pane size=1 borderless=true {
            plugin location="zellij:tab-bar"
        }
        pane command="bash" name="${agentName}" start_suspended=false {
            args "-c" "${cmd}"
        }
        pane size=2 borderless=true {
            plugin location="zellij:status-bar"
        }
    }
}`;
        const layoutPath = `/tmp/openteam-tab-${agentName}.kdl`;
        fs.writeFileSync(layoutPath, tabLayout);
        execSync(`zellij action new-tab --layout "${layoutPath}" --name "${agentName}"`, {
          stdio: 'ignore',
          env,
        });
      } else {
        execSync(`zellij run --name "${agentName}" --cwd "${cwd}" -- ${cmd}`, { stdio: 'ignore', env });
      }
    }
    return true;
  } catch {
    return false;
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
