# Daemon 统一生命周期管理 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 引入 Daemon 进程统一管理团队生命周期（serve、sessions、panes），消除当前架构的所有权碎片化问题。

**Architecture:** Daemon 作为第三个 Interface（面向系统的自治管理面），运行在 tmux/zellij session 的 pane 0 中。它拥有 serve 子进程、管理 agent panes 的健康与重生、嵌入 dashboard 渲染。tmux session = 团队生命周期边界。

**Tech Stack:** Node.js ES Modules, blessed (TUI), tmux/zellij (terminal multiplexer)

---

## 设计决策记录

| 决策 | 选项 | 结论 | 理由 |
|------|------|------|------|
| Daemon 进程模型 | tmux 内嵌 vs 传统后台 | tmux 内嵌 | 生命周期边界清晰，一个命令进入完整工作环境 |
| Dashboard | 嵌入 daemon vs 独立进程 | 嵌入 daemon | 减少 IPC 复杂度，错误隔离即可 |
| `--watch` 模式 | 保留 vs 删除 | 删除 | daemon 管 pane respawn，watch 循环是冗余的 workaround |
| 活动追踪 | SSE vs HTTP 轮询 | HTTP 轮询（初版） | opencode serve 当前无 SSE 端点，后续可升级 |
| terminal.js 抽象层 | 保留 vs 重写 | 保留并扩展 | 继续支持 tmux/zellij 双适配，便于未来扩展 |

## 变更概览

```
不变的模块（无需修改）：
  foundation/constants.js
  foundation/config.js
  foundation/logger.js
  foundation/settings.js
  interfaces/plugin/hooks.js
  interfaces/plugin/tools.js
  interfaces/dashboard/ui.js      # blessed 组件，daemon 直接复用
  interfaces/dashboard/data.js    # 数据获取，daemon 直接复用
  src/index.js                    # Plugin 入口

修改的模块：
  foundation/terminal.js          # 扩展 daemon 导向的 pane 管理 API
  foundation/state.js             # 扩展 runtime 格式，删除 monitorInfo 函数
  foundation/opencode.js          # 新增 checkHealth 函数
  interfaces/cli.js               # 大幅简化（start/stop/attach 重写）
  interfaces/dashboard/index.js   # 导出 refreshDashboard，支持嵌入模式
  bin/openteam.js                 # 新增 daemon 内部命令，简化路由
  capabilities/messaging.js       # 移除 addPaneForAgent 副作用

新增的模块：
  interfaces/daemon/index.js      # daemon 主循环 + 信号处理
  interfaces/daemon/serve.js      # serve 子进程生命周期管理
  interfaces/daemon/panes.js      # pane 创建 + 健康检查 + respawn

删除的模块：
  capabilities/monitor.js         # 职责完全被 daemon 取代
```

## 最终文件结构

```
bin/openteam.js                     # CLI 路由（简化）

src/
├── index.js                        # Plugin 入口（不变）
│
├── interfaces/
│   ├── cli.js                      # CLI 命令（start/stop/attach/list/status 简化版）
│   ├── daemon/                     # NEW: 持久生命周期管理
│   │   ├── index.js                # 主循环 + 信号处理 + dashboard 嵌入
│   │   ├── serve.js                # serve 子进程管理（启动/重启/停止）
│   │   └── panes.js                # pane 创建 + 健康检查 + respawn
│   ├── plugin/
│   │   ├── hooks.js                # （不变）
│   │   └── tools.js                # （不变）
│   └── dashboard/
│       ├── index.js                # 支持独立运行 + daemon 嵌入两种模式
│       ├── ui.js                   # （不变）
│       └── data.js                 # （不变）
│
├── capabilities/
│   ├── lifecycle.js                # （不变）
│   └── messaging.js                # 移除 addPaneForAgent 调用
│
└── foundation/
    ├── constants.js                # （不变）
    ├── config.js                   # （不变）
    ├── state.js                    # 扩展 runtime 格式
    ├── opencode.js                 # 新增 checkHealth
    ├── terminal.js                 # 扩展 pane 管理 API
    ├── logger.js                   # （不变）
    └── settings.js                 # （不变）
```

