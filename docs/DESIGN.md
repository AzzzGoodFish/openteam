# OpenTeam 设计文档

OpenTeam 是 OpenCode 的团队协作插件，核心职责是多 Agent 协作与会话编排。

## 设计目标

- 提供明确的 Leader/成员协作边界。
- 支持同一 agent 在不同工作目录并行运行多个实例。
- 提供稳定的运行时状态管理与可视化（monitor/dashboard）。

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

## 插件结构

```text
src/
├── index.js                # OPENTEAM_TEAM 条件加载插件
├── plugin/
│   ├── hooks.js            # messages/system transform
│   └── tools.js            # msg / command
├── team/
│   ├── config.js           # team.json 校验
│   └── serve.js            # runtime/session/monitor
├── dashboard/
│   ├── index.js
│   ├── data.js
│   └── ui.js
└── utils/
    ├── api.js
    ├── agent.js
    ├── logger.js
    └── settings.js
```

## 工具契约

| 工具 | 权限 | 关键行为 |
|------|------|----------|
| `msg` | 全员（仅 leader 可广播） | 目标离线会自动创建会话并唤醒 |
| `command` | 仅 leader | 支持 `status` / `free` / `redirect` |

### `command` 行为细节

- `status`: 查看成员实例状态及会话有效性。
- `free`: 让实例下线；多实例场景必须指定 `cwd` 或 `alias`。
- `redirect`: 先移除目标成员现有实例，再在新 `cwd` 创建实例。

## CLI 行为模型

### start

- 启动 `opencode serve`，注入 `OPENTEAM_TEAM` 环境变量。
- 若前台模式，完成后直接 attach 到 leader 会话。

### attach

- 普通模式: 找到可复用会话或创建新会话后 attach。
- `--watch`: 每 2 秒轮询会话状态；会话结束后继续等待。
- `--cwd` 当前仅用于 `--watch` 筛选目标实例。

### monitor

- 自动检测复用器（优先 zellij，其次 tmux）。
- 每 4 个 agent 组成一个 2x2 窗口/tab，不足时用最后一个 agent 补齐。
- 每个 pane 本质执行 `openteam attach <team> <agent> --watch`。

### dashboard

- `openteam dashboard <team>` 启动实时仪表盘。
- 默认 3 秒刷新团队状态、agent 状态与消息流。

## 运行时数据

### `.runtime.json`

- 团队级运行态：`host`、`port`、`pid`、`projectDir`、`started`。
- monitor 期间附带 `monitor` 字段记录复用器信息。

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
- `stop` 会清空 active sessions 映射（本地状态重置）。
- monitor 复用器缺失时会直接报错退出。
