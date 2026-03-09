# OpenTeam

面向 OpenCode 的 Agent 团队协作插件，负责多 Agent 协作、会话编排和多实例管理。

## 核心能力

- Leader-成员协作模型，支持异步消息通信。
- 同一 agent 支持多实例（不同 `cwd` 下并行运行）。
- Daemon 统一管理团队生命周期（serve、pane、健康检查）。
- `dashboard` 实时仪表盘查看团队状态。

## 环境要求

| 依赖 | 要求 |
|------|------|
| Node.js | 18+ |
| tmux 或 zellij | 任一 |

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

## 示例：Dev Team

`examples/dev-team/` 提供了一个完整的四角色开发团队配置，开箱即用。

### 角色

| Agent | 角色 | 职责 |
|-------|------|------|
| **pm**（leader） | 产品经理 | 澄清需求、编写 PRD、协调团队 |
| **architect** | 架构师 | 阅读代码库、设计实现方案、架构评审 |
| **developer** | 开发者 | 按方案实现代码、编写单元测试 |
| **qa** | 测试工程师 | 设计测试计划、执行验收测试、提交 Bug |

### 协作流程

```
用户需求 → PM 澄清需求 & 编写 PRD
                ↓                        ↓
          Architect 设计              QA 设计测试计划
          实现方案                    （并行）
                ↓
          Developer 实现 + 单元测试
                ↓
          QA 执行验收测试
                ↓
          PM 向用户汇报结果
```

### 内置 Skills

- **PM**: `requirement-clarification`、`prd-generation`、`system-discovery`
- **Architect**: `codebase-mapping`、`implementation-planning`、`architecture-review`
- **QA**: `test-plan-design`、`acceptance-testing`、`bug-reporting`

### 部署

```bash
# 复制团队配置
mkdir -p ~/.opencode/agents/dev-team
cp examples/dev-team/team.json ~/.opencode/agents/dev-team/

# 复制角色提示词
cp examples/dev-team/{pm,architect,developer,qa}.md ~/.opencode/agents/dev-team/

# 安装 skills
cp -r examples/dev-team/skills/* ~/.opencode/skills/

# 启动
openteam start dev-team
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `openteam start [team]` | 启动团队（创建 tmux/zellij session + daemon） |
| `openteam start [team] -d` | 后台启动 |
| `openteam start [team] --dir <directory>` | 指定项目目录 |
| `openteam list` / `openteam ls` | 列出所有已配置团队及运行状态 |
| `openteam inspect <team>` | 查看运行状态与会话有效性 |
| `openteam inspect <team> --dir <directory>` | 指定项目目录 |
| `openteam stop <target>` | 停止团队（SIGTERM daemon） |

同一团队可在不同项目目录启动多个实例。当存在多个实例时，`inspect`、`stop` 需要 `--dir` 指定目标实例。

## 团队工具

| 工具 | 权限 | 说明 |
|------|------|------|
| `msg` | 全员可用（仅 leader 可广播） | 异步消息；目标离线会自动唤醒并建会话 |
| `command` | 仅 leader | `status` / `free` / `redirect` |
| `task` | create 仅 leader；done/list 全员 | 任务管理：创建、完成、查看。完成后自动通知下游 |

### `command` 行为说明

- `status`: 查看成员实例状态。
- `free`: 让成员实例下线；若该成员有多个实例，必须指定 `cwd` 或 `alias`。
- `redirect`: 清空目标成员当前实例后，在新目录创建实例。

## 运行时文件

团队配置和运行时数据分为两级：

```text
~/.opencode/agents/<team>/
├── team.json                          # 团队配置（团队级）
├── <agent>.md                         # agent 提示词（团队级）
└── <hash>/                            # 项目级状态目录（hash = projectDir 的 SHA-256 前 8 位）
    ├── .runtime.json                  # daemon/serve/mux 运行状态
    └── .active-sessions.json          # agent → [{ sessionId, cwd }] 会话映射
```

- `.runtime.json` 包含 `daemon.pid`、`serve.pid/port/host`、`mux.type/session` 等字段。
- `.active-sessions.json` 持久化 agent 的多实例会话映射。

## 注意事项

- 插件仅在 `OPENTEAM_TEAM` 环境变量存在时启用，始终通过 `openteam start` 启动。
- `stop` 向 daemon 发送 SIGTERM；daemon 负责停止 serve 和清理 runtime，CLI 会在 daemon 退出后兜底销毁 mux session。

## 调试与日志

```bash
# 启用日志
OPENTEAM_LOG=1 openteam start myteam

# 设置日志级别 (debug/info/warn/error)
OPENTEAM_LOG=1 OPENTEAM_LOG_LEVEL=debug openteam start myteam
```

- 日志文件：`~/.openteam/openteam.log`

## 上游依赖说明

代码通过 `@opencode-ai/plugin/tool` 子路径导入，绕过上游根入口在 Node ESM 下的扩展名问题。

## 更多文档

- 架构与模块边界：`docs/architecture.md`
- 开发与验证：`docs/development-guide.md`
- 示例团队：`examples/dev-team/readme.md`
- 历史设计记录：`docs/archive/`

## 许可证

MIT
