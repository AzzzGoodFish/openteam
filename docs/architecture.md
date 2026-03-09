# OpenTeam 架构文档

> 这是当前实现的架构真相。`docs/archive/` 中的文档仅保留历史背景，不作为现行约定。

## 执行摘要

OpenTeam 是 OpenCode 的 Agent 团队协作插件，提供：
- **团队协作**: Leader-Member 模式，支持 agent 间通信
- **多实例支持**: 一个 agent 可在多个工作目录运行
- **Daemon 统一管理**: serve 子进程 + agent pane + 健康检查
- **运行态可视化**: `dashboard` 实时仪表盘

> OpenTeam 只做协作编排；memory 能力不在本仓库内。

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 语言 | JavaScript | ES Modules |
| 运行时 | Node.js | 18+ |
| CLI 框架 | Commander.js | ^12.0.0 |
| 插件 SDK | @opencode-ai/plugin | ^1.2.18 |

## 三层架构

依赖单向向下：`Interfaces → Capabilities → Foundation`

```
┌─────────────────────────────────────────────────────────┐
│                     接口层 (Interfaces)                  │
├─────────────────────────────────────────────────────────┤
│  CLI (cli.js)               │    Plugin (plugin/)       │
│  - start/stop/list/inspect   │    - tools.js (msg/cmd)  │
│                              │    - hooks.js (标记/注入) │
│                              │                          │
│  Daemon (daemon/)           │    Dashboard (dashboard/) │
│  - serve 子进程管理          │    - 实时状态 TUI         │
│  - pane 管理 + 健康检查      │                          │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                     能力层 (Capabilities)                │
├─────────────────────────────────────────────────────────┤
│  lifecycle.js               │    messaging.js           │
│  - 身份识别                  │    - 消息投递/广播        │
│  - 会话创建/查找/回收        │    - 团队上下文注入       │
│  - agent 释放/重定向         │                          │
│                              │    taskboard.js           │
│                              │    - 任务创建/完成        │
│                              │    - 依赖检查/自动通知    │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                     基础层 (Foundation)                  │
├─────────────────────────────────────────────────────────┤
│  constants.js  config.js    state.js    opencode.js     │
│  terminal.js   logger.js    tasks.js                    │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                     数据层                               │
├─────────────────────────────────────────────────────────┤
│  ~/.opencode/agents/<team>/                             │
│  ├── team.json              # 团队配置                  │
│  ├── <agent>.md             # agent 提示词              │
│  └── <hash>/                # 项目级状态目录             │
│      ├── .runtime.json      # daemon/serve/mux 状态     │
│      ├── .active-sessions.json  # 会话映射              │
│      └── .tasks.json        # 任务看板数据              │
└─────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. 团队系统

Leader-Member 模式：

| 角色 | 能力 |
|------|------|
| Leader | `command` (管理) + `msg` (可广播) + `task` (create) |
| Member | `msg` (点对点通信) + `task` (done/list) |

**command 支持的 action**:
- `status` - 查看团队状态
- `free` - 让 agent 休息
- `redirect` - 切换工作目录

**task 支持的 action**:
- `create` - 创建任务（仅 leader），支持依赖关系
- `done` - 标记任务完成，自动通知下游依赖满足的 assignee
- `list` - 查看所有任务及状态

### 2. 插件系统 (src/interfaces/plugin/)

**tools.js** - 工具定义：
1. msg (异步消息)
2. command (团队管理)
3. task (任务看板)

**hooks.js** - 两个 hook：
- `messagesTransform`: 给最近一条 user 文本消息添加 `[from boss]`
- `systemTransform`: 注入团队上下文 + 协作规则

## 数据架构

### 配置文件

```
~/.opencode/agents/<team>/
├── team.json                 # 团队配置
│   {
│     "name": "team1",
│     "leader": "pm",
│     "agents": ["pm", "architect", "developer"]
│   }
└── <agent>.md                # agent 提示词
```

### 运行时文件（项目级）

运行时状态按项目隔离，位于 `~/.opencode/agents/<team>/<hash>/`（hash 为 projectDir 的 SHA-256 前 8 位）：

```
.runtime.json             # daemon/serve/mux 运行状态
.active-sessions.json     # agent → [{ sessionId, cwd }] 会话映射
```

- `state.js` 读取 `.runtime.json` 后会通过 `normalizeRuntime()` 暴露统一结构。
- `loadActiveSessions()` 读取 `.active-sessions.json` 后始终返回归一化的实例数组。

## 生命周期

### start

- CLI 创建 tmux/zellij session，pane 0 运行 daemon。
- daemon 启动 `opencode serve`，恢复已有 session，并确保团队成员会话与 pane 存在。

### stop

- CLI 向 daemon 发送 SIGTERM。
- daemon 停止 serve、停止 dashboard、清理 runtime 文件。
- CLI 在 daemon 退出后兜底销毁 mux session，处理残留终端会话。

### inspect

- 同一团队可以在多个项目目录启动实例。
- 当存在多个项目实例时，`inspect` 等命令需要 `--dir` 指定目标实例。

## 消息格式

消息来源标记规则：

| 来源 | 格式 | 说明 |
|------|------|------|
| agent 间 | `[from <agent>]` | msg 工具自动添加 |
| 用户直接输入 | `[from boss]` | hook 只处理最近一条 user 文本消息 |

## 扩展点

1. **新增工具**: 修改 `src/interfaces/plugin/tools.js`
2. **新增 command action**: 修改 `src/interfaces/plugin/tools.js` 中 `command` 分支

## 相关文档

- [README](../README.md) - 安装、启动、CLI 使用
- [开发指南](./development-guide.md) - 开发环境、smoke 验证、调试方式
- [示例团队](../examples/dev-team/readme.md) - 四角色开发团队示例
