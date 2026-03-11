# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenTeam 是一个独立的 Agent 团队协作框架，底层 CLI 可替换（claude-code / opencode）。它实现了：
- 多 Agent 协作（Leader 管理 + 成员间异步通信）
- 自建 MCP server（消息中枢 + 工具暴露）
- Daemon 统一生命周期管理（server + wrapper panes + 健康检查）

## Commands

```bash
# 安装依赖
npm install

# 运行 CLI（开发时）
node bin/openteam.js <command>

# 或全局安装后
npm link
openteam <command>
```

**没有测试框架** - `npm test` 只是占位符。

## Architecture

三层架构，依赖单向向下：`Interfaces → Capabilities → Foundation`

```
bin/openteam.js                     # CLI 入口 — 纯 Commander 路由

src/
├── interfaces/                     ── 接口层：谁在调用 ──
│   ├── cli.js                      CLI 命令（start/stop/list/inspect）
│   ├── daemon/                     Daemon 生命周期管理（团队的持久管理进程）
│   │   ├── index.js                主循环 + 信号处理 + dashboard 嵌入
│   │   ├── serve.js                server 生命周期管理（in-process 启动/停止）
│   │   └── panes.js                pane 创建（wrapper 命令）+ 健康检查 + respawn
│   └── dashboard/                  Dashboard TUI
│       ├── index.js                独立运行 + daemon 嵌入两种模式
│       ├── ui.js                   blessed UI 组件
│       └── data.js                 数据获取（server REST API + tasks 文件）

├── server/                         ── 通信层：openteam server ──
│   ├── index.js                    HTTP server（MCP + REST API 路由分发）
│   ├── hub.js                      MessageHub（纯内存消息队列）
│   ├── mcp.js                      MCP tools 注册（msg + taskboard）
│   └── routes.js                   REST API（register/unregister/messages/status/tasks）

├── adapters/                       ── 适配层：CLI 抽象 ──
│   ├── base.js                     BaseAdapter 基类 + 工厂函数
│   ├── claude-code.js              Claude Code 适配器
│   └── opencode.js                 OpenCode 适配器

├── wrapper/                        ── 桥接层：pane 内运行 ──
│   └── index.js                    Wrapper client（注册 → MCP 配置 → 启动 CLI → 轮询消息）

├── capabilities/                   ── 能力层：做什么 ──
│   └── taskboard.js                任务看板（创建/完成/依赖检查/自动通知）

├── foundation/                     ── 基础层：基础设施 ──
│   ├── constants.js                路径、文件名、默认值常量
│   ├── config.js                   团队配置读取与校验
│   ├── state.js                    运行时状态持久化（daemon + server + mux 信息）
│   ├── tasks.js                    任务数据持久化
│   ├── terminal.js                 终端复用器抽象 + daemon pane 管理
│   └── logger.js                   日志系统
```

### 依赖规则

- Foundation 模块之间互不依赖（constants 和 logger 除外）
- Capabilities 只依赖 Foundation
- Interfaces 依赖 Capabilities + Foundation
- server/ 依赖 Foundation + Capabilities
- adapters/ 是基础层（只构建命令，不含业务逻辑）
- wrapper/ 依赖 adapters/ + Foundation
- 禁止反向依赖

### 架构整洁原则

以下原则是代码变更的硬性约束，适用于所有新增和修改的代码。

**依赖方向**
- 只能向下依赖：Interfaces → Capabilities → Foundation
- Foundation 模块之间互不依赖（constants 和 logger 除外）
- Capabilities 内允许单向依赖，禁止循环
- 禁止任何反向依赖（如 Foundation 调用 Capabilities）

**代码归属**
- 业务逻辑属于 Capabilities，不允许泄漏到 Interfaces 或 Foundation
- Interfaces 只做：参数校验、权限检查、格式化输出、调用编排
- Foundation 只做：数据读写、外部 API 调用、基础工具，不含业务判断

**复用优先**
- 新增功能前先检查 Capabilities 层是否已有可复用的方法
- 同一逻辑禁止在多个模块中重复实现

**模块边界**
- 每个模块的导出方法即为其完整 API，内部实现不暴露
- 新增文件必须放入正确的层级目录，不允许在 `src/` 根目录创建文件

### Key Patterns

1. **消息标记** - 所有消息带 `[from xxx]` 前缀标识来源
2. **MCP over SSE** - agent 通过 MCP tools（msg/taskboard）与 server 通信
3. **消息轮询** - wrapper 轮询 server REST API 拉取消息，通过 mux send-keys 注入 CLI
4. **Daemon 统一管理** - daemon 运行在 tmux/zellij pane 0，管理 server（in-process）+ wrapper panes + 健康检查
5. **终端复用** - tmux/zellij 实现多 agent 分屏，daemon 负责 pane 的创建与 respawn
6. **Wrapper 桥接** - 每个 agent pane 运行 wrapper → 注册到 server → 生成 MCP 配置 → 启动 CLI

### Data Flow

```
agent 间通信:
pm 的 CLI 调用 msg tool → MCP 请求到 server → hub 存入目标队列
  → 目标 wrapper 轮询拉取 → send-keys 注入到目标 CLI pane

任务通知:
pm 的 CLI 调用 taskboard(create) → MCP 到 server → taskboard 创建任务
  → 依赖满足 → hub.deliver() → wrapper 轮询注入 → "[task #1] ..."

团队启动:
openteam start → 创建 tmux/zellij session
             → pane 0: daemon（启动 server + 创建 wrapper panes + dashboard）
             → pane 1+: wrapper → 注册 → MCP 配置 → 启动 CLI TUI
```

### Runtime Files (团队状态目录下)

- `.state.json` - 结构化运行时状态：
  ```json
  {
    "daemon": { "pid": 1234 },
    "serve": { "port": 4096, "host": "127.0.0.1" },
    "mux": { "type": "tmux", "session": "openteam-dev-82b4f9b2" }
  }
  ```
- `.tasks.json` - 任务看板数据

### Config Directory (~/.openteam/)

```
~/.openteam/
├── settings.json               # 全局设置
├── agents/                     # agent 定义（所有团队共享）
├── skills/                     # skill 定义
└── teams/
    └── <team>/
        ├── team.json           # 团队配置（leader, agents, default_cli）
        └── <hash>/             # 项目级运行时状态
            ├── .state.json
            └── .tasks.json
```

## Code Style

- **ES Modules** - 使用 `import/export`，不用 CommonJS
- **纯 JavaScript** - 无 TypeScript
- 代码注释使用中文

## Important Behaviors

- `msg` MCP tool 投递消息到 hub 队列，wrapper 轮询拉取后通过 send-keys 注入 CLI
- `taskboard` MCP tool 支持 create（leader only）、done、list
- 启动时会校验 leader 必须在 agents 列表中
- 消息轮询间隔 1000ms（在 `src/wrapper/index.js` 中）
- `start` 创建 tmux/zellij session 并启动 daemon；重复运行时 attach 到已有 session（幂等）
- `stop` 向 daemon 发送 SIGTERM，daemon 负责优雅关闭 server、清理 runtime
- Pane 管理完全由 daemon 负责：每个 pane 运行 wrapper，wrapper 管理 CLI 子进程
