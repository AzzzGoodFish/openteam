# OpenTeam 文档索引

> Agent-centric team collaboration for OpenCode

## 项目概览

| 属性 | 值 |
|------|-----|
| **类型** | CLI 工具 + OpenCode 插件 |
| **语言** | JavaScript (ES Modules) |
| **架构** | 插件架构 + CLI 工具 |
| **入口点** | `bin/openteam.js` (CLI), `src/index.js` (Library) |

> 记忆系统已拆分到独立插件 [openmemory](../../openmemory)。

## 快速参考

| 技术 | 版本 |
|------|------|
| Node.js | ES Modules (v14+) |
| Commander.js | ^12.0.0 |
| @opencode-ai/plugin | ^1.1.35 |

## 文档

| 文档 | 说明 |
|------|------|
| [项目概览](./project-overview.md) | 项目基本信息和特性概述 |
| [架构文档](./architecture.md) | 系统架构、组件、数据流 |
| [源代码树分析](./source-tree-analysis.md) | 代码结构和模块说明 |
| [开发指南](./development-guide.md) | 环境配置、开发命令 |
| [设计文档 (DESIGN.md)](./DESIGN.md) | 详细设计说明（中文） |

### 设计规划

| 文档 | 说明 |
|------|------|
| [Multi-Worktree Support](./plans/2025-01-26-multi-worktree-support.md) | 多工作树支持规划 |
| [Team Communication](./plans/2025-01-26-team-communication.md) | 团队通信规划 |

## 快速开始

### 1. 配置 OpenCode

在 `~/.opencode/opencode.json` 中添加：

```json
{
  "plugin": ["openteam"]
}
```

### 2. 创建团队

```bash
mkdir -p ~/.opencode/agents/myteam
# 创建 team.json 和 agent .md 文件
```

### 3. 启动

```bash
openteam start myteam
```

## 核心功能模块

| 模块 | 路径 | 职责 |
|------|------|------|
| 插件 | `src/plugin/` | tools.js (msg/command), hooks.js |
| 团队 | `src/team/` | config.js, serve.js |
| 工具 | `src/utils/` | api.js, logger.js |

## 项目状态

| 方面 | 状态 |
|------|------|
| 测试 | ⚠️ 无测试 |
| CI/CD | ⚠️ 无配置 |
| 文档 | ✅ 完善 |
