# OpenTeam v2 架构设计 — Daemon 统一管理

## 问题

当前架构没有持久的管理进程。`start` 和 `monitor` 是两个独立的 fire-and-forget 操作，没有任何东西持续管理团队生命周期：

```
现状：
start   →  spawn serve（孤儿）→ attach leader TUI → 用户 Ctrl+C → serve 悬空
monitor →  spawn tmux session（孤儿）→ N 个 attach --watch pane（各自为战）
stop    →  kill serve PID + kill tmux session（尽力清理）
```

后果：
- serve 死了没人知道，没人重启
- attach 进程断连后 CPU 空转（opencode attach 250ms 无限重试），无人清理
- monitor 重启时 TMUX env 冲突 → 重复创建 tmux session → 进程堆积
- agent 全部停工但无人发现（没有活动检测）
- 插件直接操作 tmux（addPaneToMonitor），跟 monitor 的 pane 管理互相打架

## 设计目标

1. **单一所有权**：一个进程拥有团队的全部生命周期
2. **自愈**：serve 崩溃自动重启，pane 死亡自动 respawn
3. **可观测**：实时感知 agent 活动状态，不靠轮询 HTTP
4. **用户交互保留**：tmux pane 里的 opencode attach TUI 不变
5. **简单心智模型**：`start` 就是一切入口，幂等

## 架构总览

```
openteam start dev
  └── 创建 tmux session "openteam-dev"
       │
       ├── Window 0: Dashboard
       │   └── pane 0: openteam daemon dev
       │        ├── 子进程: opencode serve（非 detach，直接 child）
       │        ├── SSE /event → 实时事件流
       │        ├── Pane Manager → 管理 agent panes
       │        └── Dashboard UI → 状态 + 消息流渲染
       │
       └── Window 1+: Agent TUIs
            ├── pane: opencode attach (pm)
            ├── pane: opencode attach (architect)
            ├── pane: opencode attach (developer)
            └── pane: opencode attach (qa)
```

## 组件设计

### 1. Daemon（核心）

Daemon 是团队的大脑，运行在 tmux session 的 pane 0 中。

```
src/daemon/
├── index.js          # 入口 + 主循环
├── serve-manager.js  # opencode serve 生命周期
├── pane-manager.js   # tmux pane 管理
├── activity.js       # SSE 事件处理 + agent 活动追踪
└── dashboard.js      # 终端 UI 渲染（复用现有 blessed 代码）
```

#### 主循环

```javascript
async function daemon(teamName, projectDir) {
  // 1. 启动 serve（作为子进程）
  const serve = await serveManager.start(teamName, projectDir);

  // 2. 创建所有 agent session
  const sessions = await createAgentSessions(teamName, serve.url);

  // 3. 创建 agent panes（在当前 tmux session 中）
  paneManager.createAgentPanes(teamName, sessions);

  // 4. 连接 SSE 事件流
  const tracker = activity.connect(serve.url);

  // 5. 启动健康检查
  startHealthCheck(serve, paneManager, tracker);

  // 6. 渲染 dashboard（阻塞，直到退出）
  await dashboard.render(teamName, tracker);

  // 7. 收到退出信号 → 清理
  await gracefulShutdown(serve, paneManager);
}
```

### 2. Serve Manager

Daemon 的子进程管理器，负责 opencode serve 的生命周期。

```javascript
class ServeManager {
  // serve 作为 daemon 的直接子进程（不 detach）
  // → daemon 死 = serve 死 = 干净的生命周期边界

  start(teamName, projectDir) → { process, url, port }
  restart()                    // serve 崩溃时调用
  stop()                       // graceful shutdown

  // 事件
  on('crash', () => ...)       // serve 进程退出
  on('ready', () => ...)       // serve 就绪（HTTP 可达）
}
```

关键决策：**serve 是 daemon 的子进程，不 detach**。
- 好处：生命周期绑定，daemon 死 → serve 收 SIGHUP → 干净退出
- 代价：不能单独重启 daemon 而保留 serve
- 权衡：一致性优先。tmux session 是整个团队的生命周期边界。