---

## Phase 1: Foundation 扩展（向后兼容，不破坏现有功能）

### Task 1: 扩展 terminal.js — daemon 导向的 pane API

**Files:**
- Modify: `src/foundation/terminal.js`

现有 `createSession` 一次性创建完整 2x2 网格，daemon 需要更细粒度的控制。新增以下函数，保留旧函数不动（Phase 4 再清理）。

**Step 1: 新增 `createSessionWithCmd` — 创建 mux session 并在首个 pane 运行指定命令**

在文件末尾（`killSession` 之后）添加：

```javascript
/**
 * 创建 mux session，首个 pane 运行指定命令
 * 用于 daemon 启动：pane 0 = daemon 进程
 */
export function createSessionWithCmd(mux, sessionName, cmd) {
  if (mux === 'tmux') {
    const env = cleanTmuxEnv();
    execSync(`tmux new-session -d -s "${sessionName}" "${cmd}"`, { stdio: 'ignore', env });
  } else if (mux === 'zellij') {
    // zellij 需要 layout 文件
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
```

**Step 2: 新增 `addAgentPane` — 向 session 添加单个 agent pane**

```javascript
/**
 * 向已有 session 添加单个 agent pane
 * @returns {string|null} pane 标识符（tmux: "session:window.pane"，zellij: pane name）
 */
export function addAgentPane(mux, sessionName, cmd, paneName) {
  try {
    if (mux === 'tmux') {
      const env = cleanTmuxEnv();
      // 在最后一个 window 中 split，超过 4 pane 则新建 window
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
```

**Step 3: 新增 `listPanes` — 列出 session 中所有 pane 状态**

```javascript
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
      // 解析 pane 信息（简化版：只检测 pane 数量）
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
```

**Step 4: 新增 `respawnPane` — 重启死亡的 pane**

```javascript
/**
 * 重启指定 pane（tmux 使用 respawn-pane，zellij 重新运行）
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
```

**Step 5: 新增辅助函数 `cleanTmuxEnv` 和 `getTmuxPaneCount`**

```javascript
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
```

**Step 6: 验证现有功能不受影响**

Run: `node -c src/foundation/terminal.js`
Expected: 无语法错误

**Step 7: Commit**

```bash
git add src/foundation/terminal.js
git commit -m "feat(terminal): add daemon-oriented pane management API"
```

---

### Task 2: 扩展 state.js — 新 runtime 格式 + 清理 monitorInfo

**Files:**
- Modify: `src/foundation/state.js`

**新 runtime 格式：**

```json
{
  "daemon": { "pid": 1234 },
  "serve": { "pid": 5678, "port": 4096, "host": "127.0.0.1" },
  "mux": { "type": "tmux", "session": "openteam-dev" },
  "team": "dev",
  "projectDir": "/home/user/project",
  "started": "2026-03-04T10:00:00Z"
}
```

**Step 1: 修改 `getRuntime` — 兼容新旧格式的 PID 检查**

将现有的 PID 检查逻辑改为同时检查新旧格式：

```javascript
export function getRuntime(teamName) {
  const runtimePath = getRuntimePath(teamName);
  if (!fs.existsSync(runtimePath)) return null;

  try {
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));

    // 新格式：检查 daemon PID
    const checkPid = runtime.daemon?.pid || runtime.pid;
    if (checkPid) {
      try {
        process.kill(checkPid, 0);
        return runtime;
      } catch {
        fs.unlinkSync(runtimePath);
        return null;
      }
    }
    return runtime;
  } catch {
    return null;
  }
}
```

**Step 2: 修改 `isServeRunning` — 兼容新格式**

```javascript
export function isServeRunning(teamName) {
  const runtime = getRuntime(teamName);
  if (!runtime) return false;
  // 新格式：检查 serve PID 是否存活
  const servePid = runtime.serve?.pid || runtime.pid;
  if (!servePid) return false;
  try {
    process.kill(servePid, 0);
    return true;
  } catch {
    return false;
  }
}
```

**Step 3: 修改 `getServeUrl` — 兼容新格式**

