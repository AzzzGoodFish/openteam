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
- 通过消息相互协作
- 由 Leader 统一管理任务分配
- 在多个工作目录同时运行

> 本仓库不包含 memory 实现；如需记忆能力请接入 `openmemory`。

## 核心特性

### 👥 团队协作

- Leader-Member 模式
- `msg` - 异步消息（像微信）
- `command` - Leader 管理指令

### 🔄 多实例支持

一个 Agent 可在多个工作目录同时运行。

### 📺 Monitor 分屏

2x2 分屏布局监控所有 agent，支持 tmux/zellij。

### 📊 Dashboard

内置实时仪表盘命令 `openteam dashboard <team>`，默认每 3 秒刷新。

## 技术栈

| 技术 | 用途 |
|------|------|
| Node.js (ES Modules) | 运行时 |
| Commander.js | CLI 框架 |
| @opencode-ai/plugin | 插件 SDK |

## 快速开始

```bash
# 配置 OpenCode 插件
# 在 ~/.opencode/opencode.json 添加：
# { "plugin": ["openteam"] }

# 创建团队配置
mkdir -p ~/.opencode/agents/myteam
# 创建 team.json 和 agent .md 文件...

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
| [DESIGN.md](./DESIGN.md) | 详细设计（中文） |
| [architecture.md](./architecture.md) | 架构文档 |
| [source-tree-analysis.md](./source-tree-analysis.md) | 代码结构 |
| [development-guide.md](./development-guide.md) | 开发指南 |
