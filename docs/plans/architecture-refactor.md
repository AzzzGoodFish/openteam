# OpenTeam 架构重构 — 模块规格文档

## 1. 目标

将当前平铺的项目结构重组为三层架构：

```
Interfaces → Capabilities → Foundation
```

**原则：**
- 依赖单向向下，禁止反向或跨层依赖
- Capabilities 层内允许单向依赖（messaging → lifecycle），Foundation 层模块互不依赖
- 每个模块的导出方法即为其完整 API

## 2. 新项目结构

```
bin/
└── openteam.js                     CLI 入口（Commander 定义 + 路由，~50 行）

src/
├── index.js                        Plugin 入口

├── interfaces/                     ── 接口层：谁在调用 ──
│   ├── cli.js                      CLI 命令实现（人 → 文本命令行）
│   ├── dashboard/                  Dashboard TUI（人 → 图形面板）
│   │   ├── index.js                刷新循环编排
│   │   ├── ui.js                   blessed UI 组件
│   │   └── data.js                 数据获取
│   └── plugin/                     Plugin 集成（Agent → 运行面）
│       ├── hooks.js                消息标记 + 系统注入 hook
│       └── tools.js                msg + command 工具定义

├── capabilities/                   ── 能力层：做什么 ──
│   ├── lifecycle.js                Agent 生命周期管理
│   ├── messaging.js                通信 + 团队上下文
│   └── monitor.js                  终端监控编排

├── foundation/                     ── 基础层：基础设施 ──
│   ├── constants.js                路径、文件名、默认值常量
│   ├── config.js                   团队配置读取与校验
│   ├── state.js                    运行时状态持久化
│   ├── opencode.js                 OpenCode Serve HTTP API
│   ├── terminal.js                 终端复用器（tmux/zellij）抽象
│   ├── logger.js                   日志系统
│   └── settings.js                 全局设置
```

## 3. 依赖关系

```
interfaces/cli              ──→ capabilities/lifecycle, monitor
                            ──→ foundation/config, state, opencode

interfaces/dashboard/*     ──→ foundation/state, config, opencode

interfaces/plugin/hooks    ──→ capabilities/messaging

interfaces/plugin/tools    ──→ capabilities/lifecycle, messaging

capabilities/lifecycle     ──→ foundation/opencode, state, config

capabilities/messaging     ──→ capabilities/lifecycle
                           ──→ foundation/opencode, state, config, terminal

capabilities/monitor       ──→ foundation/terminal, state, config
```

禁止出现的依赖方向：
- Foundation → Capabilities 或 Interfaces
- Capabilities → Interfaces
- Foundation 模块之间互相依赖（constants 除外，所有模块可依赖 constants）

---

## 4. 模块规格

### Foundation 层

---

#### foundation/constants.js

**职责**：集中定义项目路径、文件名和默认配置值
**来源**：`src/constants.js` 原样迁入
**依赖**：无（仅 node `os`, `path`）

**导出**：
- `PATHS` — 目录路径常量 `{ OPENCODE_DIR, AGENTS_DIR, OPENTEAM_DIR, SETTINGS }`
- `FILES` — 文件名常量 `{ TEAM_CONFIG, RUNTIME, ACTIVE_SESSIONS }`
- `DEFAULTS` — 默认值常量 `{ PORT_RANGE_START, PORT_RANGE_END, HOST }`

---

#### foundation/config.js

**职责**：团队配置的读取、校验和查询
**来源**：`src/team/config.js` 原样迁入
**依赖**：foundation/constants

**导出**：

| 方法 | 签名 | 说明 |
|------|------|------|
| `getTeamDir` | `(teamName) → string` | 团队配置目录路径 |
| `loadTeamConfig` | `(teamName) → object \| null` | 读取 team.json |
| `getTeamAgents` | `(teamName) → string[]` | 团队成员列表 |
| `getTeamLeader` | `(teamName) → string \| null` | 团队 leader |
| `validateTeamConfig` | `(teamName) → { valid, error? }` | 校验配置完整性 |
| `isAgentInTeam` | `(teamName, agentName) → boolean` | 检查成员是否在团队中 |
| `listTeams` | `() → string[]` | 列举所有已配置的团队 |

