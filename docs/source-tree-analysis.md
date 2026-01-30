# OpenTeam 源代码树分析

## 项目结构概览

```
openteam/
├── bin/                          # CLI 入口
│   └── openteam.js               # ★ CLI 主入口
│
├── src/                          # 源代码
│   ├── index.js                  # ★ 库入口，导出 plugin tools/hooks
│   ├── constants.js              # 常量定义
│   │
│   ├── plugin/                   # OpenCode 插件系统
│   │   ├── tools.js              # 11 个工具定义 (remember, tell, command 等)
│   │   └── hooks.js              # system prompt 注入 hook
│   │
│   ├── memory/                   # 记忆系统
│   │   ├── memory.js             # 记忆读写、resident/index/sessions 处理
│   │   └── sessions.js           # 会话历史管理
│   │
│   ├── team/                     # 团队管理
│   │   ├── config.js             # 团队配置加载
│   │   └── serve.js              # 团队服务、多实例管理
│   │
│   └── utils/                    # 工具函数
│       └── api.js                # HTTP API 工具
│
├── scripts/                      # 脚本
│   └── migrate.js                # 迁移脚本
│
├── docs/                         # 文档
│   ├── DESIGN.md                 # 设计文档（中文）
│   ├── examples/                 # 配置示例
│   │   └── agent.json
│   └── plans/                    # 设计规划
│       ├── 2025-01-26-memory-system-v2.md
│       ├── 2025-01-26-multi-worktree-support.md
│       └── 2025-01-26-team-communication.md
│
├── package.json                  # 项目配置
├── package-lock.json             # 依赖锁定
└── README.md                     # 项目说明
```

## 关键文件说明

### 入口点

| 入口 | 文件 | 用途 |
|------|------|------|
| CLI | `bin/openteam.js` | 命令行工具入口 |
| Library | `src/index.js` | 作为 OpenCode 插件导入 |

### 核心模块

#### plugin/ - 插件核心

| 文件 | 职责 |
|------|------|
| `tools.js` | 定义 11 个工具：remember, correct, rethink, note, lookup, erase, search, review, reread, tell, command |
| `hooks.js` | system prompt 注入 hook，将记忆内容注入到 agent context |

#### memory/ - 记忆系统

| 文件 | 职责 |
|------|------|
| `memory.js` | 记忆读写操作，支持 resident/index/sessions 三种类型 |
| `sessions.js` | 会话历史管理，搜索和读取历史会话 |

#### team/ - 团队管理

| 文件 | 职责 |
|------|------|
| `config.js` | 加载团队配置 (team.json, agent.json) |
| `serve.js` | 团队服务管理，多实例支持，agent 间通信 |

### 数据流

```
用户 CLI 命令
     │
     ▼
bin/openteam.js (Commander.js 解析)
     │
     ▼
src/team/serve.js (启动/停止/监控团队)
     │
     ├─▶ src/team/config.js (加载配置)
     │
     └─▶ OpenCode Session
           │
           ▼
     src/index.js (插件入口)
           │
           ├─▶ src/plugin/tools.js (注册工具)
           │
           └─▶ src/plugin/hooks.js (注入记忆)
                 │
                 ▼
           src/memory/memory.js (读写记忆)
```

## 运行时数据

运行时数据存储在 `~/.opencode/agents/<team>/`:

```
~/.opencode/agents/<team>/
├── team.json                 # 团队配置
├── <agent>.md                # agent 提示词
├── .runtime.json             # 服务运行状态
├── .active-sessions.json     # 活跃会话映射
│
└── <agent>/                  # agent 数据目录
    ├── agent.json            # 记忆配置
    ├── sessions.json         # 会话历史
    └── memories/             # 记忆存储
        ├── persona.mem       # 常驻记忆
        └── projects/         # 笔记详情
```
