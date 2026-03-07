# 架构审查修复任务

重构后架构审查发现以下问题，需逐一修复。

---

## Issue 1：addPaneForAgent 重复实现（必修）

**问题**：`capabilities/messaging.js` 第 100-113 行和 `capabilities/monitor.js` 第 71-84 行有完全相同的 `addPaneForAgent` 函数。messaging.js 因此多了一个不必要的 `foundation/terminal.js` 直接依赖。

**修复**：

1. `messaging.js`：删除第 100-113 行的私有 `addPaneForAgent` 函数
2. `messaging.js`：添加 `import { addPaneForAgent } from './monitor.js';`
3. `messaging.js`：删除 `import { addPane } from '../foundation/terminal.js';`
4. `messaging.js`：从 `foundation/state.js` 的 import 中删除 `getMonitorInfo`（只有被删除的函数在用）
5. 确认 `sendMessage` 中调用 `addPaneForAgent(teamName, to, defaultCwd)` 不需要改（签名一致）

**验证**：messaging.js 不再直接 import terminal.js 和 state.js 的 getMonitorInfo。

---

## Issue 2：messaging.js 仍用 raw fetch 投递消息（必修）

**问题**：`messaging.js` 第 52-67 行直接用 `fetch` + 手动 `AbortController` 调 `prompt_async`，没走 `foundation/opencode.js` 的 `postMessage` 封装。违反"所有 HTTP 调用走 opencode.js"原则，且缺少 `fetchWithTimeout` 保护。

**修复**：

1. `messaging.js`：在 opencode.js import 中添加 `postMessage`（目前只 import 了 `sessionExists`）
2. 将 `sendMessage` 中的 raw fetch 块（第 52-67 行）替换为：

```js
try {
  const result = await postMessage(
    serveUrl, inst.sessionId, inst.cwd, to,
    `[from ${from.name}] ${message}`, { wait: false }
  );
  sent = !!result;
} catch {
  // 网络错误忽略
}
```

3. 删除手动的 `AbortController` 和 `setTimeout`（由 opencode.js 的 fetchWithTimeout 统一处理）

**验证**：messaging.js 中不再有任何 raw `fetch` 调用。

---

## Issue 3：state.js 依赖 config.js 违反 Foundation 内独立原则（必修）

**问题**：`foundation/state.js` import 了 `foundation/config.js` 的 `getTeamDir`，违反"Foundation 模块互不依赖（constants 除外）"规则。

**修复**：

1. `foundation/constants.js`：添加 `getTeamDir` 函数（需要 import `path`）：

```js
export function getTeamDir(teamName) {
  return path.join(PATHS.AGENTS_DIR, teamName);
}
```

2. `foundation/config.js`：删除自己的 `getTeamDir` 定义，改为从 constants.js import 并 re-export：

```js
import { PATHS, FILES, getTeamDir } from './constants.js';
export { getTeamDir };
```

这样 config.js 的外部消费者不需要改 import 路径。

3. `foundation/state.js`：将 `import { getTeamDir } from './config.js'` 改为 `import { getTeamDir } from './constants.js'`

**验证**：state.js 不再 import config.js。config.js 仍然 export getTeamDir（re-export），已有调用方不受影响。

---

## Issue 4：lifecycle.js getCurrentAgent 用 raw fetch（建议修）

**问题**：`capabilities/lifecycle.js` 第 81 行直接 `fetch` 取消息，没用 `foundation/opencode.js` 的 `fetchMessages`。

**修复**：

1. `foundation/opencode.js`：给 `fetchMessages` 添加可选的 `timeoutMs` 参数：

```js
export async function fetchMessages(serveUrl, sessionID, timeoutMs = DEFAULT_TIMEOUT) {
  const res = await fetchWithTimeout(`${serveUrl}/session/${sessionID}/message`, {
    headers: { Accept: 'application/json' },
  }, timeoutMs);
  if (!res.ok) return null;
  return res.json();
}
```

2. `capabilities/lifecycle.js`：`getCurrentAgent` 中删除手动的 `AbortController` + raw fetch 块（第 74-108 行），替换为：

```js
try {
  const messages = await fetchMessages(serveUrl, sessionID, timeoutMs);
  if (!messages || messages.length === 0) return null;

  const lastMsg = messages[messages.length - 1];
  const parsed = parseAgentName(lastMsg?.info?.agent);
  if (parsed) return parsed;

  // 兼容 info.agent 仅返回成员名的场景
  const team = process.env.OPENTEAM_TEAM;
  if (team && lastMsg?.info?.agent) {
    const teamConfig = loadTeamConfig(team);
    if (teamConfig?.agents?.includes(lastMsg.info.agent)) {
      return { team, name: lastMsg.info.agent, full: `${team}/${lastMsg.info.agent}` };
    }
  }

  return null;
} catch {
  return null;
}
```

3. `lifecycle.js`：在 opencode.js import 中添加 `fetchMessages`

**验证**：lifecycle.js 中不再有 raw `fetch` 调用。

---

## Issue 5：tools.js 未使用的 import（清洁）

**问题**：`interfaces/plugin/tools.js` 第 10 行 import 了 `getAgentInstances`，但文件中没有使用。

**修复**：从 import 语句中删除 `getAgentInstances`：

```js
import { getServeUrl } from '../../foundation/state.js';
```

---

## 修复顺序

1. Issue 3（state → config 依赖）— 先修 Foundation 层
2. Issue 4（getCurrentAgent raw fetch）— 改 opencode.js API
3. Issue 2（messaging raw fetch）— 用上改好的 opencode.js
4. Issue 1（addPaneForAgent 重复）— 清理 messaging.js 依赖
5. Issue 5（unused import）— 清洁

## 验证

修复完成后，全项目应满足：

1. `grep -r "await fetch(" src/` — 只应出现在 `foundation/opencode.js` 中
2. `foundation/state.js` 的 import 只来自 `./constants.js`
3. `capabilities/messaging.js` 不 import `foundation/terminal.js`
4. 无重复函数定义：`grep -rn "function addPaneForAgent" src/` 应只返回 `monitor.js` 一处