---

#### foundation/state.js

**职责**：运行时状态（serve 进程信息 + agent session 映射）的持久化
**来源**：`src/team/serve.js` 原样迁入
**依赖**：foundation/constants, foundation/config（仅 `getTeamDir`）

**导出**：

Runtime 管理：

| 方法 | 签名 | 说明 |
|------|------|------|
| `getRuntime` | `(teamName) → object \| null` | 读取 runtime，自动检测进程存活 |
| `saveRuntime` | `(teamName, runtime) → void` | 持久化 runtime |
| `clearRuntime` | `(teamName) → void` | 删除 runtime 文件 |
| `isServeRunning` | `(teamName) → boolean` | 判断 serve 是否运行中 |
| `getServeUrl` | `(teamName) → string \| null` | 获取运行中的 serve URL |
| `findActiveServeUrl` | `() → string` | 扫描所有团队找活跃的 serve URL |
| `findAvailablePort` | `() → Promise<number>` | 在端口范围内找可用端口 |

Monitor 信息：

| 方法 | 签名 | 说明 |
|------|------|------|
| `setMonitorInfo` | `(teamName, { mux, sessionName }) → boolean` | 记录 monitor 会话信息 |
| `getMonitorInfo` | `(teamName) → object \| null` | 获取 monitor 会话信息 |
| `clearMonitorInfo` | `(teamName) → void` | 清除 monitor 信息 |

Session 映射：

| 方法 | 签名 | 说明 |
|------|------|------|
| `loadActiveSessions` | `(teamName) → object` | 加载 agent→session 映射 |
| `saveActiveSessions` | `(teamName, sessions) → void` | 持久化映射 |
| `getAgentInstances` | `(teamName, agentName) → Array<{ sessionId, cwd, alias? }>` | 获取 agent 所有实例 |
| `findInstance` | `(teamName, agentName, { cwd?, alias? }) → object \| null` | 按 cwd 或 alias 查找实例 |
| `addInstance` | `(teamName, agentName, { sessionId, cwd, alias? }) → void` | 添加/更新实例 |
| `removeInstance` | `(teamName, agentName, { cwd?, alias? }) → void` | 移除实例 |
| `clearAgentInstances` | `(teamName, agentName) → void` | 清除所有实例 |

---

#### foundation/opencode.js

**职责**：OpenCode Serve HTTP API 的统一封装，所有对 serve 的 HTTP 调用走这里
**来源**：`src/utils/api.js` 原样迁入
**依赖**：无

**导出**：

| 方法 | 签名 | 说明 |
|------|------|------|
| `fetchSession` | `(serveUrl, sessionID) → Promise<object \| null>` | 获取 session 元数据 |
| `fetchMessages` | `(serveUrl, sessionID) → Promise<array \| null>` | 获取 session 消息列表 |
| `listAllSessions` | `(serveUrl) → Promise<array>` | 列出所有 session |
| `createSession` | `(serveUrl, directory, title, metadata?) → Promise<object \| null>` | 创建新 session |
| `postMessage` | `(serveUrl, sessionID, directory, agent, message, options?) → Promise<object \| null>` | 发送消息（可选等待回复） |
| `sessionExists` | `(serveUrl, sessionID) → Promise<boolean>` | 检查 session 是否存在 |
| `getProviders` | `(serveUrl) → Promise<object \| null>` | 获取可用 provider 列表 |
| `findSmallModel` | `(serveUrl, preferredProviderID?) → Promise<{ providerID, modelID } \| null>` | 查找小模型 |

`postMessage` options: `{ timeout?, pollInterval?, model?, system?, wait? }`

内部辅助（不导出）：
- `fetchWithTimeout(url, options, timeoutMs)` — 带超时的 fetch 封装

---

#### foundation/terminal.js

**职责**：终端复用器（tmux / zellij）统一抽象，屏蔽实现差异
**来源**：**新建文件**，从 `bin/openteam.js` 提取 tmux/zellij 函数，从 `src/plugin/tools.js` 提取 `addPaneToMonitor` 终端操作部分
**依赖**：无（仅 node `child_process`, `fs`）

**导出**：

