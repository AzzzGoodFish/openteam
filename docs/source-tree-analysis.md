# OpenTeam 源代码树分析

> **注意**：记忆系统已拆分到独立插件 [openmemory](../../openmemory)。

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
│   │   ├── tools.js              # 2 个工具：msg, command
│   │   └── hooks.js              # messagesTransform + systemTransform
│   │
│   ├── team/                     # 团队管理
│   │   ├── config.js             # 团队配置加载
│   │   └── serve.js              # 团队服务、多实例管理
│   │
│   └── utils/                    # 工具函数
│       ├── api.js                # HTTP API 工具
│       └── logger.js             # 日志系统
│
├── docs/                         # 文档
│   ├── DESIGN.md                 # 设计文档（中文）
│   ├── examples/                 # 配置示例
│   └── plans/                    # 设计规划
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
| `tools.js` | 定义 2 个工具：msg（异步消息）、command（团队管理） |
| `hooks.js` | messagesTransform（添加 [from boss]）+ systemTransform（注入团队上下文和协作规则） |

#### team/ - 团队管理

| 文件 | 职责 |
|------|------|
| `config.js` | 加载团队配置 (team.json)，校验 leader 在 agents 列表中 |
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
           ├─▶ src/plugin/tools.js (注册 msg/command)
           │
           └─▶ src/plugin/hooks.js (注入团队上下文)
```

## 运行时数据

运行时数据存储在 `~/.opencode/agents/<team>/`:

```
~/.opencode/agents/<team>/
├── team.json                 # 团队配置
├── <agent>.md                # agent 提示词
├── .runtime.json             # 服务运行状态
└── .active-sessions.json     # 活跃会话映射
```
