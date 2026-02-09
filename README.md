# OpenTeam

面向 OpenCode 的 Agent 团队协作插件，负责多 Agent 协作、会话编排和多实例管理。

## 定位

- OpenTeam 只负责团队协作能力：`msg` / `command`、CLI 编排、监控与状态管理。
- 本仓库不再包含 memory 实现；如需记忆能力，请使用独立插件 `openmemory`。

## 核心能力

- Leader-成员协作模型，支持异步消息通信。
- 同一 agent 支持多实例（不同 `cwd` 下并行运行）。
- `monitor` 一键分屏监控（tmux/zellij，2x2 布局）。
- `dashboard` 实时仪表盘查看团队状态。

## 安装

```bash
npm install -g openteam
```

## 快速开始

### 1) 配置 OpenCode 插件

在 `~/.opencode/opencode.json` 中添加：

```json
{
  "plugin": ["openteam"]
}
```

### 2) 创建团队配置

创建 `~/.opencode/agents/<team>/team.json`：

```json
{
  "name": "myteam",
  "leader": "pm",
  "host": "127.0.0.1",
  "port": 0,
  "agents": ["pm", "architect", "developer", "qa"]
}
```

- `leader` 必须包含在 `agents` 中。
- `port: 0` 表示自动在 `4096-4200` 之间分配可用端口。

### 3) 创建 Agent 提示词

在 `~/.opencode/agents/<team>/` 下创建对应角色文件（如 `pm.md`、`developer.md`）。

### 4) 启动团队

```bash
openteam start myteam
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `openteam start [team]` | 启动团队 serve；前台模式会直接进入 leader 会话 |
| `openteam start [team] -d` | 后台启动 |
| `openteam start [team] --dir <directory>` | 指定项目目录 |
| `openteam attach [team] [agent]` | 附加到 agent 会话（默认 leader） |
| `openteam attach [team] [agent] --watch` | 监视模式，自动跟随会话变化 |
| `openteam attach [team] [agent] --cwd <directory>` | 仅在 `--watch` 下筛选实例 |
| `openteam monitor [team]` | 打开分屏监控（自动检测 zellij/tmux） |
| `openteam monitor [team] --zellij/--tmux` | 强制使用指定复用器 |
| `openteam list` / `openteam ls` | 列出所有已配置团队及运行状态 |
| `openteam status <team>` | 查看运行状态与会话有效性 |
| `openteam stop <team>` | 停止团队并清理运行时映射 |
| `openteam dashboard <team>` | 启动实时状态仪表盘 |

## 团队工具

| 工具 | 权限 | 说明 |
|------|------|------|
| `msg` | 全员可用（仅 leader 可广播） | 异步消息；目标离线会自动唤醒并建会话 |
| `command` | 仅 leader | `status` / `free` / `redirect` |

### `command` 行为说明

- `status`: 查看成员实例状态。
- `free`: 让成员实例下线；若该成员有多个实例，必须指定 `cwd` 或 `alias`。
- `redirect`: 清空目标成员当前实例后，在新目录创建实例。

## 运行时文件

运行时数据位于 `~/.opencode/agents/<team>/`：

```text
team.json
.runtime.json
.active-sessions.json
<agent>.md
```

- `.runtime.json`: `host`、`port`、`pid`、`projectDir`、`started`，监控时会写入 `monitor` 信息。
- `.active-sessions.json`: `agent -> [{ sessionId, cwd, alias? }]` 多实例映射（兼容旧格式字符串）。

## 注意事项

- 插件仅在 `OPENTEAM_TEAM` 环境变量存在时启用，建议始终通过 `openteam start` 启动。
- `attach --watch` 会持续轮询并保持等待，按 `Ctrl+C` 退出。
- `monitor` 使用 2x2 分组，不足 4 个 pane 会用最后一个 agent 补齐。
- `stop` 会清空 `.active-sessions.json`（会话映射重置）。

## 调试与日志

```bash
# 启用日志
OPENTEAM_LOG=1 openteam start myteam

# 设置日志级别 (debug/info/warn/error)
OPENTEAM_LOG=1 OPENTEAM_LOG_LEVEL=debug openteam start myteam
```

- 日志文件：`~/.openteam/openteam.log`

## 许可证

MIT