| 方法 | 签名 | 说明 |
|------|------|------|
| `detectMultiplexer` | `(options?) → 'tmux' \| 'zellij' \| null` | 检测可用的终端复用器。options: `{ tmux?, zellij? }` 可强制指定 |
| `hasSession` | `(mux, sessionName) → boolean` | 检查 multiplexer 会话是否存在 |
| `createSession` | `(mux, sessionName, teamName, agents) → void` | 创建 mux 会话（2×2 网格，超过 4 个 agent 创建多 window/tab） |
| `attachSession` | `(mux, sessionName) → void` | 附加到已有 mux 会话（阻塞直到用户退出） |
| `addPane` | `(mux, sessionName, teamName, agentName, cwd) → boolean` | 向已有会话动态添加 pane |
| `killSession` | `(sessionName) → void` | 销毁 mux 会话（同时尝试 tmux 和 zellij） |

内部辅助（不导出）：
- `chunkAgents(agents, size)` — 按组拆分 agent 列表
- `createTmux2x2Grid(sessionName, windowIndex, teamName, agents)` — tmux 单窗口 2×2 布局
- `createTmuxSession(sessionName, teamName, agents)` — 创建完整 tmux 会话
- `generateZellijTab(tabName, teamName, agents)` — 生成 zellij tab 内容
- `createZellijLayout(sessionName, teamName, agents)` — 生成 zellij KDL 布局文件并返回路径

---

#### foundation/logger.js

**职责**：文件日志系统
**来源**：`src/utils/logger.js` 原样迁入
**依赖**：foundation/constants

**导出**：`createLogger(module)`, `getLogFilePath()`, `clearLog()`, `isLoggingEnabled()`

---

#### foundation/settings.js

**职责**：全局设置管理（~/.openteam/settings.json）
**来源**：`src/utils/settings.js` 原样迁入
**依赖**：foundation/constants

**导出**：`loadSettings()`, `clearSettingsCache()`, `initSettings()`

---

### Capabilities 层

---

#### capabilities/lifecycle.js

**职责**：Agent 生命周期管理 — 身份识别、会话创建/查找/回收/释放/重定向
**来源**：综合提取自多处
**依赖**：foundation/opencode, foundation/state, foundation/config

**导出**：

身份识别：

| 方法 | 签名 | 说明 | 来源 |
|------|------|------|------|
| `parseAgentName` | `(agentName, defaultTeam?) → { team, name, full } \| null` | 解析 "team/agent" 格式 | `utils/agent.js` |
| `getCurrentAgent` | `(sessionID, timeoutMs?) → Promise<{ team, name, full } \| null>` | 从 session 映射或 API 反查 agent 身份 | `utils/agent.js` |

会话管理：

| 方法 | 签名 | 说明 | 来源 |
|------|------|------|------|
| `ensureAgent` | `(teamName, agentName, serveUrl, projectDir) → Promise<string \| null>` | 获取已有或创建新 session（创建时发送初始化消息），返回 sessionId | `bin/openteam.js` getOrCreateSession |
| `findAgentSession` | `(teamName, agentName, serveUrl, options?) → Promise<string \| null>` | 仅查找已有 session，不创建。options: `{ cwd?, matchAny? }` | `bin/openteam.js` getExistingSession + getAnyExistingSession |
| `wakeAgent` | `(teamName, agentName, cwd, serveUrl) → Promise<{ sessionId, cwd } \| null>` | 为离线 agent 创建 session 并注册状态。不发初始化消息（调用方将立即发消息） | `plugin/tools.js` msg handler |
| `recoverSessions` | `(teamName, serveUrl) → Promise<{ recovered, cleaned }>` | 校验并清理失效的 session 映射 | `bin/openteam.js` cmdStart |

Agent 管控：

| 方法 | 签名 | 说明 | 来源 |
|------|------|------|------|
| `freeAgent` | `(teamName, agentName, options?) → string` | 释放 agent 实例。options: `{ cwd?, alias? }`。返回结果描述 | `plugin/tools.js` command free |
| `redirectAgent` | `(teamName, agentName, newCwd, serveUrl, options?) → Promise<string>` | 迁移 agent 到新目录。options: `{ alias? }`。返回结果描述 | `plugin/tools.js` command redirect |
| `getStatus` | `(teamName, serveUrl, who?) → Promise<string>` | 获取状态。who 为空返回全部成员。返回格式化字符串 | `plugin/tools.js` command status |

