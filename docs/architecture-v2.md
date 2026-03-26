# OpenTeam v2 架构设计

> 解耦重构设计文档。目标：从 opencode 插件转变为独立协作框架，底层 CLI 可替换。

## 设计目标

**当前**：openteam 是 opencode 的寄生插件，借用 opencode serve 做通信
**目标**：openteam 是独立协作框架，底层 CLI 是可替换的执行引擎

```
当前：  CLI(opencode) ──plugin──> openteam(寄生)
目标：  openteam(宿主) ──adapter──> CLI(opencode/claude-code/...)
```

## 核心架构变更

| 组件 | v1（当前） | v2（新） |
|------|-----------|---------|
| 通信 | 借用 opencode serve HTTP API | 自建 openteam server |
| 工具 | opencode plugin tools | MCP tools（server 暴露 MCP 协议） |
| 钩子 | opencode plugin hooks | wrapper client + --append-system-prompt |
| 进程 | opencode attach | wrapper client 管理 CLI 进程 |
| 配置 | ~/.opencode/agents/ | ~/.openteam/ |
| 依赖 | @opencode-ai/plugin | 无 CLI 特定依赖 |

## 系统总览

```
┌─────────────────────────────────────────────────────────────┐
│                      tmux / zellij session                   │
├──────────────┬──────────────┬──────────────┬────────────────┤
│   pane 0     │   pane 1     │   pane 2     │   pane 3       │
│   daemon     │   wrapper    │   wrapper    │   wrapper      │
│   + dashboard│   (pm)       │   (architect)│   (developer)  │
│              │     ↕        │     ↕        │     ↕          │
│              │   CLI TUI    │   CLI TUI    │   CLI TUI      │
│              │   (claude)   │   (claude)   │   (claude)     │
└──────┬───────┴──────┬───────┴──────┬───────┴────────┬───────┘
       │              │              │                │
       │         MCP over SSE       │                │
       │              │              │                │
       ▼              ▼              ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                    openteam server                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ HTTP API │  │ MCP SSE  │  │ 消息 Hub │  │ 状态管理   │  │
│  │ /status  │  │ msg tool │  │ 投递/广播 │  │ agent 注册 │  │
│  │ /tasks   │  │ taskboard│  │ 消息队列  │  │ 在线状态   │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 数据流

### agent 间通信

```
pm 的 CLI 调用 msg tool
  → MCP tool 请求到达 openteam server（身份：agent=pm）
    → server hub 将消息存入 architect 的队列
      → architect 的 wrapper 轮询/SSE 收到消息
        → wrapper 通过 send-keys 注入到 architect 的 pane
          → "[from pm] 需求已整理好，请设计方案"
            → architect 的 CLI 看到"用户输入"，开始处理
```

### 任务通知

```
pm 的 CLI 调用 taskboard(create, assignee="developer")
  → MCP tool 到达 server
    → taskboard 逻辑创建任务
      → 依赖满足 → hub 投递通知到 developer
        → developer 的 wrapper send-keys 注入
          → "[task #1] 实现登录功能：..."
```

## 目录结构

### 配置目录 (~/.openteam/)

```
~/.openteam/
├── settings.json               # 全局设置（default_cli 等）
├── agents/                     # agent 定义（所有团队共享）
│   ├── pm.md
│   ├── architect.md
│   ├── developer.md
│   └── qa.md
├── skills/                     # skill 定义
│   └── team-collaboration/
│       └── SKILL.md
└── teams/
    └── dev/
        ├── team.json           # 团队配置
        └── <hash>/             # 项目级运行时状态
            ├── .state.json     # daemon/server/mux 状态
            └── .tasks.json     # 任务数据
```

### team.json 格式

```json
{
  "leader": "pm",
  "agents": ["pm", "architect", "developer", "qa"],
  "default_cli": "claude-code"
}
```

### 项目目录链接（启动时自动创建）

```
<project>/
├── .claude/
│   ├── agents/
│   │   ├── pm.md           → ~/.openteam/agents/pm.md (symlink)
│   │   ├── architect.md    → ~/.openteam/agents/architect.md (symlink)
│   │   └── ...
│   └── skills/
│       └── team-collaboration/ → ~/.openteam/skills/team-collaboration/ (symlink)
```

## 模块设计

### 代码结构

```
bin/openteam.js                        # CLI 入口

