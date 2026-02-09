# OpenTeam 源代码树分析

> OpenTeam 仅负责团队协作与会话编排。

## 项目结构概览

```text
openteam/
├── bin/
│   └── openteam.js               # CLI 主入口
│
├── src/
│   ├── index.js                  # 插件入口（按 OPENTEAM_TEAM 条件加载）
│   ├── constants.js              # 路径与默认端口常量
│   │
│   ├── plugin/
│   │   ├── hooks.js              # messages/system transform
│   │   └── tools.js              # msg / command
│   │
│   ├── team/
│   │   ├── config.js             # team.json 读取与校验
│   │   └── serve.js              # runtime/session/monitor 管理
│   │
│   ├── dashboard/
│   │   ├── index.js              # 仪表盘启动与刷新调度
│   │   ├── data.js               # 状态数据采集
│   │   └── ui.js                 # 终端 UI 渲染
│   │
│   └── utils/
│       ├── api.js                # OpenCode Serve API 封装
│       ├── agent.js              # 当前 agent 身份识别
│       ├── logger.js             # 日志
│       └── settings.js           # 全局设置
│
├── docs/
│   ├── DESIGN.md
│   └── plans/
│
├── package.json
└── README.md
```

## 关键模块

### CLI 入口

- `bin/openteam.js`: 实现 `start/attach/monitor/list/status/stop/dashboard` 命令。

### 插件层

- `src/plugin/hooks.js`: 注入团队上下文与协作规则，为用户消息打 `[from boss]` 标签。
- `src/plugin/tools.js`: 暴露 `msg` 与 `command`，包含 leader 权限与多实例控制逻辑。

### 运行时层

- `src/team/serve.js`: 维护 `.runtime.json` 与 `.active-sessions.json`，处理 monitor 信息。
- `src/utils/agent.js`: 通过会话最后消息的 `info.agent` 推断当前 agent 身份。

### 可视化层

- `src/dashboard/`: 提供实时状态仪表盘，默认 3 秒刷新。

## 运行时数据

运行时数据位于 `~/.opencode/agents/<team>/`：

```text
team.json
<agent>.md
.runtime.json
.active-sessions.json
```

- `.runtime.json`: 团队 serve 运行信息，monitor 模式下包含 `monitor` 字段。
- `.active-sessions.json`: 多实例会话映射，结构为 `agent -> [{ sessionId, cwd, alias? }]`。