### 3. Pane Manager

管理 tmux pane 的创建、健康检查、重生。

```javascript
class PaneManager {
  constructor(tmuxSession) {
    this.session = tmuxSession;
    this.panes = new Map();  // agentName → { paneId, sessionId, pid }
  }

  createAgentPanes(agents, sessions)  // 批量创建 agent panes
  respawnPane(agentName)              // 替换死亡/卡死的 pane
  listPanes()                         // tmux list-panes 获取实时状态
  killAll()                           // 清理所有 agent panes

  // 健康检查
  detectDeadPanes()                   // pane 退出 → 需要 respawn
  detectStuckPanes()                  // CPU 异常 → kill + respawn
}
```

**关键：TMUX env 清理**
```javascript
// 所有 tmux 命令统一使用清理后的环境
function tmuxExec(cmd) {
  const env = { ...process.env };
  delete env.TMUX;  // 避免 su 环境下的 socket 继承问题
  return execSync(`tmux ${cmd}`, { env, stdio: 'ignore' });
}
```

每个 agent pane 运行的命令：
```bash
opencode attach "http://127.0.0.1:{port}" -s "{sessionId}"
```

不再使用 `openteam attach --watch` 包装层。原因：
- watch 循环是当前 CPU 泄漏的根源（SIGTERM 不可靠 + 无限重连）
- 如果 attach 进程死了，daemon 检测并 respawn —— 比 watch 自愈更可靠
- 减少一层进程嵌套

### 4. Activity Tracker（SSE）

通过 opencode serve 的 `/event` SSE 端点实时追踪 agent 活动。

```javascript
class ActivityTracker extends EventEmitter {
  constructor(serveUrl) {
    this.agents = new Map();  // agentName → AgentState
  }

  connect()     // 建立 SSE 连接
  reconnect()   // 断线重连（指数退避）

  // agent 状态
  getState(agentName) → { status, lastActivity, messageCount, currentSession }
  getAllStates()      → Map

  // 事件
  on('agent:active', (name, event) => ...)   // agent 产生活动
  on('agent:idle', (name, idleSince) => ...) // agent 静默超时
  on('serve:disconnect', () => ...)          // SSE 断连 = serve 可能挂了
  on('session:created', (sessionId) => ...)  // 新 session 出现
}
```

Agent 状态模型：
```javascript
{
  status: 'working' | 'idle' | 'dead',  // 由活动时间推断
  lastActivity: Date,                    // 最后一次 SSE 事件时间
  sessionId: string,
  messageCount: number,                  // 本次工作的消息数
  idleThreshold: 120_000,               // 2 分钟无活动 → idle
}
```

### 5. Dashboard

复用现有 blessed TUI（`src/dashboard/`），但数据源从 HTTP 轮询改为 SSE 事件驱动。

变化：
- 数据来源：`ActivityTracker` 推送事件，不再 3 秒轮询 HTTP API
- 位置：daemon pane 内渲染，不再是独立命令
- 新增：pane 健康状态显示

## CLI 命令变化

```
命令              v1（当前）                    v2（新）
─────────────────────────────────────────────────────────────
start <team>      启动 serve → attach leader    创建 tmux session（daemon + panes）
                  Ctrl+C 后 serve 悬空           → attach 到 tmux session
                                                tmux detach 后团队继续运行

start <team> -d   启动 serve → 打印信息 → 退出  创建 tmux session → 不 attach → 退出

start <team>      (已在运行时) 打印 "已运行"    attach 到已有 tmux session（幂等）
(再次运行)

monitor <team>    创建新 tmux session + panes    → start 的别名（向后兼容）

attach <team>     attach 到单个 agent TUI        保留，直连指定 agent 的 pane
[agent]                                         或独立启动 opencode attach

stop <team>       kill serve + kill tmux         SIGTERM → daemon → 优雅关闭全部

status <team>     读 .active-sessions.json       读 daemon 状态文件（更丰富的信息）

dashboard <team>  独立 blessed TUI               → 已内置在 daemon pane 中
                                                独立命令保留（连接 daemon 状态）
```