```javascript
export function getServeUrl(teamName) {
  const runtime = getRuntime(teamName);
  if (!runtime) return null;
  const host = runtime.serve?.host || runtime.host;
  const port = runtime.serve?.port || runtime.port;
  if (!host || !port) return null;
  return `http://${host}:${port}`;
}
```

**Step 4: 删除 `setMonitorInfo`、`getMonitorInfo`、`clearMonitorInfo`**

这三个函数仅被 `capabilities/monitor.js` 使用，monitor.js 将在 Phase 4 删除。此刻先删除这些函数。

**Step 5: 验证**

Run: `node -c src/foundation/state.js`
Expected: 无语法错误

**Step 6: Commit**

```bash
git add src/foundation/state.js
git commit -m "feat(state): support new daemon runtime format, remove monitorInfo"
```

---

### Task 3: opencode.js 新增 checkHealth

**Files:**
- Modify: `src/foundation/opencode.js`

**Step 1: 在 `listAllSessions` 之后添加 `checkHealth`**

```javascript
/**
 * 检查 serve 是否可达（健康检查）
 * @returns {Promise<boolean>}
 */
export async function checkHealth(serveUrl) {
  try {
    await listAllSessions(serveUrl);
    return true;
  } catch {
    return false;
  }
}
```

**Step 2: 验证**

Run: `node -c src/foundation/opencode.js`
Expected: 无语法错误

**Step 3: Commit**

```bash
git add src/foundation/opencode.js
git commit -m "feat(opencode): add checkHealth function"
```

---

## Phase 2: Daemon 实现（新增代码，不影响现有功能）

### Task 4: daemon/serve.js — serve 子进程管理

**Files:**
- Create: `src/interfaces/daemon/serve.js`

serve 作为 daemon 的**直接子进程**（不 detach），生命周期绑定。daemon 死 → serve 收 SIGHUP → 退出。

```javascript
/**
 * Daemon 的 serve 子进程管理
 * serve 是 daemon 的直接子进程，生命周期绑定
 */

import { spawn } from 'child_process';
import { checkHealth } from '../../foundation/opencode.js';
import { createLogger } from '../../foundation/logger.js';

const log = createLogger('daemon:serve');

/**
 * 启动 opencode serve 子进程
 * @returns {Promise<{process, pid, port, host, url}>}
 */
export async function startServe(teamName, port, host) {
  const serveProcess = spawn('opencode', ['serve', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OPENTEAM_TEAM: teamName,
      OPENMEMORY: process.env.OPENMEMORY || '',
    },
  });

  const url = `http://${host}:${port}`;

  // 等待 serve 就绪
  const ready = await waitForReady(url, 30);
  if (!ready) {
    serveProcess.kill();
    throw new Error('serve 启动超时');
  }

  log.info(`serve started pid=${serveProcess.pid} port=${port}`);

  return {
    process: serveProcess,
    pid: serveProcess.pid,
    port,
    host,
    url,
  };
}

/**
 * 等待 serve HTTP 可达
 */
