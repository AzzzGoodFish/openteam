# OpenTeam

面向 Agent 的团队协作框架，为 OpenCode 设计。

## 功能特性

- **团队协作**：PM 可以唤起其他 agent，保持对话上下文
- **记忆系统**：层次化记忆，支持常驻块和索引笔记
- **会话历史**：追踪和回顾历史对话
- **团队管理**：启动、停止、监控团队服务

## 安装

```bash
npm install -g openteam
```

## 配置

### 1. 配置 OpenCode 插件

添加到 `~/.opencode/opencode.json`：

```json
{
  "plugin": ["openteam"]
}
```

### 2. 创建团队配置

创建 `~/.opencode/agents/<team-name>/team.json`：

```json
{
  "name": "myteam",
  "leader": "pm",
  "host": "127.0.0.1",
  "port": 0,
  "agents": ["pm", "architect", "developer", "qa"]
}
```

### 3. 创建 Agent 提示词

在 `~/.opencode/agents/<team-name>/` 目录下创建 agent 提示词文件：

- `pm.md` - 产品经理
- `architect.md` - 架构师
- `developer.md` - 开发者
- `qa.md` - 测试工程师

### 4. 配置 Agent 记忆

创建 `~/.opencode/agents/<team>/<agent>/agent.json`：

```json
{
  "name": "pm",
  "memories": [
    { "name": "persona", "type": "resident", "limit": 1000, "readonly": true },
    { "name": "human", "type": "resident", "limit": 800 },
    { "name": "projects", "type": "index", "limit": 1500 },
    { "name": "sessions", "type": "sessions", "limit": 2000 }
  ]
}
```

## 命令行用法

```bash
# 启动团队服务
openteam start myteam

# 后台启动
openteam start myteam -d

# 连接到 leader 会话
openteam attach myteam

# 连接到指定 agent
openteam attach myteam architect

# 通过工作目录连接到指定实例
openteam attach myteam developer --cwd /path/to/project

# 分屏监控所有 agent（2x2 网格）
openteam monitor myteam           # 自动检测 zellij/tmux
openteam monitor myteam --zellij  # 强制使用 zellij
openteam monitor myteam --tmux    # 强制使用 tmux

# 列出所有团队
openteam list

# 显示团队状态
openteam status myteam

# 停止团队
openteam stop myteam
```

## 记忆系统

### 记忆类型

| 类型 | 描述 | 始终在上下文中 |
|------|------|----------------|
| `resident` | 核心记忆，始终可见 | 是 |
| `index` | 索引可见，按需加载详情 | 仅索引 |
| `sessions` | 会话历史索引 | 仅索引 |

### 记忆工具

| 工具 | 描述 |
|------|------|
| `remember` | 追加到常驻记忆 |
| `correct` | 替换记忆中的部分内容 |
| `rethink` | 重写整个记忆块 |
| `note` | 保存笔记（自动更新索引） |
| `lookup` | 读取笔记内容 |
| `erase` | 删除笔记 |
| `search` | 搜索笔记 |
| `review` | 搜索会话历史 |
| `reread` | 读取完整会话内容 |

### 团队工具

| 工具 | 描述 |
|------|------|
| `msg` | 发消息（异步，像微信）。自动唤醒离线 agent。Leader 可广播 |
| `command` | 仅限 Leader：status、free、redirect |

### 消息格式

所有消息都带有 `[from xxx]` 前缀用于标识来源：

- `[from <agent>]` - 来自其他 agent（通过 msg）
- `[from boss]` - 来自用户直接输入（由 hook 自动标记）

#### command 操作

| 操作 | 描述 |
|------|------|
| `status` | 查看团队状态 |
| `free` | 让 agent 休息（断开连接） |
| `redirect` | 切换 agent 的工作目录 |

## 数据结构

```
~/.opencode/agents/<team>/
├── team.json                 # 团队配置
├── pm.md                     # Agent 提示词
├── architect.md
├── .runtime.json             # 服务运行时状态
├── .active-sessions.json     # 活跃会话映射
│
└── <agent>/                  # Agent 数据
    ├── agent.json            # 记忆配置
    ├── sessions.json         # 会话历史
    └── memories/             # 记忆存储
        ├── persona.mem       # 常驻记忆
        ├── human.mem
        ├── projects.mem      # 索引
        └── projects/         # 笔记详情
            └── jarvy.mem
```

## 许可证

MIT