## 状态管理

### Runtime 文件 `.runtime.json`

```json
{
  "daemon": {
    "pid": 1234,
    "started": "2026-03-04T10:00:00Z"
  },
  "serve": {
    "pid": 5678,
    "port": 4096,
    "host": "127.0.0.1"
  },
  "tmux": {
    "session": "openteam-dev"
  },
  "project": "/home/user/project",
  "team": "dev"
}
```

### Agent 状态文件 `.agent-state.json`

由 daemon 持续更新（替代 `.active-sessions.json`）：

```json
{
  "pm": {
    "sessionId": "ses_xxx",
    "paneId": "openteam-dev:1.0",
    "status": "working",
    "lastActivity": "2026-03-04T10:05:30Z",
    "messageCount": 12,
    "cwd": "/home/user/project"
  },
  "architect": {
    "sessionId": "ses_yyy",
    "paneId": "openteam-dev:1.1",
    "status": "idle",
    "lastActivity": "2026-03-04T09:58:00Z",
    "messageCount": 5,
    "cwd": "/home/user/project"
  }
}
```

### 向后兼容

`.active-sessions.json` 的格式保持不变，由 daemon 同步更新。
插件（hooks + tools）仍然读这个文件，不需要改插件代码。

## 生命周期场景

### 正常启动

```
用户: openteam start dev
  │
  ├─ 检查 .runtime.json → 没有 daemon 在运行
  ├─ 创建 tmux session "openteam-dev"
  │   └─ pane 0: openteam daemon dev
  ├─ tmux attach -t openteam-dev
  │
  daemon 启动:
  ├─ spawn opencode serve（子进程）
  ├─ 等待 serve 就绪
  ├─ 为每个 agent 创建 session
  ├─ 在 tmux 中创建 agent panes（window 1）
  ├─ 连接 SSE /event
  └─ 渲染 dashboard
```

### 用户离开

```
用户: Ctrl+B D（tmux detach）
  │
  └─ tmux session 继续运行
     ├─ daemon 继续运行（dashboard 照常渲染）
     ├─ serve 继续运行
     └─ agent panes 继续运行
```

### 用户回来

```
用户: openteam start dev
  │
  ├─ 检查 .runtime.json → daemon PID 存活
  ├─ 检查 tmux session → "openteam-dev" 存在
  └─ tmux attach -t openteam-dev（直接重连）
```

### Serve 崩溃

```
opencode serve 进程退出
  │
  daemon 检测到（子进程 exit 事件 + SSE 断连）
  ├─ dashboard 显示: "⚠ serve 已崩溃，正在重启..."
  ├─ 重启 serve（新端口或同端口）
  ├─ 等待就绪
  ├─ 更新 .runtime.json
  └─ agent panes 的 opencode attach 自动重连（250ms 重试）
```

### Agent Pane 死亡

```
某个 pane 的 opencode attach 退出（崩溃、用户误杀等）
  │
  daemon 定期检查（tmux list-panes）
  ├─ 检测到 pane dead
  ├─ dashboard 显示: "⚠ pm pane 已退出，正在重启..."
  └─ tmux respawn-pane -t {paneId} "opencode attach ..."
```

### 优雅关闭

```
用户: openteam stop dev
  │
  ├─ 读 .runtime.json → daemon PID
  ├─ kill -TERM {daemon PID}
  │
  daemon 收到 SIGTERM:
  ├─ 停止健康检查
  ├─ 停止 SSE
  ├─ kill opencode serve（等待退出，超时 SIGKILL）
  ├─ tmux kill-session "openteam-dev"（杀所有 panes + 自己）
  └─ 清理 .runtime.json
```

## 插件变化

### 移除 `addPaneToMonitor`

