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
  "agents": ["pm", "architect", "developer", "qa"],
  "extractor": {
    "model": {
      "providerID": "anthropic",
      "modelID": "claude-3-haiku-20240307"
    }
  }
}
```

**extractor 配置（可选）**：
- `model`: 记忆提取使用的模型，建议配置轻量模型节省成本
- `consolidation`: 巩固触发阈值
  - `sessionThreshold`: 待巩固 session 数量阈值（默认 5）
  - `timeThreshold`: 距上次巩固的时间阈值（默认 `"24h"`）
- `distillation`: 蒸馏触发阈值
  - `timeThreshold`: 距上次蒸馏的时间阈值（默认 `"7d"`）
  - `entryThreshold`: index 记忆条目数阈值（默认 20）
- 不配置时会自动检测可用的小模型（haiku/flash/mini 等）

完整示例：

```json
{
  "extractor": {
    "model": {
      "providerID": "anthropic",
      "modelID": "claude-3-haiku-20240307"
    },
    "consolidation": {
      "sessionThreshold": 5,
      "timeThreshold": "24h"
    },
    "distillation": {
      "timeThreshold": "7d",
      "entryThreshold": 20
    }
  }
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

# 手动触发记忆蒸馏
openteam distill myteam           # 蒸馏所有 agent
openteam distill myteam pm        # 只蒸馏指定 agent
```

## 记忆系统

### 自动记忆功能

OpenTeam 的记忆系统完全自动化，Agent 不需要主动操作记忆工具来记录信息：

**自动注入**：每轮对话自动注入 resident 全量记忆 + index 索引摘要（包含所有笔记的丰富摘要，100-150 字），Agent 通过摘要判断是否需要用 `recall` 查阅详情。

**自动维护**：记忆通过三阶段生命周期自动维护，只管理 index 类型记忆：

1. **积累（Accumulate）**：session.idle 时只将该 session 标记为"待巩固素材"，不调用 LLM，零成本
2. **巩固（Consolidate）**：待巩固 session 达阈值（默认 5 个或 24 小时）后批量处理，对 index 记忆做增删改操作
3. **蒸馏（Distill）**：定期（默认 7 天或 20 条记忆）对全量记忆库做全局整理。不会因"与当前工作无关"而删除笔记

**模型选择**：
1. 优先使用 `team.json` 中配置的 `extractor.model`
2. 未配置时使用 agent 主模型
3. 均未配置时使用 opencode 默认模型

### 记忆类型

| 类型 | 描述 | 始终在上下文中 |
|------|------|----------------|
| `resident` | 核心记忆，始终可见 | 是（全文） |
| `index` | 索引+丰富摘要始终可见，详情按需查阅 | 摘要可见 |
| `sessions` | 会话历史索引 | 仅索引 |

### 记忆工具（只读）

记忆的写入由自动巩固/蒸馏负责，Agent 只需要读取工具：

| 工具 | 描述 |
|------|------|
| `recall` | 查阅笔记详情（跨所有索引搜索，返回完整内容） |
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
    ├── .memory-state.json    # 记忆生命周期状态（待巩固列表、上次巩固/蒸馏时间）
    ├── sessions.json         # 会话历史
    └── memories/             # 记忆存储
        ├── persona.mem       # 常驻记忆
        ├── human.mem
        ├── projects.mem      # 索引
        └── projects/         # 笔记详情
            └── jarvy.mem
```

## 调试与日志

通过环境变量启用日志：

```bash
# 启用日志
OPENTEAM_LOG=1 openteam start myteam

# 设置日志级别 (debug/info/warn/error，默认 info)
OPENTEAM_LOG=1 OPENTEAM_LOG_LEVEL=debug openteam start myteam
```

日志文件位置：`~/.openteam/openteam.log`

查看日志：
```bash
tail -f ~/.openteam/openteam.log
```

## 许可证

MIT
