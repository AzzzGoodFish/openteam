# Msg Debug Instrumentation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 `msg` 故障建立端到端 trace，把失败准确定位到工具入口、会话选择、HTTP 投递或运行时状态读取中的具体断点。

**Architecture:** 不改消息链路，只在 `interfaces -> capabilities -> foundation` 现有路径上补充分层日志。每次 `msg` 调用生成一个 trace id，沿着 `tools -> messaging -> lifecycle/state -> opencode` 传递，确保一次发送的所有日志可串联。

**Tech Stack:** Node.js ES Modules, OpenCode plugin hooks/tools, file logger

---

## 诊断目标

1. 确认 `msg` 调用是否稳定进入 `tools.msg.execute`
2. 确认当前 agent 身份解析是否正确
3. 确认 team runtime / serveUrl / session 映射是否读到了预期值
4. 确认目标 session 是否存在且与 runtime 映射一致
5. 确认 HTTP POST 是否真正发出、耗时多久、在哪个阶段失败
6. 确认失败是否与并发中的 hook 或 `getCurrentAgent()` 交叉请求有关

## 任务拆分

### Task 1: Trace 设计与工具入口插桩

**Files:**
- Modify: `src/interfaces/plugin/tools.js`
- Modify: `src/capabilities/messaging.js`

**Step 1: 为每次 `msg` 调用生成 trace id**

- 格式：`msg-<timestamp-base36>-<random>`
- 在 `msg.execute()` 开始处记录：`trace`, `fromSessionID`, `who`, `isBroadcast`, `team`

**Step 2: 把 trace id 传入 capability 层**

- `sendMessage()` / `broadcast()` 参数新增 `trace`
- 记录目标选择、实例数量、默认 cwd、是否唤醒

**Step 3: 在失败返回字符串里附带 trace**

- 让 live run 里 agent 直接回传 `trace=<id>`
- 便于从 CLI 输出和日志双向定位同一条请求

### Task 2: Runtime / 会话解析插桩

**Files:**
- Modify: `src/capabilities/lifecycle.js`
- Modify: `src/foundation/state.js`

**Step 1: 给 `getCurrentAgent()` 增加可选 trace 参数**

- 记录命中的是 session map 还是 `fetchMessages()` fallback
- 记录 fallback 使用的 `serveUrl`

**Step 2: 给 runtime 读取函数补 debug 日志**

- `getRuntime()` / `getServeUrl()` / `findActiveServeUrl()`
- 记录读取到的 team、runtime 路径、host/port、是否因为 pid 校验失败而返回 null

**Step 3: 给 `wakeAgent()` / `findAgentSession()` 补日志**

- 记录 session 创建、映射写入、匹配到的实例和被跳过的实例

### Task 3: HTTP 边界插桩

**Files:**
- Modify: `src/foundation/opencode.js`

**Step 1: 给 `fetchWithTimeout()` 增加可选 meta**

- 记录：`trace`, `method`, `url`, `timeoutMs`, `startedAt`, `durationMs`
- 成功只记 debug；失败记 error

**Step 2: 给 `postMessage()` 记录完整边界状态**

- 投递前：`trace`, `sessionID`, `directory`, `agent`, `wait`, `messagePreview`
- 投递后：`status`, `durationMs`
- 异常时：错误类型、错误消息、是否 `AbortError`

**Step 3: 必要时给 `fetchMessages()` / `sessionExists()` 加 trace 感知**

- 不改变默认调用方
- 仅在 `trace` 存在时打细日志，避免平时日志过噪

### Task 4: Live Run 操作规程

**Files:**
- Modify: `README.md`（仅当需要补临时调试命令说明时）

**Step 1: 启动前环境**

Run:

```bash
OPENTEAM_LOG=1 OPENTEAM_LOG_LEVEL=debug openteam start <team>
```

**Step 2: 触发最小操作**

- 只做一次 agent-to-agent `msg`
- 记录工具返回里的 trace id

**Step 3: 对照日志链路**

- `tools` 是否收到 trace
- `messaging` 是否选到了正确实例
- `state/lifecycle` 是否读到正确 serveUrl
- `opencode` 是否真正发起 POST
- POST 是否超时或被上游拒绝

### Task 5: 故障归因与最小修复候选

**Files:**
- Modify: `docs/plans/2026-03-06-msg-debug-instrumentation.md`

**Step 1: 根据 live logs 填写观察结果**

- 哪一层最后一条成功日志出现在哪里
- 第一条异常日志出现在哪里

**Step 2: 将根因归类为下列之一**

- runtime 读取错误
- 会话映射错误
- hook 并发干扰
- API 投递超时
- 上游 serve 行为异常

**Step 3: 再决定是否进入修复**

- 修复前先保留复现步骤和关键日志证据