内部辅助（不导出）：
- `resolveAgentFromSessionMap(sessionID)` — 通过 active-sessions 反查 agent（来源: `utils/agent.js`）

---

#### capabilities/messaging.js

**职责**：Agent 间通信（消息投递 + 广播）+ 团队上下文注入（系统提示词 + 消息标记）
**来源**：从 `plugin/tools.js`（msg handler）和 `plugin/hooks.js`（两个 transform）提取
**依赖**：capabilities/lifecycle, foundation/opencode, foundation/state, foundation/config, foundation/terminal

**导出**：

消息投递：

| 方法 | 签名 | 说明 | 来源 |
|------|------|------|------|
| `sendMessage` | `({ from, to, message, teamName, serveUrl }) → Promise<string>` | 向指定 agent 发送消息。处理：查找目标 session → 唤醒（如需要）→ 添加 monitor pane → 投递消息。返回结果描述 | `plugin/tools.js` msg 单目标 |
| `broadcast` | `({ from, message, teamName, serveUrl }) → Promise<string>` | 向所有成员广播（排除自己）。返回各目标结果换行拼接 | `plugin/tools.js` msg 广播 |

`from` 参数类型: `{ team, name, full }`（即 `getCurrentAgent` 的返回值）

团队上下文：

| 方法 | 签名 | 说明 | 来源 |
|------|------|------|------|
| `tagBossMessage` | `(messages) → void` | 在最后一条无标记 user 消息前添加 `[from boss]`。直接修改 messages 数组 | `plugin/hooks.js` messagesTransform |
| `injectTeamContext` | `(sessionID, output) → Promise<void>` | 向 system prompt 注入团队成员 + 协作规则。直接修改 output.system。含防重复注入、跳过特殊请求 | `plugin/hooks.js` systemTransform |
| `formatTeamPrompt` | `(teamConfig, currentAgentName) → string` | 格式化团队成员提示词 | `plugin/hooks.js` |
| `getCollaborationRules` | `() → string` | 获取协作规则全文 | `plugin/hooks.js` |

---

#### capabilities/monitor.js

**职责**：终端监控会话的编排 — 创建、附加、动态扩展
**来源**：从 `bin/openteam.js`（cmdMonitor）和 `plugin/tools.js`（addPaneToMonitor）提取
**依赖**：foundation/terminal, foundation/state, foundation/config

**导出**：

| 方法 | 签名 | 说明 | 来源 |
|------|------|------|------|
| `startMonitor` | `(teamName, options?) → Promise<void>` | 启动监控会话。options: `{ dir?, tmux?, zellij? }`。流程：检测 mux → 确认团队运行 → 创建/附加会话 → 记录 monitor info | `bin/openteam.js` cmdMonitor |
| `addPaneForAgent` | `(teamName, agentName, cwd) → boolean` | 为新唤醒 agent 添加监控 pane。读取 monitorInfo → 判断是否需要 → 调用 terminal.addPane | `plugin/tools.js` addPaneToMonitor |

**注意**：`startMonitor` 中"确认团队运行"需要调用 `state.isServeRunning`。如果团队未运行，应报错退出（不在 monitor 中启动 serve，那是 CLI 层的编排责任）。

---

### Interfaces 层

---

#### interfaces/cli.js

**职责**：CLI 命令实现，编排 capabilities 和 foundation 完成用户操作
**来源**：从 `bin/openteam.js` 提取所有 `cmd*` 函数，业务逻辑下沉到 capabilities
**依赖**：capabilities/lifecycle, capabilities/monitor, foundation/config, foundation/state, foundation/opencode

**导出**：

