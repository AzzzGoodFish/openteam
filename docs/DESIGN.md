# OpenTeam 设计文档

OpenTeam 是 OpenCode 的团队协作插件，核心职责是多 Agent 协作与会话编排。

## 设计目标

- 提供明确的 Leader/成员协作边界。
- 支持同一 agent 在不同工作目录并行运行多个实例。
- 通过 Daemon 进程统一管理团队生命周期（serve、pane、健康检查）。
- 提供稳定的运行时状态管理与可视化（dashboard）。

## 核心概念

### 1) 团队角色

- Leader: 可使用 `msg` 广播、`command` 管理团队。
- 成员: 可使用 `msg` 与其他成员点对点协作。

### 2) 消息来源标记

- agent 之间通过 `msg` 发送时，会自动添加 `[from <agent>]`。
- 用户直接输入由 `messagesTransform` 对最近一条 user 文本补 `[from boss]`。

### 3) 多实例

- 同一 agent 可同时存在多个实例，实例由 `cwd` 和可选 `alias` 区分。
- 会话映射持久化在 `.active-sessions.json`。

### 4) Daemon 统一管理

- 团队启动时创建 tmux/zellij session，daemon 运行在 pane 0。
- Daemon 是团队的持久管理进程，拥有 serve 子进程 + 所有 agent pane 的生命周期。
- Serve 崩溃时 daemon 自动重启；pane 死亡时 daemon 自动 respawn。
- Pane 管理完全由 daemon 负责，messaging 层不再有终端副作用。

## 三层架构

依赖单向向下：`Interfaces → Capabilities → Foundation`

```text
bin/openteam.js                     # CLI 路由

src/
├── index.js                        # Plugin 入口 — 导出 hooks + tools
├── interfaces/                     ── 接口层 ──
│   ├── cli.js                      CLI 命令（start/stop/attach/list/status/monitor/dashboard）
│   ├── daemon/                     Daemon 生命周期管理
│   │   ├── index.js                主循环 + 信号处理 + dashboard 嵌入
│   │   ├── serve.js                serve 子进程管理（启动/重启/停止）
│   │   └── panes.js                pane 创建 + 健康检查 + respawn
│   ├── dashboard/                  Dashboard TUI
│   │   ├── index.js                独立运行 + daemon 嵌入两种模式
│   │   ├── ui.js                   blessed UI 组件
│   │   └── data.js                 数据获取
│   └── plugin/                     Plugin 集成（Agent 运行时）
│       ├── hooks.js                消息标记 + 系统注入 hook
│       └── tools.js                msg + command 工具定义
├── capabilities/                   ── 能力层 ──
│   ├── lifecycle.js                Agent 身份识别、会话创建/查找/回收/释放/重定向
│   └── messaging.js                通信（消息投递/广播）+ 团队上下文注入
└── foundation/                     ── 基础层 ──
    ├── constants.js                路径、文件名、默认值常量
    ├── config.js                   团队配置读取与校验
    ├── state.js                    运行时状态持久化
    ├── opencode.js                 OpenCode Serve HTTP API 封装
    ├── terminal.js                 终端复用器抽象 + daemon pane 管理
    ├── logger.js                   日志系统
    └── settings.js                 全局设置
```

### 依赖规则

- Foundation 模块之间互不依赖（constants 除外）
- Capabilities 只依赖 Foundation + 同层单向依赖（messaging → lifecycle）
- Interfaces 依赖 Capabilities + Foundation
- 禁止反向依赖

## 工具契约

| 工具 | 权限 | 关键行为 |
|------|------|----------|
| `msg` | 全员（仅 leader 可广播） | 目标离线会自动创建会话并唤醒；daemon 检测到新 session 后自动创建 pane |
| `command` | 仅 leader | 支持 `status` / `free` / `redirect` |

### `command` 行为细节

- `status`: 查看成员实例状态及会话有效性。
- `free`: 让实例下线；多实例场景必须指定 `cwd` 或 `alias`。
- `redirect`: 先移除目标成员现有实例，再在新 `cwd` 创建实例。

## CLI 行为模型

### start

- 创建 tmux/zellij session，pane 0 运行 daemon。
- Daemon 启动 `opencode serve`（作为子进程），为每个 agent 创建 session 和 pane。
- 若团队已在运行，attach 到已有 session（幂等）。
- `-d` 选项：创建 session 后不 attach，后台运行。

### stop

- 向 daemon 发送 SIGTERM。
- Daemon 收到信号后：停止 serve、清理所有 pane、销毁 tmux/zellij session、清理 runtime 文件。

### attach

- 普通模式: 找到可复用会话或创建新会话后 attach。
- `--cwd` 指定目标实例的工作目录。

### monitor

- `start` 的别名（向后兼容）。

### dashboard

- `openteam dashboard <team>` 启动实时仪表盘。
- 支持独立运行和 daemon 嵌入两种模式。

## 运行时数据

### `.runtime.json`

结构化运行时状态，包含 daemon、serve、终端复用器信息：

```json
{
  "daemon": {
    "pid": 1234
  },
  "serve": {
    "pid": 5678,
    "port": 4096,
    "host": "127.0.0.1"
  },
  "mux": {
    "type": "tmux",
    "session": "openteam-dev"
  }
}
```

### `.active-sessions.json`

```json
{
  "pm": [{ "sessionId": "ses_xxx", "cwd": "/repo" }],
  "developer": [
    { "sessionId": "ses_yyy", "cwd": "/repo-a" },
    { "sessionId": "ses_zzz", "cwd": "/repo-b", "alias": "feature-x" }
  ]
}
```

- 兼容旧格式 `"agent": "sessionId"`。

## 常见边界与约束

- 插件只在 `OPENTEAM_TEAM` 存在时加载。
- `messagesTransform` 不会全量重写历史消息，只处理最近匹配消息。
- `stop` 通过 SIGTERM 通知 daemon 优雅关闭，daemon 负责清理全部资源。
- 终端复用器缺失时会直接报错退出。
- Pane 管理完全由 daemon 负责，messaging 层不操作终端。
