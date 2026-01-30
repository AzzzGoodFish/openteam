# OpenTeam 设计文档

OpenCode 的 Agent 团队协作插件，提供记忆系统、团队沟通和多实例管理能力。

## 核心概念

### Agent 为中心

- 每个 agent 有独立的记忆空间
- agent 通过记忆知道项目位置，而非依赖工作目录
- 一个 agent 可以在多个目录同时运行多个实例

### 三层记忆

| 层级 | 类型 | 特点 |
|------|------|------|
| L1 | resident | 常驻 context，有大小限制 |
| L2 | index | 索引常驻，详情按需加载 |
| L3 | sessions | 会话历史索引 |

### 团队协作

- **Leader**（如 PM）：可用 `command` 管理团队，可用 `tell` 广播
- **成员**（如 developer）：可用 `tell` 与他人沟通

## 插件结构

```
openteam/
├── bin/openteam.js          # CLI 工具
├── src/
│   ├── index.js             # 插件入口
│   ├── plugin/tools.js      # 11 个工具
│   ├── plugin/hooks.js      # system prompt 注入
│   ├── memory/              # 记忆系统
│   └── team/                # 团队管理、多实例支持
└── docs/plans/              # 设计文档
```

## 工具清单

### 常驻记忆工具

| 工具 | 作用 | 参数 |
|------|------|------|
| remember | 追加内容到记忆 | memory, content |
| correct | 替换记忆中的部分内容 | memory, old_text, new_text |
| rethink | 重写整个记忆块 | memory, content |

### 笔记工具

| 工具 | 作用 | 参数 |
|------|------|------|
| note | 记笔记，自动更新索引 | index, key, content, summary? |
| lookup | 查阅笔记详情 | index, key |
| erase | 删除笔记 | index, key |
| search | 搜索笔记 | index, query |

### 会话工具

| 工具 | 作用 | 参数 |
|------|------|------|
| review | 搜索历史会话 | query |
| reread | 读取会话详情 | session_id |

### 团队工具

| 工具 | 作用 | 权限 |
|------|------|------|
| tell | 异步通知，不等回复 | 所有人（leader 可广播） |
| command | 管理指令，同步等结果 | 仅 leader |

#### command 支持的 action

| Action | 说明 | 参数 |
|--------|------|------|
| status | 查看团队状态 | who?（可选，查看单人） |
| assign | 分配任务 | who, message |
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
├── .active-sessions.json     # 活跃会话映射
│
└── <agent>/                  # agent 数据目录
    ├── agent.json            # 记忆配置
    ├── sessions.json         # 会话历史
    └── memories/             # 记忆存储
        ├── persona.mem       # 常驻记忆
        ├── human.mem
        ├── projects.mem      # 索引
        └── projects/         # 笔记详情
            └── jarvy.mem
```

### team.json

```json
{
  "name": "team1",
  "leader": "pm",
  "agents": ["pm", "architect", "developer", "qa"]
}
```

### agent.json

```json
{
  "name": "pm",
  "team": "team1",
  "memories": [
    { "name": "persona", "type": "resident", "limit": 1000, "readonly": true },
    { "name": "human", "type": "resident", "limit": 800 },
    { "name": "projects", "type": "index", "limit": 1500 },
    { "name": "sessions", "type": "sessions", "limit": 2000 }
  ]
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

创建 `~/.opencode/agents/<team>/team.json` 和各 agent 的配置文件。

参考 `docs/examples/` 目录下的示例配置。