| 方法 | 签名 | 说明 |
|------|------|------|
| `cmdStart` | `(teamName, options) → Promise<void>` | 启动团队：校验 → 启动 serve 进程 → 等待就绪 → 保存 runtime → 恢复 session → 确保 leader → attach |
| `cmdAttach` | `(teamName, agentName, options) → Promise<void>` | 附加到 agent 会话。options: `{ watch?, cwd? }` |
| `cmdMonitor` | `(teamName, options) → Promise<void>` | 委托给 `monitor.startMonitor` |
| `cmdStop` | `(teamName) → void` | 停止团队：kill → clearRuntime → terminal.killSession |
| `cmdStatus` | `(teamName) → Promise<void>` | 展示团队运行状态 |
| `cmdList` | `() → void` | 列出所有团队 |
| `cmdDashboard` | `(teamName) → Promise<void>` | 启动 Dashboard TUI |

**保留在 cli.js 的逻辑**（不下沉）：
- serve 进程管理（`spawn`、等待就绪、detach）— CLI 特有的进程编排
- 带颜色的控制台输出辅助函数
- attach 到 opencode 会话的 `execSync` 调用

内部辅助（不导出）：
- `error(msg)`, `info(msg)`, `success(msg)`, `warn(msg)` — 带 ANSI 颜色的输出

---

#### interfaces/plugin/hooks.js

**职责**：OpenCode Plugin hook 定义，薄委托层
**来源**：`src/plugin/hooks.js` 瘦身
**依赖**：capabilities/messaging

**导出**：
- `createHooks() → { messagesTransform, systemTransform }`

实现概要：
```js
export function createHooks() {
  return {
    messagesTransform: async (_input, output) => {
      tagBossMessage(output.messages);
    },
    systemTransform: async (input, output) => {
      await injectTeamContext(input.sessionID, output);
    },
  };
}
```

---

#### interfaces/plugin/tools.js

**职责**：OpenCode Plugin 工具定义，权限校验 + 路由到 capabilities
**来源**：`src/plugin/tools.js` 瘦身
**依赖**：capabilities/lifecycle, capabilities/messaging

**导出**：
- `createToolDefs() → { msg, command }`

**msg 工具**保留的逻辑：
1. 调用 `lifecycle.getCurrentAgent` 获取身份
2. 加载 team config，校验权限（非 leader 不能广播）
3. 委托给 `messaging.sendMessage` 或 `messaging.broadcast`

**command 工具**保留的逻辑：
1. 调用 `lifecycle.getCurrentAgent` 获取身份
2. 校验 leader 身份
3. 解析 `who@alias` 格式
4. 路由到 `lifecycle.getStatus` / `lifecycle.freeAgent` / `lifecycle.redirectAgent`

---

#### bin/openteam.js

**职责**：CLI 入口，仅 Commander 配置和命令路由
**来源**：`bin/openteam.js` 瘦身
**最终约 50 行**

结构：
```js
#!/usr/bin/env node
import { program } from 'commander';
import {
  cmdStart, cmdAttach, cmdList, cmdStop,
  cmdStatus, cmdMonitor, cmdDashboard,
} from '../src/interfaces/cli.js';

program.name('openteam').description('Team management for OpenCode').version('0.1.2');

program.command('start [team]')
  .option('-d, --detach', '后台运行')
  .option('--dir <directory>', '项目目录')
  .action(cmdStart);

program.command('attach [team] [agent]')
  .option('-w, --watch', '监视模式')
  .option('--cwd <directory>', '指定实例目录')
  .action(cmdAttach);

program.command('list').alias('ls').action(cmdList);
program.command('stop <team>').action(cmdStop);
program.command('status <team>').action(cmdStatus);

program.command('monitor [team]')
  .option('--tmux', '强制使用 tmux')
  .option('--zellij', '强制使用 zellij')
  .option('--dir <directory>', '项目目录')
  .action(cmdMonitor);

program.command('dashboard <team>').action(cmdDashboard);

program.parse();
```

---

#### src/index.js

**职责**：Plugin 入口
**变化**：仅更新 import 路径

```js
import { createHooks } from './interfaces/plugin/hooks.js';
import { createToolDefs } from './interfaces/plugin/tools.js';
```

---

#### interfaces/dashboard/*

**职责**：Dashboard TUI — 用图形面板向用户展示团队状态
**来源**：`src/dashboard/` 迁入 `src/interfaces/dashboard/`，更新 import 路径
**依赖**：foundation/state, foundation/config, foundation/opencode