async function waitForReady(serveUrl, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    const ok = await checkHealth(serveUrl);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/**
 * 停止 serve 进程（优雅关闭，超时强杀）
 */
export async function stopServe(serveProcess, timeoutMs = 5000) {
  if (!serveProcess || serveProcess.exitCode !== null) return;

  log.info('stopping serve...');
  serveProcess.kill('SIGTERM');

  const exited = await Promise.race([
    new Promise(resolve => serveProcess.on('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), timeoutMs)),
  ]);

  if (!exited) {
    log.warn('serve did not exit gracefully, sending SIGKILL');
    serveProcess.kill('SIGKILL');
  }
}

/**
 * 监听 serve 崩溃事件
 * @param {Function} onCrash - 崩溃回调 (code, signal) => void
 */
export function onServeCrash(serveProcess, onCrash) {
  serveProcess.on('exit', (code, signal) => {
    // 正常退出不触发（code 0 或 被 SIGTERM 杀死）
    if (code === 0 || signal === 'SIGTERM') return;
    log.error(`serve crashed code=${code} signal=${signal}`);
    onCrash(code, signal);
  });
}
```

**Step 1: 创建目录和文件**

Run: `mkdir -p src/interfaces/daemon`
写入上述内容到 `src/interfaces/daemon/serve.js`

**Step 2: 验证语法**

Run: `node -c src/interfaces/daemon/serve.js`

**Step 3: Commit**

```bash
git add src/interfaces/daemon/serve.js
git commit -m "feat(daemon): add serve child process manager"
```

---

### Task 5: daemon/panes.js — pane 生命周期管理

**Files:**
- Create: `src/interfaces/daemon/panes.js`

```javascript
/**
 * Daemon 的 pane 生命周期管理
 * 创建 agent pane、健康检查、dead pane respawn
 */

import {
  addAgentPane,
  listPanes,
  respawnPane,
} from '../../foundation/terminal.js';
import { getAgentInstances } from '../../foundation/state.js';
import { createLogger } from '../../foundation/logger.js';

const log = createLogger('daemon:panes');

/**
 * 为所有 agent 创建 pane
 * @param {string} mux - 复用器类型
 * @param {string} sessionName - mux session 名
 * @param {string[]} agents - agent 列表
 * @param {string} serveUrl - serve URL
 * @param {Map<string, string>} sessionMap - agentName → sessionId
 */
export function createAllAgentPanes(mux, sessionName, agents, serveUrl, sessionMap) {
  for (const agent of agents) {
    const sessionId = sessionMap.get(agent);
    if (!sessionId) {
      log.warn(`skip pane for ${agent}: no session`);
      continue;
    }
    const cmd = buildAttachCmd(serveUrl, sessionId);
    const result = addAgentPane(mux, sessionName, cmd, agent);
    if (result) {
      log.info(`pane created for ${agent}`);
    } else {
      log.error(`failed to create pane for ${agent}`);
    }
  }
}

/**
 * 健康检查：检测 dead pane 并 respawn
 * @returns {{ checked: number, respawned: number }}
 */
export function checkAndRespawn(mux, sessionName, teamName, serveUrl) {
  const panes = listPanes(mux, sessionName);
  let checked = 0;
  let respawned = 0;

  for (const pane of panes) {
    // 跳过 daemon 自己的 pane（通常是第一个）
    if (pane.name === 'daemon' || pane.id === panes[0]?.id) continue;
    checked++;

    if (!pane.alive) {
      log.warn(`dead pane detected: ${pane.name || pane.id}`);
      const agentName = pane.name;
      const instances = getAgentInstances(teamName, agentName);
      if (instances.length > 0) {
        const cmd = buildAttachCmd(serveUrl, instances[0].sessionId);
        const ok = respawnPane(mux, sessionName, pane.id, cmd);
        if (ok) {
          log.info(`respawned pane for ${agentName}`);
          respawned++;
        }
      }
    }
  }

  return { checked, respawned };
}

/**
 * 构建 opencode attach 命令
 */
function buildAttachCmd(serveUrl, sessionId) {
  return `opencode attach "${serveUrl}" -s "${sessionId}"`;
}
```

**Step 1: 写入文件**

**Step 2: 验证语法**

Run: `node -c src/interfaces/daemon/panes.js`

**Step 3: Commit**

```bash
git add src/interfaces/daemon/panes.js
git commit -m "feat(daemon): add pane lifecycle manager"
```

---

### Task 6: 重构 dashboard/index.js — 支持嵌入模式

**Files:**
- Modify: `src/interfaces/dashboard/index.js`

当前 `dashboard()` 函数包含完整的生命周期管理（创建 UI + 定时刷新 + 退出处理）。需要拆分为可被 daemon 复用的部件。

**Step 1: 导出 `refreshDashboard`，新增 `createEmbeddedDashboard`**

```javascript
/**
 * OpenTeam Dashboard
 *
 * 支持两种模式：
 * - 独立运行：`dashboard(teamName)` — 自管理生命周期
 * - 嵌入 daemon：`createEmbeddedDashboard(teamName, serveUrl)` — 由 daemon 管理生命周期
 */

import { getServeUrl, isServeRunning } from '../../foundation/state.js';
import { createDashboard, updateHeader, updateTeamStatus, updateAgentStatus, updateMessageStream } from './ui.js';
import { fetchTeamStatus, fetchAgentStatus, fetchMessageStream } from './data.js';

const REFRESH_INTERVAL = 3000;

/**
 * 独立模式：启动 Dashboard（原有行为不变）
 */
export async function dashboard(teamName) {
  if (!isServeRunning(teamName)) {
    console.error(`\x1b[31m错误:\x1b[0m 团队 ${teamName} 未运行`);
    console.log(`请先运行: openteam start ${teamName}`);
    process.exit(1);
  }

  const serveUrl = getServeUrl(teamName);
  const ui = createDashboard(teamName);

  await refreshDashboard(ui, teamName, serveUrl);

  const intervalId = setInterval(async () => {
    await refreshDashboard(ui, teamName, serveUrl);
  }, REFRESH_INTERVAL);

  process.on('exit', () => {
    clearInterval(intervalId);
    ui.screen.destroy();
  });

  process.on('SIGINT', () => {
    clearInterval(intervalId);
    ui.screen.destroy();
    process.exit(0);
  });
}

/**
 * 嵌入模式：创建 dashboard 并返回控制句柄
 * daemon 负责调用 start/stop，dashboard 不自行退出
 *
 * @returns {{ start: () => void, stop: () => void, refresh: () => Promise<void> }}
 */
export function createEmbeddedDashboard(teamName, serveUrl) {
  const ui = createDashboard(teamName);
  let intervalId = null;

  // 嵌入模式下禁用 q 退出（daemon 管生命周期）
  // blessed 的 key 绑定在 ui.js 中，这里覆盖行为
  ui.screen.unkey(['q', 'C-c']);
  ui.screen.key(['q'], () => {
    // 显示提示而不退出
    updateHeader(ui.header, teamName, '使用 openteam stop 停止团队');
    ui.screen.render();
  });
  // Ctrl+C 仍然发 SIGINT，由 daemon 的信号处理器捕获

  return {
    start() {
      refreshDashboard(ui, teamName, serveUrl);
      intervalId = setInterval(async () => {
        try {
          await refreshDashboard(ui, teamName, serveUrl);
        } catch {
          // 渲染失败不影响 daemon 核心功能
        }
      }, REFRESH_INTERVAL);
    },
    stop() {
      if (intervalId) clearInterval(intervalId);
      try { ui.screen.destroy(); } catch { /* ignore */ }
    },
    async refresh() {
      await refreshDashboard(ui, teamName, serveUrl);
    },
  };
}

/**
 * 刷新 Dashboard 数据并更新 UI
 */
export async function refreshDashboard(ui, teamName, serveUrl) {
  try {
    const refreshTime = new Date().toLocaleString('zh-CN', { hour12: false });

    const [teamStatus, agentStatuses, messages] = await Promise.all([
      fetchTeamStatus(teamName),
      fetchAgentStatus(teamName, serveUrl),
      fetchMessageStream(teamName, serveUrl, 20),
    ]);

    updateHeader(ui.header, teamName, refreshTime);
    updateTeamStatus(ui.teamStatus, teamStatus);
    updateAgentStatus(ui.agentStatus, agentStatuses);
    updateMessageStream(ui.messageStream, messages);

    ui.screen.render();
  } catch (err) {
    updateHeader(ui.header, teamName, `Error: ${err.message}`);
    ui.screen.render();
  }
}
```

**Step 2: 验证语法**

Run: `node -c src/interfaces/dashboard/index.js`

**Step 3: Commit**

```bash
git add src/interfaces/dashboard/index.js
git commit -m "refactor(dashboard): support embedded mode for daemon integration"
```

---

### Task 7: daemon/index.js — 主循环

**Files:**
- Create: `src/interfaces/daemon/index.js`

这是 daemon 的核心。主循环负责：
1. 启动 serve（子进程）
2. 创建 agent sessions
3. 创建 agent panes
4. 启动 dashboard
5. 健康检查循环
6. 信号处理 + 优雅关闭

```javascript
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
const HEALTH_CHECK_INTERVAL = 10000; // 10 秒

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

  // 保存 runtime
  saveRuntime(teamName, {
    daemon: { pid: process.pid },
    serve: { pid: serve.pid, port: serve.port, host: serve.host },
    mux: { type: muxType, session: sessionName },
    team: teamName,
    projectDir,
    started: new Date().toISOString(),
  });

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
  onServeCrash(serve.process, async (code, signal) => {
    if (restarting) return;
    restarting = true;
    console.log(`\n⚠ serve 崩溃 (code=${code}, signal=${signal})，正在重启...`);
    try {
      serve = await startServe(teamName, port, host);
      saveRuntime(teamName, {
        daemon: { pid: process.pid },
        serve: { pid: serve.pid, port: serve.port, host: serve.host },
        mux: { type: muxType, session: sessionName },
        team: teamName,
        projectDir,
        started: new Date().toISOString(),
      });
      onServeCrash(serve.process, arguments.callee);
      console.log(`serve 已重启 (PID: ${serve.pid})`);
    } catch (e) {
      console.error(`serve 重启失败: ${e.message}`);
    }
    restarting = false;
  });

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
```

**Step 1: 写入文件**

**Step 2: 验证语法**

Run: `node -c src/interfaces/daemon/index.js`

**Step 3: Commit**

```bash
git add src/interfaces/daemon/index.js
git commit -m "feat(daemon): implement main loop with serve, panes, dashboard, health check"
```

---

## Phase 3: CLI 集成（切换到 daemon 模式）

### Task 8: bin/openteam.js — 新增 daemon 内部命令

**Files:**
- Modify: `bin/openteam.js`

新增 `daemon` 子命令（内部使用，`cmdStart` 在 tmux pane 中调用它）。

**Step 1: 在 `program.parse()` 之前添加**

```javascript
program
  .command('daemon <team>')
  .description('[内部] 启动 daemon 进程')
  .option('--port <port>', 'serve 端口', parseInt)
  .option('--dir <directory>', '项目目录')
  .option('--mux <type>', '复用器类型', 'tmux')
  .action(async (teamName, options) => {
    const { runDaemon } = await import('../src/interfaces/daemon/index.js');
    await runDaemon(teamName, options.dir || process.cwd(), options);
  });
```

同时移除 `monitor` 命令（Phase 4 可以留作 start 别名），移除 `dashboard` 的独立命令或保留为可选。

**Step 2: 验证语法**

Run: `node -c bin/openteam.js`

**Step 3: Commit**

```bash
git add bin/openteam.js
git commit -m "feat(cli): add internal daemon command"
```

---

### Task 9: 重写 cli.js — cmdStart / cmdStop / cmdAttach

**Files:**
- Modify: `src/interfaces/cli.js`

这是最大的变更。核心逻辑：

- `cmdStart` → 检查已有 tmux session → 有则 attach → 没有则创建 session + daemon pane → attach
- `cmdStop` → 读 runtime → SIGTERM daemon PID → daemon 自行清理 → backup 清理 runtime
- `cmdMonitor` → cmdStart 的别名
- `cmdAttach` → 移除 `--watch`，保留普通 attach

**Step 1: 重写 `cmdStart`**

```javascript
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
  createSessionWithCmd(mux, sessionName, daemonCmd);

  if (options.detach) {
    success('团队已在后台启动');
    console.log(`使用 'openteam start ${teamName}' 进入团队`);
    return;
  }

  // 前台模式：attach 到 session
  attachSession(mux, sessionName);
}
```

需要新增 import：

```javascript
import {
  detectMultiplexer, hasSession, attachSession,
  createSessionWithCmd,
} from '../foundation/terminal.js';
```

并移除不再需要的 import（`spawn`、`execSync`、旧的 `ensureAgent` / `recoverSessions` / `startMonitor` 等）。

**Step 2: 重写 `cmdStop`**

```javascript
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

  // 等待 daemon 清理（最多 3 秒），然后兜底清理
  setTimeout(() => {
    // 如果 runtime 文件还在，说明 daemon 没有成功清理
    const stillRunning = getRuntime(teamName);
    if (stillRunning) {
      clearRuntime(teamName);
      // 兜底杀 mux session
      const sessionName = runtime.mux?.session || `openteam-${teamName}`;
      killSession(sessionName);
    }
    success('已停止');
  }, 1000);
}
```

**Step 3: 简化 `cmdAttach` — 移除 --watch**

```javascript
export async function cmdAttach(teamName, agentName, options) {
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
```

**Step 4: `cmdMonitor` → `cmdStart` 别名**

```javascript
export async function cmdMonitor(teamName, options) {
  return cmdStart(teamName, { ...options, dir: options.dir || process.cwd() });
}
```

**Step 5: 整理 import 声明**

移除不再使用的 import，新增 terminal.js 的 import。完整的 import 块：

```javascript
import { execSync } from 'child_process';
import path from 'path';
import { PATHS, DEFAULTS } from '../foundation/constants.js';
import { loadTeamConfig, getTeamLeader, listTeams, isAgentInTeam, validateTeamConfig } from '../foundation/config.js';
import {
  getRuntime, clearRuntime, isServeRunning, getServeUrl,
  findAvailablePort, getAgentInstances, loadActiveSessions,
} from '../foundation/state.js';
import { sessionExists, fetchSession } from '../foundation/opencode.js';
import { detectMultiplexer, hasSession, attachSession, createSessionWithCmd, killSession } from '../foundation/terminal.js';
import { ensureAgent } from '../capabilities/lifecycle.js';
```

不再需要：`spawn`（daemon 自己 spawn serve）、`recoverSessions`（daemon 做）、`startMonitor`（删除）、`listAllSessions`（cli 不再直接调）。

**Step 6: 验证语法**

Run: `node -c src/interfaces/cli.js`

**Step 7: Commit**

```bash
git add src/interfaces/cli.js
git commit -m "refactor(cli): rewrite start/stop/attach to use daemon architecture"
```

---

### Task 10: 更新 bin/openteam.js — 清理路由

**Files:**
- Modify: `bin/openteam.js`

**Step 1: 完整重写**

```javascript
#!/usr/bin/env node

/**
 * OpenTeam CLI — 纯路由入口
 */

import { createRequire } from 'module';
import { program } from 'commander';
import {
  cmdStart, cmdAttach, cmdList, cmdStop,
  cmdStatus, cmdMonitor, cmdDashboard,
} from '../src/interfaces/cli.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

program.name('openteam').description('Team management for OpenCode').version(version);

program
  .command('start [team]')
  .description('启动团队（创建 tmux/zellij session）')
  .option('-d, --detach', '后台运行')
  .option('--dir <directory>', '项目目录')
  .option('--tmux', '强制使用 tmux')
  .option('--zellij', '强制使用 zellij')
  .action(cmdStart);

program
  .command('attach [team] [agent]')
  .description('附加到 agent 会话')
  .action(cmdAttach);

program
  .command('list')
  .alias('ls')
  .description('列出所有团队')
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
  .description('启动团队（start 的别名）')
  .option('-d, --detach', '后台运行')
  .option('--dir <directory>', '项目目录')
  .option('--tmux', '强制使用 tmux')
  .option('--zellij', '强制使用 zellij')
  .action(cmdMonitor);

program
  .command('dashboard <team>')
  .description('独立显示团队状态仪表盘')
  .action(cmdDashboard);

// 内部命令（不在帮助中显示）
program
  .command('daemon <team>', { hidden: true })
  .option('--port <port>', 'serve 端口', parseInt)
  .option('--dir <directory>', '项目目录')
  .option('--mux <type>', '复用器类型', 'tmux')
  .action(async (teamName, options) => {
    const { runDaemon } = await import('../src/interfaces/daemon/index.js');
    await runDaemon(teamName, options.dir || process.cwd(), options);
  });

program.parse();
```

**Step 2: 验证语法**

Run: `node -c bin/openteam.js`

**Step 3: Commit**

```bash
git add bin/openteam.js
git commit -m "refactor(cli): simplify routes, add hidden daemon command"
```

---

## Phase 4: 清理（删除过时代码）

### Task 11: 删除 capabilities/monitor.js + 清理引用

**Files:**
- Delete: `src/capabilities/monitor.js`
- Modify: `src/capabilities/messaging.js` — 移除 `addPaneForAgent` import 和调用

**Step 1: 删除 `capabilities/monitor.js`**

Run: `rm src/capabilities/monitor.js`

**Step 2: 清理 `messaging.js`**

移除 import 行：
```javascript
import { addPaneForAgent } from './monitor.js';
```

移除 `sendMessage` 函数中的 `addPaneForAgent` 调用（约第 36 行）：
```javascript
// 删除这一行：
addPaneForAgent(teamName, to, defaultCwd);
```

**Step 3: 验证**

Run: `node -c src/capabilities/messaging.js`

**Step 4: 清理 terminal.js 中仅被 monitor 使用的旧函数**

以下函数在 daemon 架构下不再使用，可以删除：
- `chunkAgents` — 仅用于旧的 2x2 网格创建
- `createTmux2x2Grid` — 旧的网格布局
- `createTmuxSession`（旧的完整 session 创建）
- `generateZellijTab` — 旧的 zellij tab 生成
- `createZellijLayout` — 旧的 zellij layout
- `launchZellijSession` — 旧的 zellij 一体化启动
- `addPane`（旧的 pane 添加，被 `addAgentPane` 取代）

保留：
- `detectMultiplexer` — 仍然需要
- `hasSession` — 仍然需要
- `attachSession` — 仍然需要
- `killSession` — 仍然需要
- 新增的所有函数（Task 1 添加的）

注意：确认 `createSession`（旧的导出名）已无消费者后再删。用 grep 检查：

Run: `grep -r "from.*terminal" src/ --include="*.js" | grep -v node_modules`

确认只有 daemon/panes.js 和 cli.js 引用 terminal.js，且它们使用的是新 API。

**Step 5: 验证所有文件语法**

Run: `node -c src/foundation/terminal.js && node -c src/capabilities/messaging.js && node -c src/interfaces/cli.js`

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove monitor.js, clean up legacy terminal functions"
```

---

### Task 12: 清理 state.js 中无用的导出

**Files:**
- Modify: `src/foundation/state.js`

**Step 1: 确认以下函数无消费者后删除**

- `setMonitorInfo` — 已在 Task 2 删除
- `getMonitorInfo` — 已在 Task 2 删除
- `clearMonitorInfo` — 已在 Task 2 删除

如果 Task 2 已完成，此 Task 跳过。

如果还有其他清理（如 legacy 兼容函数 `setActiveSession` / `getActiveSession`），用 grep 确认无消费者后再删。

**Step 2: Commit（如有变更）**

---

### Task 13: 更新文档

**Files:**
- Modify: `CLAUDE.md` — 更新架构描述
- Modify: `docs/DESIGN.md` — 更新到当前架构
- Delete or archive: `docs/architecture-v2.md` — 已实现，不再是"v2"

**Step 1: CLAUDE.md — 更新架构部分**

在 Architecture 章节中：
- 新增 `interfaces/daemon/` 描述
- 删除 `capabilities/monitor.js`
- 更新 CLI 命令描述（start 现在创建 tmux session + daemon）
- 更新数据流图

**Step 2: docs/DESIGN.md — 全面更新**

更新文件结构、CLI 行为模型、运行时数据格式。

**Step 3: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: update architecture docs for daemon model"
```

---

## 风险与注意事项

| 风险 | 缓解措施 |
|------|----------|
| daemon 内的 blessed crash 可能杀死整个进程 | `createEmbeddedDashboard` 中 refresh 用 try/catch 包裹 |
| serve 重启后 agent pane 的 `opencode attach` 需要重连 | opencode attach 本身有 250ms 重试机制 |
| zellij 的 pane 管理 API 不如 tmux 成熟 | listPanes 对 zellij 做简化实现，后续迭代完善 |
| 旧格式 runtime 文件兼容 | `getRuntime`、`isServeRunning`、`getServeUrl` 均做了新旧格式兼容 |
| `openteam daemon` 命令被用户直接调用 | 标记为 `hidden: true`，不在帮助中显示 |

## 后续演进（不在本次范围）

- SSE 替代 HTTP 轮询（ActivityTracker）
- agent 活动状态实时追踪（idle/working/dead）
- serve 崩溃时的 session 迁移
- 任务队列（`.tasks.json` + `task` 工具）
