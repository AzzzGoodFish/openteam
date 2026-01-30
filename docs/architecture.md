# OpenTeam 架构文档

## 执行摘要

OpenTeam 是 OpenCode 的 Agent 团队协作插件，提供：
- **记忆系统**: 三层记忆架构 (resident/index/sessions)
- **团队协作**: Leader-Member 模式，支持 agent 间通信
- **多实例支持**: 一个 agent 可在多个工作目录运行

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
│  - monitor/status         │                             │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                     插件层                               │
├─────────────────────────────────────────────────────────┤
│  src/plugin/tools.js      │    src/plugin/hooks.js      │
│  - 11 个工具              │    - system prompt 注入     │
│  - remember/tell/command  │    - 记忆内容注入          │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                     核心服务层                           │
├─────────────────────────────────────────────────────────┤
│  src/memory/              │    src/team/                │
│  - memory.js (记忆读写)   │    - serve.js (团队服务)   │
│  - sessions.js (会话)     │    - config.js (配置加载)  │
└─────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────┐
│                     数据层                               │
├─────────────────────────────────────────────────────────┤
│  ~/.opencode/agents/<team>/                             │
│  - team.json, agent.json                                │
│  - .runtime.json, .active-sessions.json                 │
│  - memories/*.mem                                       │
└─────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. 记忆系统 (src/memory/)

三层记忆架构：

| 层级 | 类型 | 特点 | 始终在 Context |
|------|------|------|----------------|
| L1 | resident | 常驻记忆，有大小限制 | ✅ |
| L2 | index | 索引常驻，详情按需加载 | 索引 ✅ |
| L3 | sessions | 会话历史索引 | 索引 ✅ |

**记忆工具**:
- `remember` - 追加内容
- `correct` - 替换部分内容
- `rethink` - 重写整块
- `note/lookup/erase/search` - 笔记管理
- `review/reread` - 会话历史

### 2. 团队系统 (src/team/)

Leader-Member 模式：

| 角色 | 能力 |
|------|------|
| Leader | `command` (管理) + `tell` (可广播) |
| Member | `tell` (点对点通信) |

**command 支持的 action**:
- `status` - 查看团队状态
- `assign` - 分配任务（可创建新实例）
- `free` - 让 agent 休息
- `redirect` - 切换工作目录

### 3. 插件系统 (src/plugin/)

**tools.js** - 定义 11 个工具：
1. remember, correct, rethink (常驻记忆)
2. note, lookup, erase, search (笔记)
3. review, reread (会话)
4. tell, command (团队)

**hooks.js** - 注入 system prompt：
- 将记忆内容注入到 agent context
- 自动标记 `[from boss]` 消息

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
│
└── <agent>/agent.json        # Agent 配置
    {
      "name": "pm",
      "memories": [
        { "name": "persona", "type": "resident", "limit": 1000 },
        { "name": "projects", "type": "index", "limit": 1500 }
      ]
    }
```

### 运行时文件

```
.runtime.json             # 服务状态
.active-sessions.json     # 活跃会话映射
sessions.json             # 会话历史
memories/*.mem            # 记忆文件
```

## 消息格式

所有消息都有 `[from xxx]` 前缀：

| 来源 | 格式 | 说明 |
|------|------|------|
| agent 间 | `[from pm]` | tell 工具自动添加 |
| 用户直接输入 | `[from boss]` | hook 自动添加 |

## 扩展点

1. **新增记忆类型**: 修改 `src/memory/memory.js`
2. **新增工具**: 修改 `src/plugin/tools.js`
3. **新增 command action**: 修改 `src/team/serve.js`

## 相关文档

- [设计文档 (DESIGN.md)](./DESIGN.md) - 详细设计说明（中文）
- [源代码树分析](./source-tree-analysis.md) - 代码结构
- [开发指南](./development-guide.md) - 开发设置