**文件说明**：
- `index.js` — 刷新循环编排，启动/退出生命周期
- `data.js` — 数据获取（团队状态、agent 状态、消息流）
- `ui.js` — blessed UI 组件定义和更新

**import 路径变更**：

| 原 import | 新 import |
|-----------|-----------|
| `../team/serve.js` | `../../foundation/state.js` |
| `../team/config.js` | `../../foundation/config.js` |
| `../utils/api.js` | `../../foundation/opencode.js` |

---

## 5. 删除的文件和目录

| 原路径 | 去向 |
|--------|------|
| `src/constants.js` | → `src/foundation/constants.js` |
| `src/team/config.js` | → `src/foundation/config.js` |
| `src/team/serve.js` | → `src/foundation/state.js` |
| `src/team/` 目录 | 删除 |
| `src/utils/api.js` | → `src/foundation/opencode.js` |
| `src/utils/agent.js` | → 并入 `src/capabilities/lifecycle.js` |
| `src/utils/logger.js` | → `src/foundation/logger.js` |
| `src/utils/settings.js` | → `src/foundation/settings.js` |
| `src/utils/` 目录 | 删除 |
| `src/plugin/hooks.js` | → `src/interfaces/plugin/hooks.js`（瘦身重写） |
| `src/plugin/tools.js` | → `src/interfaces/plugin/tools.js`（瘦身重写） |
| `src/plugin/` 目录 | 删除 |
| `src/dashboard/index.js` | → `src/interfaces/dashboard/index.js` |
| `src/dashboard/data.js` | → `src/interfaces/dashboard/data.js`（更新 import） |
| `src/dashboard/ui.js` | → `src/interfaces/dashboard/ui.js` |
| `src/dashboard/` 目录 | 删除 |

## 6. 执行阶段

### Phase 1：Foundation 层搬家（低风险）

1. 创建 `src/foundation/` 目录
2. 迁移 constants、config、state（原 serve.js）、opencode（原 api.js）、logger、settings
3. 新建 `terminal.js`：从 `bin/openteam.js` 提取 tmux/zellij 函数，从 `plugin/tools.js` 提取终端操作
4. 全局更新 import 路径（包括 dashboard）
5. **验证**：`openteam list`、`openteam status <team>` 正常

### Phase 2：Capabilities 层（核心工作）

1. 创建 `src/capabilities/` 目录
2. 创建 `lifecycle.js`：从 `utils/agent.js` 迁入身份识别，从 `bin/openteam.js` 迁入 session 管理，从 `plugin/tools.js` 迁入 agent 管控
3. 创建 `messaging.js`：从 `plugin/hooks.js` 迁入上下文注入，从 `plugin/tools.js` 迁入消息投递
4. 创建 `monitor.js`：从 `bin/openteam.js` 迁入监控编排，从 `plugin/tools.js` 迁入 addPaneForAgent
5. **验证**：`openteam start`（lifecycle）、agent 间 `msg`（messaging）、`openteam monitor`（monitor）

### Phase 3：Interfaces 层瘦身（收尾）

1. 创建 `src/interfaces/` 目录
2. 创建 `cli.js`：从 `bin/openteam.js` 迁入命令函数，改为调用 capabilities
3. 迁移并瘦身 `plugin/hooks.js` 和 `plugin/tools.js` 到 `interfaces/plugin/`
4. 瘦身 `bin/openteam.js` 为纯路由
5. 更新 `src/index.js` import 路径
6. 删除旧目录 `src/team/`、`src/utils/`、`src/plugin/`
7. **验证**：全流程（start → msg → monitor → status → stop）

---

## 7. 风险与注意事项

- **无自动化测试**：每个 phase 结束后必须手动验证核心流程
- **tools.js 中的 raw fetch**：当前 msg 工具直接 `fetch` 调 API 而未走 `fetchWithTimeout`。迁移时改为调用 `opencode.postMessage` 的 `wait: false` 模式，消除挂起风险
- **Legacy 兼容**：`state.js` 中 session 映射有新格式（数组）和旧格式（字符串）两种。迁移时保留兼容逻辑，不在此次重构中清理
- **dashboard 懒加载**：`cmdDashboard` 使用动态 `import()` 加载 dashboard 模块，路径需更新为 `../src/interfaces/dashboard/index.js`
