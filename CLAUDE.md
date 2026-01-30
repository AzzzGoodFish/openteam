# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenTeam 是一个面向 Agent 的团队协作框架，作为 OpenCode 插件运行。它实现了：
- 多 Agent 协作（Leader 管理 + 成员间异步通信）
- 三层记忆系统（resident/index/sessions）
- 多实例支持（同一 agent 可在不同目录运行多个实例）

## Commands

```bash
# 安装依赖
npm install

# 运行 CLI（开发时）
node bin/openteam.js <command>

# 或全局安装后
npm link
openteam <command>
```

**没有测试框架** - `npm test` 只是占位符。

## Architecture

```
bin/openteam.js          # CLI 入口 - 处理 start/attach/monitor/list/status/stop
src/
├── index.js             # 插件入口 - 导出 hooks + tools
├── constants.js         # 配置常量
├── plugin/
│   ├── hooks.js         # 两个核心 hook：
│   │                    #   - messagesTransform: 给无来源消息添加 [from boss]
│   │                    #   - systemTransform: 注入记忆和团队上下文到 system prompt
│   └── tools.js         # 11 个工具实现（记忆 + 团队通信）
├── memory/
│   ├── memory.js        # 三层记忆读写
│   └── sessions.js      # 会话历史管理
├── team/
│   ├── config.js        # 团队/agent 配置加载 + validateTeamConfig 校验
│   └── serve.js         # 运行时管理、多实例跟踪
└── utils/
    └── api.js           # OpenCode Serve HTTP API 封装
```

### Key Patterns

1. **Agent 为中心** - 记忆和身份以 agent 为核心，不依赖工作目录
2. **消息标记** - 所有消息带 `[from xxx]` 前缀标识来源
3. **HTTP 轮询** - 通过 OpenCode Serve API 轮询会话状态（非 WebSocket）
4. **终端复用** - monitor 使用 tmux/zellij 实现多 agent 分屏

### Data Flow

```
用户输入 → messagesTransform hook (添加 [from boss])
       → agent 处理
       → 使用 tools (记忆/通信)
       → systemTransform hook 在每轮注入最新记忆
```

### Runtime Files (团队目录下)

- `.runtime.json` - serve 进程信息（PID、端口）
- `.active-sessions.json` - agent → [{sessionId, cwd}] 映射

## Code Style

- **ES Modules** - 使用 `import/export`，不用 CommonJS
- **纯 JavaScript** - 无 TypeScript
- 代码注释使用中文

## Important Behaviors

- `msg` 工具会自动唤醒离线 agent 并添加 monitor pane
- `command` 仅 leader 可用，支持 actions：status/free/redirect
- 启动时会校验 leader 必须在 agents 列表中
- 消息轮询间隔 500ms（在 `src/utils/api.js` 中）
