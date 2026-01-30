# OpenTeam 设计文档

OpenCode 的 Agent 团队协作插件，提供团队沟通和多实例管理能力。

> **注意**：记忆系统已拆分到独立插件 [openmemory](../../openmemory)。

## 核心概念

### Agent 为中心

- 每个 agent 有独立的提示词和角色定义
- agent 通过记忆知道项目位置，而非依赖工作目录
- 一个 agent 可以在多个目录同时运行多个实例

### 团队协作

- **Leader**：可用 `command` 管理团队，可用 `msg` 广播
- **成员**：可用 `msg` 与他人沟通

### 消息格式

所有消息都有 `[from xxx]` 前缀，用于识别来源：

| 来源 | 格式 | 说明 |
|------|------|------|
| agent 间通信 | `[from <agent>]` | msg 工具自动添加 |
| 老板直接输入 | `[from boss]` | hook 自动添加 |

**Boss 消息特殊处理**：

当 agent 收到 `[from boss]` 消息时，说明老板亲自介入，通常意味着工作方向有偏差或理解有误。agent 应认真理解并执行 boss 的指示。

## 插件结构

```
openteam/
├── bin/openteam.js          # CLI 工具
├── src/
│   ├── index.js             # 插件入口
│   ├── plugin/tools.js      # 2 个工具（msg/command）
│   ├── plugin/hooks.js      # system prompt 注入
│   └── team/                # 团队管理、多实例支持
└── docs/                    # 文档
```

## 工具清单

| 工具 | 作用 | 权限 |
|------|------|------|
| msg | 发消息（异步，像微信），自动唤醒离线 agent | 所有人（leader 可广播） |
| command | 管理指令 | 仅 leader |

**msg 自动唤醒**：
- 若目标 agent 不在线，自动创建 session 并唤醒
- 使用当前 agent 的 cwd 作为默认工作目录
- 自动添加 pane 到 monitor
- 然后发送消息

### command 支持的 action

| Action | 说明 | 参数 |
|--------|------|------|
| status | 查看团队状态 | who?（可选，查看单人） |
| free | 让 agent 休息 | who |
| redirect | 切换工作目录 | who, cwd |

## 数据结构

### 目录布局

```
~/.opencode/agents/<team>/
├── team.json                 # 团队配置
├── pm.md                     # agent 提示词
├── architect.md
├── developer.md
├── qa.md
├── .runtime.json             # serve 运行状态
└── .active-sessions.json     # 活跃会话映射
```

### team.json

```json
{
  "name": "team1",
  "leader": "pm",
  "agents": ["pm", "architect", "developer", "qa"]
}
```

### .active-sessions.json

```json
{
  "pm": [
    { "sessionId": "ses_xxx", "cwd": "/path/to/project" }
  ],
  "developer": [
    { "sessionId": "ses_yyy", "cwd": "/path/to/project-a" },
    { "sessionId": "ses_zzz", "cwd": "/path/to/project-b", "alias": "feature-x" }
  ]
}
```

## CLI 使用

### 基本命令

```bash
# 启动团队 serve
openteam start <team>         # 前台启动，进入 leader 会话
openteam start <team> -d      # 后台启动

# 附加到会话
openteam attach <team>                   # 附加到 leader
openteam attach <team> <agent>           # 附加到指定 agent
openteam attach <team> <agent> --watch   # 监视模式
openteam attach <team> <agent> --cwd /path  # 附加到特定目录的实例

# 监控所有 agent（2x2 分屏）
openteam monitor <team>       # 自动检测 zellij/tmux
openteam monitor <team> --zellij
openteam monitor <team> --tmux

# 管理
openteam list                 # 列出所有团队
openteam status <team>        # 查看团队状态
openteam stop <team>          # 停止团队
```

### Monitor 机制

`openteam monitor` 创建 2x2 分屏布局：

- 每 4 个 agent 一组，放在一个窗口（tmux）/ tab（zellij）
- 超过 4 个时自动创建多个窗口/tab
- 少于 4 个时，用最后一个 agent 填充剩余 pane
- 每个 pane 运行 `attach --watch` 监视对应 agent

**动态 pane 创建**：

当通过 `msg` 唤醒离线 agent 时：
- 自动在 monitor 中添加新 pane
- 每 4 个 pane 一个 tab，超过时创建新 tab
- 新 pane 使用 `--cwd` 参数指向正确的工作目录

监视模式工作流程：

1. 检查 `.active-sessions.json` 中是否有该 agent 的会话
2. 有 → 自动 attach 到会话
3. 无 → 显示"等待会话..."，每 2 秒检查一次
4. 会话结束或被 free → 清屏，回到等待状态

### free 断开机制

当 leader 执行 `command('free', who)` 时：

1. 从 `.active-sessions.json` 中移除该实例记录
2. watch 模式检测到变化，终止 attach 进程
3. 清屏，回到等待状态
4. 会话历史保留，不删除

## 与 openmemory 配合

openteam 专注团队协作，记忆系统由 openmemory 插件独立提供。两个插件可同时加载，互不干扰：

- openteam 的 `systemTransform` 注入团队上下文 + 协作规则（检测 `<collaboration-rules>` 防重复）
- openmemory 的 `systemTransform` 注入记忆内容（检测 `<memory>` 防重复）

启动时通过环境变量 `OPENMEMORY=1` 启用 openmemory 插件。

## 安装配置

### 1. 安装插件

```bash
npm install -g openteam
```

### 2. 配置 OpenCode

在 `~/.opencode/opencode.json` 中添加：

```json
{
  "plugin": ["openteam"]
}
```

### 3. 创建团队

创建 `~/.opencode/agents/<team>/team.json` 和各 agent 的 `.md` 提示词文件。