src/
├── server/                            ── openteam server ──
│   ├── index.js                       HTTP + MCP server 启动
│   ├── routes.js                      REST API 路由（status/tasks）
│   ├── mcp.js                         MCP over SSE（msg/taskboard tools）
│   └── hub.js                         消息中枢（投递/广播/队列）
│
├── wrapper/                           ── wrapper client ──
│   └── index.js                       pane 内运行，桥接 server ↔ CLI
│
├── adapters/                          ── CLI 适配层 ──
│   ├── base.js                        适配器接口定义
│   ├── opencode.js                    opencode 适配
│   └── claude-code.js                 claude code 适配
│
├── capabilities/                      ── 能力层 ──
│   ├── lifecycle.js                   agent 注册/发现（简化）
│   ├── messaging.js                   消息投递/广播（走 server hub）
│   └── taskboard.js                   任务看板（复用）
│
├── foundation/                        ── 基础层 ──
│   ├── constants.js                   路径常量（~/.openteam）
│   ├── config.js                      团队配置（复用）
│   ├── state.js                       状态持久化（复用）
│   ├── tasks.js                       任务数据（复用）
│   ├── terminal.js                    终端复用器（复用）
│   └── logger.js                      日志（复用）
│
└── interfaces/                        ── 接口层 ──
    ├── cli.js                         CLI 命令（start/stop/list/inspect）
    ├── daemon/                        Daemon 生命周期
    │   ├── index.js                   主循环 + 信号处理
    │   ├── panes.js                   pane 管理 + 健康检查 + respawn
    │   └── links.js                   agent/skill 软链接管理
    └── dashboard/                     Dashboard TUI（复用）
        ├── index.js
        ├── ui.js
        └── data.js
```

### 依赖规则

```
Interfaces → Capabilities → Foundation
     ↓            ↓
   server/      adapters/（基础层，无业务逻辑）
   wrapper/（接口层）
```

- Foundation 模块之间互不依赖（constants 除外）
- Capabilities 只依赖 Foundation + 同层单向依赖
- Interfaces 依赖 Capabilities + Foundation
- server/ 横跨接口层和能力层：路由是接口，hub 是能力
- adapters/ 是基础层，只提供 CLI 命令构建，不含业务逻辑
- 禁止反向依赖

## 各模块职责

### server/hub.js — 消息中枢

```javascript
// 核心 API
hub.deliver({ from, to, message })    // 投递消息到目标 agent 队列
hub.broadcast({ from, message })      // 广播给所有 agent（排除 from）
hub.pull(agent)                       // 拉取 agent 的待接收消息
hub.register(agent)                   // 注册 agent（wrapper 连接时）
hub.unregister(agent)                 // 注销 agent（wrapper 断开时）
hub.status()                          // 所有 agent 状态
```

消息队列在内存中维护。server 崩溃后消息丢失可接受 — daemon 会重启 server，agent 重新连接。

### server/mcp.js — MCP over SSE

暴露两个 MCP tools：

**msg**
```
参数: { who?: string, message: string }
身份: 从 MCP 连接的环境变量获取（agent=xxx）
逻辑: 调用 hub.deliver / hub.broadcast
```

**taskboard**
```
参数: { action: string, title?, description?, assignee?, depends_on?, id? }
身份: 同上
逻辑: 调用 capabilities/taskboard.js
```

### wrapper/index.js — 桥接进程

每个 agent pane 内运行。生命周期：

```
1. 启动
   - 读取环境变量：OPENTEAM_AGENT, OPENTEAM_SERVER, OPENTEAM_TEAM...
   - 向 server 注册：POST /register { agent }

2. 准备 CLI 环境
   - 通过 adapter 构建 MCP 配置（server URL + agent 身份）
   - 写入临时 MCP 配置文件
   - 构建 CLI 启动命令：
     claude --agent <agent> --append-system-prompt "协作规则" --mcp-config <path>

3. 启动 CLI
   - exec 替换自身为 CLI 进程（wrapper 退出，CLI 占据 pane）
   - 或 spawn CLI 子进程（wrapper 作为后台 daemon 保持运行）

4. 消息注入循环（如果 wrapper 保持运行）
   - 轮询 server: GET /msg/<agent>
   - 收到消息 → send-keys 注入到当前 pane
   - 使用 bracketed paste 模式处理多行消息

5. 退出
   - CLI 退出时 wrapper 也退出
   - 或 wrapper 被 kill 时清理 CLI 子进程
```

### adapters/ — CLI 适配器

```javascript
// adapters/base.js
export class BaseAdapter {
  // CLI 二进制名称
  get binary() { }

  // 构建启动命令
  buildLaunchCmd({ agent, systemPrompt, mcpConfigPath, cwd }) { }

  // 构建 send-keys 输入格式（处理换行、转义）
  formatInput(message) { }

  // 构建 MCP 配置内容
  buildMcpConfig({ serverUrl, agent }) { }
}
```

```javascript
// adapters/claude-code.js
export class ClaudeCodeAdapter extends BaseAdapter {
  get binary() { return 'claude'; }

