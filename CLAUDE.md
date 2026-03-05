# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenTeam 是一个面向 Agent 的团队协作框架，作为 OpenCode 插件运行。它实现了：
- 多 Agent 协作（Leader 管理 + 成员间异步通信）
- 多实例支持（同一 agent 可在不同目录运行多个实例）
- Daemon 统一生命周期管理（serve 进程、agent pane、健康检查）

**注意**：记忆系统已拆分到独立插件 `openmemory`（位于 `../openmemory`）。

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
├── index.js                        # Plugin 入口 — 导出 hooks + tools

├── interfaces/                     ── 接口层：谁在调用 ──
│   ├── cli.js                      CLI 命令（start/stop/attach/list/status/monitor/dashboard）
│   ├── daemon/                     Daemon 生命周期管理（团队的持久管理进程）
│   │   ├── index.js                主循环 + 信号处理 + dashboard 嵌入
│   │   ├── serve.js                serve 子进程管理（启动/重启/停止）
│   │   └── panes.js                pane 创建 + 健康检查 + respawn
│   ├── dashboard/                  Dashboard TUI
│   │   ├── index.js                独立运行 + daemon 嵌入两种模式
│   │   ├── ui.js                   blessed UI 组件
│   │   └── data.js                 数据获取
│   └── plugin/                     Plugin 集成（Agent 运行时）
│       ├── hooks.js                消息标记 + 系统注入 hook（薄委托）
│       └── tools.js                msg + command 工具定义（权限校验 + 路由）

├── capabilities/                   ── 能力层：做什么 ──
│   ├── lifecycle.js                Agent 身份识别、会话创建/查找/回收/释放/重定向
│   └── messaging.js                通信（消息投递/广播）+ 团队上下文注入

├── foundation/                     ── 基础层：基础设施 ──
│   ├── constants.js                路径、文件名、默认值常量
│   ├── config.js                   团队配置读取与校验
│   ├── state.js                    运行时状态持久化（daemon + serve + mux 信息）
│   ├── opencode.js                 OpenCode Serve HTTP API 封装
│   ├── terminal.js                 终端复用器抽象 + daemon pane 管理
│   └── logger.js                   日志系统
```

### 依赖规则

- Foundation 模块之间互不依赖（constants 除外）
- Capabilities 只依赖 Foundation + 同层单向依赖（messaging → lifecycle）
- Interfaces 依赖 Capabilities + Foundation
- 禁止反向依赖

### 架构整洁原则

以下原则是代码变更的硬性约束，适用于所有新增和修改的代码。

**依赖方向**
- 只能向下依赖：Interfaces → Capabilities → Foundation
- Foundation 模块之间互不依赖（constants 除外）
- Capabilities 内允许单向依赖，禁止循环
- 禁止任何反向依赖（如 Foundation 调用 Capabilities）

**代码归属**
- 业务逻辑属于 Capabilities，不允许泄漏到 Interfaces 或 Foundation
- Interfaces 只做：参数校验、权限检查、格式化输出、调用编排
- Foundation 只做：数据读写、外部 API 调用、基础工具，不含业务判断

**复用优先**
- 新增功能前先检查 Capabilities 层是否已有可复用的方法
- 同一逻辑禁止在多个模块中重复实现
- 所有对 OpenCode Serve 的 HTTP 调用必须走 `foundation/opencode.js`，禁止 raw fetch

**模块边界**
- 每个模块的导出方法即为其完整 API，内部实现不暴露
- 新增文件必须放入正确的层级目录，不允许在 `src/` 根目录创建文件（`index.js` 除外）

### Key Patterns

1. **消息标记** - 所有消息带 `[from xxx]` 前缀标识来源
2. **HTTP 轮询** - 通过 OpenCode Serve API 轮询会话状态（非 WebSocket）
3. **Daemon 统一管理** - daemon 运行在 tmux/zellij pane 0，管理 serve 子进程 + agent panes + 健康检查
4. **终端复用** - tmux/zellij 实现多 agent 分屏，daemon 负责 pane 的创建与 respawn

### Data Flow

```
用户输入 → messagesTransform hook (添加 [from boss])
       → agent 处理
       → 使用 tools (msg/command)
       → systemTransform hook 注入团队上下文

团队启动:
openteam start → 创建 tmux/zellij session
             → pane 0: daemon（管理 serve + agent panes + dashboard）
             → pane 1+: agent TUI（opencode attach）
```

### Runtime Files (团队目录下)

- `.runtime.json` - 结构化运行时状态：
  ```json
  {
    "daemon": { "pid": 1234 },
    "serve": { "pid": 5678, "port": 4096, "host": "127.0.0.1" },
    "mux": { "type": "tmux", "session": "openteam-dev" }
  }
  ```
- `.active-sessions.json` - agent → [{sessionId, cwd}] 映射

## Code Style

- **ES Modules** - 使用 `import/export`，不用 CommonJS
- **纯 JavaScript** - 无 TypeScript
- 代码注释使用中文

## Important Behaviors

- `msg` 工具会自动唤醒离线 agent（创建会话），daemon 检测新 session 后自动创建对应 pane
- `command` 仅 leader 可用，支持 actions：status/free/redirect
- 启动时会校验 leader 必须在 agents 列表中
- 消息轮询间隔 500ms（在 `src/foundation/opencode.js` 中）
- `start` 创建 tmux/zellij session 并启动 daemon；重复运行时 attach 到已有 session（幂等）
- `monitor` 是 `start` 的别名（向后兼容）
- `stop` 向 daemon 发送 SIGTERM，daemon 负责优雅关闭 serve、清理所有 pane
- Pane 管理完全由 daemon 负责：messaging 层不再有终端副作用