当前 `msg` 工具在唤醒 agent 时会直接操作 tmux 添加 pane。
v2 中移除这个逻辑 —— pane 管理完全由 daemon 负责。

Daemon 通过 SSE 监听 `session.created` 事件：
当新 session 属于团队 agent 且没有对应 pane → 自动创建。

### 插件不需要知道 daemon 的存在

插件继续：
- 读 `.active-sessions.json`（daemon 同步更新）
- 通过 serve HTTP API 发消息、查状态
- hooks 注入系统提示不变

解耦点：**插件管 session，daemon 管 pane**。

## 窗口布局

```
tmux session: openteam-dev

Window 0 "dashboard":
┌──────────────────────────────────────────┐
│ OpenTeam Dashboard - dev                 │
│                                          │
│ Serve: ● running  PID: 5678  Port: 4096 │
│                                          │
│ Agent      Status   Last Activity        │
│ pm         working  30s ago              │
│ architect  idle     5m ago               │
│ developer  working  10s ago              │
│ qa         idle     8m ago               │
│                                          │
│ ─── 消息流 ───                           │
│ 10:05 [pm → architect] 请审查这个方案... │
│ 10:03 [developer → pm] 实现完成，已提交  │
│ 10:01 [boss → pm] 开始任务 X             │
└──────────────────────────────────────────┘

Window 1 "agents":
┌───────────────────┬──────────────────────┐
│ pm (TUI)          │ architect (TUI)      │
│                   │                      │
├───────────────────┼──────────────────────┤
│ developer (TUI)   │ qa (TUI)             │
│                   │                      │
└───────────────────┴──────────────────────┘
```

用户通过 `Ctrl+B 0` / `Ctrl+B 1` 在 dashboard 和 agent 窗口间切换。

## 文件结构变化

```
bin/openteam.js              # CLI（简化：start/stop/status/list/attach）
src/
├── index.js                 # 插件入口（不变）
├── constants.js             # 常量（不变）
├── daemon/                  # 新增
│   ├── index.js             # daemon 主循环
│   ├── serve-manager.js     # serve 生命周期管理
│   ├── pane-manager.js      # tmux pane 管理
│   └── activity.js          # SSE 事件流 + agent 状态追踪
├── dashboard/               # 现有（重构）
│   ├── index.js             # 对接 daemon 的 ActivityTracker
│   ├── ui.js                # blessed UI（微调）
│   └── data.js              # 数据层（从 HTTP 轮询改为事件驱动）
├── plugin/
│   ├── hooks.js             # 不变
│   └── tools.js             # 移除 addPaneToMonitor
├── team/
│   ├── config.js            # 不变
│   └── serve.js             # 简化（daemon 接管大部分职责）
└── utils/
    ├── api.js               # 不变
    └── logger.js            # 不变
```

## 实施路径

### Phase 1: Daemon 基础

- [ ] `src/daemon/index.js` — 主循环骨架
- [ ] `src/daemon/serve-manager.js` — serve 作为子进程启动/重启
- [ ] 改造 `cmdStart` — 创建 tmux session + daemon pane + agent panes
- [ ] 改造 `cmdStop` — SIGTERM → daemon → 优雅关闭
- [ ] 修复 tmux env 问题（所有 tmux 调用清理 $TMUX）

### Phase 2: 健康管理

- [ ] `src/daemon/pane-manager.js` — pane 健康检查 + respawn
- [ ] `src/daemon/activity.js` — SSE 连接 + agent 活动追踪
- [ ] Serve 崩溃自动重启
- [ ] Dashboard 对接 ActivityTracker

### Phase 3: 插件解耦

- [ ] 移除 `addPaneToMonitor`
- [ ] Daemon 自动为新 session 创建 pane
- [ ] `.active-sessions.json` 由 daemon 维护

### 未来: Task Queue

- [ ] 结构化任务文件 `.tasks.json`
- [ ] 新工具 `task`（agent 可创建/认领/完成任务）
- [ ] Daemon watchdog：idle agent + pending task → 自动派活