  buildLaunchCmd({ agent, systemPrompt, mcpConfigPath, cwd }) {
    return [
      'claude',
      '--agent', agent,
      '--append-system-prompt', systemPrompt,
      // MCP 配置通过配置文件传入
    ];
  }
}
```

```javascript
// adapters/opencode.js
export class OpenCodeAdapter extends BaseAdapter {
  get binary() { return 'opencode'; }

  buildLaunchCmd({ agent, systemPrompt, mcpConfigPath, cwd }) {
    return [
      'opencode',
      '--prompt', systemPrompt,
      // MCP 配置方式待确认
    ];
  }
}
```

### interfaces/daemon/links.js — 软链接管理

```javascript
// 启动时调用：确保项目目录的 agent/skill 链接正确
export function ensureLinks(teamName, projectDir, cliType) {
  // 1. 确定目标目录（.claude/ 或其他 CLI 的配置目录）
  // 2. 遍历 team.json 的 agents 列表
  // 3. 为每个 agent 创建/检查 ~/.openteam/agents/<agent>.md 的链接
  // 4. 为 skills 创建/检查链接
}
```

## 启动流程

```
openteam start dev [--cli claude-code]
  │
  ├── 1. 读取 team.json，校验配置
  ├── 2. 确定 CLI adapter（--cli 参数 > team.json default_cli）
  ├── 3. 检测 tmux/zellij
  ├── 4. 创建 mux session
  │      ├── pane 0: daemon
  │      └── pane 1-N: 预留给 wrapper（zellij 用 team layout 一步创建）
  │
  └── daemon 启动后：
      ├── 5. 启动 openteam server（HTTP + MCP over SSE）
      ├── 6. 创建/检查 agent + skill 软链接（links.js）
      ├── 7. 为每个 agent 创建 wrapper pane
      │      wrapper 启动 → 注册到 server → 生成 MCP 配置 → 启动 CLI
      ├── 8. 启动嵌入式 dashboard
      └── 9. 进入健康检查循环（检测 wrapper pane 存活，respawn 挂掉的）
```

## 废弃清单

以下模块在 v2 中删除：

| 文件 | 理由 |
|------|------|
| `src/index.js` | opencode plugin 入口 |
| `src/interfaces/plugin/hooks.js` | plugin hooks，被 wrapper + system prompt 替代 |
| `src/interfaces/plugin/tools.js` | plugin tools，被 MCP tools 替代 |
| `src/foundation/opencode.js` | opencode serve HTTP API client |
| `@opencode-ai/plugin` 依赖 | 不再需要 |

## 复用清单

| 模块 | 复用程度 | 说明 |
|------|----------|------|
| `foundation/config.js` | 完整复用 | 路径调整 |
| `foundation/state.js` | 完整复用 | 路径调整，session 映射简化 |
| `foundation/tasks.js` | 完整复用 | 无变化 |
| `foundation/terminal.js` | 完整复用 | 扩展 send-keys 能力 |
| `foundation/logger.js` | 完整复用 | 无变化 |
| `foundation/constants.js` | 完整复用 | ~/.opencode → ~/.openteam |
| `capabilities/taskboard.js` | 完整复用 | deliverMessage 接口不变 |
| `capabilities/messaging.js` | 重写 | 业务流程借鉴，底层走 hub |
| `capabilities/lifecycle.js` | 重写简化 | 身份由 MCP 连接参数确定 |
| `interfaces/cli.js` | 大部分复用 | start/stop/list 编排逻辑调整 |
| `interfaces/daemon/` | 骨架复用 | serve → server，pane 逻辑类似 |
| `interfaces/dashboard/` | 完整复用 | 数据源对接 server API |

## 消息格式

| 来源 | 格式 | 说明 |
|------|------|------|
| agent 间 | `[from <agent>] 消息` | server hub 自动添加前缀 |
| boss 直接输入 | 无前缀 | 系统提示词说明：无标签 = boss 消息 |
| 任务通知 | `[task #N] 标题：描述` | taskboard 生成 |

## 关键技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 消息注入方式 | tmux send-keys / zellij write-chars | 复用已有 mux，零侵入，CLI 无感知 |
| 多行消息处理 | bracketed paste 模式 | 防止中间换行触发提交 |
| MCP 传输 | SSE | server 已在运行，所有 agent 共享一个 |
| agent 身份传递 | MCP 连接 URL 参数 + 环境变量 | wrapper 设置环境变量，构建 MCP 配置 |
| 工具集 | msg + taskboard（废弃 command） | command 功能被 dashboard 覆盖 |
| 消息队列 | 内存 | 崩溃丢失可接受，daemon 会重启 |
