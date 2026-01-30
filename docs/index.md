# OpenTeam 文档索引

> Agent-centric team collaboration for OpenCode

## 项目概览

| 属性 | 值 |
|------|-----|
| **类型** | Monolith (CLI 工具 + OpenCode 插件) |
| **语言** | JavaScript (ES Modules) |
| **架构** | 插件架构 + CLI 工具 |
| **入口点** | `bin/openteam.js` (CLI), `src/index.js` (Library) |

## 快速参考

| 技术 | 版本 |
|------|------|
| Node.js | ES Modules (v14+) |
| Commander.js | ^12.0.0 |
| @opencode-ai/plugin | ^1.1.35 |

## 生成的文档

| 文档 | 说明 |
|------|------|
| [项目概览](./project-overview.md) | 项目基本信息和特性概述 |
| [架构文档](./architecture.md) | 系统架构、组件、数据流 |
| [源代码树分析](./source-tree-analysis.md) | 代码结构和模块说明 |
| [开发指南](./development-guide.md) | 环境配置、开发命令 |

## 现有文档

| 文档 | 说明 |
|------|------|
| [README](../README.md) | 项目说明、安装配置、CLI 用法 |
| [设计文档 (DESIGN.md)](./DESIGN.md) | 详细设计说明（中文） |

### 设计规划

| 文档 | 说明 |
|------|------|
| [Memory System V2](./plans/2025-01-26-memory-system-v2.md) | 记忆系统 V2 规划 |
| [Multi-Worktree Support](./plans/2025-01-26-multi-worktree-support.md) | 多工作树支持规划 |
| [Team Communication](./plans/2025-01-26-team-communication.md) | 团队通信规划 |

### 配置示例

| 文档 | 说明 |
|------|------|
| [agent.json 示例](./examples/agent.json) | Agent 配置示例 |

## 快速开始

### 1. 安装

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

```bash
mkdir -p ~/.opencode/agents/myteam
# 创建 team.json 和 agent 配置文件
```

### 4. 启动

```bash
openteam start myteam
```

## 核心功能模块

| 模块 | 路径 | 职责 |
|------|------|------|
| 插件 | `src/plugin/` | tools.js, hooks.js |
| 记忆 | `src/memory/` | memory.js, sessions.js |
| 团队 | `src/team/` | config.js, serve.js |
| 工具 | `src/utils/` | api.js |

## 项目状态

| 方面 | 状态 |
|------|------|
| 测试 | ⚠️ 无测试 |
| CI/CD | ⚠️ 无配置 |
| 文档 | ✅ 完善 |

---

*文档生成于 2026-01-26 | 扫描级别: Quick Scan*
