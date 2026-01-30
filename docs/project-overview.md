# OpenTeam 项目概览

## 基本信息

| 属性 | 值 |
|------|-----|
| **名称** | openteam |
| **版本** | 0.1.0 |
| **描述** | Agent-centric team collaboration for OpenCode |
| **许可证** | MIT |
| **类型** | CLI 工具 + OpenCode 插件 |

## 项目定位

OpenTeam 是 OpenCode 的 Agent 团队协作插件，让多个 AI Agent 能够：
- 拥有独立的记忆空间
- 通过消息相互协作
- 由 Leader 统一管理任务分配

## 核心特性

### 🧠 记忆系统

三层记忆架构：
- **Resident**: 常驻 context，始终可见
- **Index**: 索引常驻，详情按需加载
- **Sessions**: 会话历史，可搜索回顾

### 👥 团队协作

- Leader-Member 模式
- `msg` - 异步消息（像微信）
- `command` - Leader 管理指令

### 🔄 多实例支持

一个 Agent 可在多个工作目录同时运行。

## 技术栈

| 技术 | 用途 |
|------|------|
| Node.js (ES Modules) | 运行时 |
| Commander.js | CLI 框架 |
| @opencode-ai/plugin | 插件 SDK |

## 快速开始

```bash
# 安装
npm install -g openteam

# 配置 OpenCode 插件
# 在 ~/.opencode/opencode.json 添加：
# { "plugin": ["openteam"] }

# 创建团队配置
mkdir -p ~/.opencode/agents/myteam
# 创建 team.json 和 agent 配置...

# 启动团队
openteam start myteam
```

## 项目状态

| 方面 | 状态 |
|------|------|
| 测试 | ⚠️ 无测试 |
| CI/CD | ⚠️ 无配置 |
| 文档 | ✅ 完善 |

## 文档导航

| 文档 | 说明 |
|------|------|
| [README](../README.md) | 使用说明 |
| [DESIGN.md](./DESIGN.md) | 详细设计（中文） |
| [architecture.md](./architecture.md) | 架构文档 |
| [source-tree-analysis.md](./source-tree-analysis.md) | 代码结构 |
| [development-guide.md](./development-guide.md) | 开发指南 |

## 规划中的功能

参见 `docs/plans/` 目录：
- Memory System V2
- Multi-Worktree Support
- Team Communication 增强
