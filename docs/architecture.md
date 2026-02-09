# OpenTeam 架构文档

## 执行摘要

OpenTeam 是 OpenCode 的 Agent 团队协作插件，提供：
- **团队协作**: Leader-Member 模式，支持 agent 间通信
- **多实例支持**: 一个 agent 可在多个工作目录运行
- **运行态可视化**: `monitor` 分屏 + `dashboard` 仪表盘

> OpenTeam 只做协作编排；memory 能力不在本仓库内。

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 语言 | JavaScript | ES Modules |
| 运行时 | Node.js | v14+ |
| CLI 框架 | Commander.js | ^12.0.0 |
| 插件 SDK | @opencode-ai/plugin | ^1.1.35 |

## 架构模式

**插件架构 + CLI 工具**

```
┌─────────────────────────────────────────────────────────┐
│                     用户界面层                           │
├─────────────────────────────────────────────────────────┤
│  CLI (bin/openteam.js)    │    OpenCode Session         │
│  - start/stop/attach      │    - 通过插件加载           │
│  - monitor/status/list    │                             │
│  - dashboard              │                             │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                     插件层                               │
├─────────────────────────────────────────────────────────┤
│  src/plugin/tools.js      │    src/plugin/hooks.js      │
│  - msg/command 工具        │    - 团队上下文注入         │
│                           │    - [from boss] 标记       │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                     核心服务层                           │
├─────────────────────────────────────────────────────────┤
│  src/team/                │    src/utils/                │
│  - serve.js (团队服务)    │    - api.js (HTTP API)      │
│  - config.js (配置加载)   │    - agent.js (身份识别)     │
│                           │    - logger.js/settings.js  │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                   Dashboard 层                           │
├─────────────────────────────────────────────────────────┤
│  src/dashboard/           # 团队状态 TUI                │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                     数据层                               │
├─────────────────────────────────────────────────────────┤
│  ~/.opencode/agents/<team>/                             │
│  - team.json                                            │
│  - .runtime.json, .active-sessions.json                 │
└─────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. 团队系统 (src/team/)

Leader-Member 模式：

| 角色 | 能力 |
|------|------|
| Leader | `command` (管理) + `msg` (可广播) |
| Member | `msg` (点对点通信) |

**command 支持的 action**:
- `status` - 查看团队状态
- `free` - 让 agent 休息
- `redirect` - 切换工作目录

### 2. 插件系统 (src/plugin/)

**tools.js** - 工具定义：
1. msg (异步消息)
2. command (团队管理)

**hooks.js** - 两个 hook：
- `messagesTransform`: 给最近一条 user 文本消息添加 `[from boss]`
- `systemTransform`: 注入团队上下文 + 协作规则

## 数据架构

### 配置文件

```
~/.opencode/agents/<team>/
├── team.json                 # 团队配置
│   {
│     "name": "team1",
│     "leader": "pm",
│     "agents": ["pm", "architect", "developer"]
│   }
└── <agent>.md                # agent 提示词（含 frontmatter 配置）
```

### 运行时文件

```
.runtime.json             # 服务状态（团队级，含 monitor 信息）
.active-sessions.json     # 活跃会话映射（团队级）
```

`.active-sessions.json` 采用多实例结构：`agent -> [{ sessionId, cwd, alias? }]`，并兼容旧字符串格式。

## 消息格式

消息来源标记规则：

| 来源 | 格式 | 说明 |
|------|------|------|
| agent 间 | `[from <agent>]` | msg 工具自动添加 |
| 用户直接输入 | `[from boss]` | hook 只处理最近一条 user 文本消息 |

## 扩展点

1. **新增工具**: 修改 `src/plugin/tools.js`
2. **新增 command action**: 修改 `src/plugin/tools.js` 中 `command` 分支

## 相关文档

- [设计文档 (DESIGN.md)](./DESIGN.md) - 详细设计说明（中文）
- [源代码树分析](./source-tree-analysis.md) - 代码结构
- [开发指南](./development-guide.md) - 开发设置
