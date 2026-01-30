# 记忆生命周期：积累 → 巩固 → 蒸馏 [已实现]

## 背景

当前记忆自动生成（extractor）存在两个核心问题：

1. **触发太频繁**：每次 session.idle 都调用 LLM 提取，大部分时候对话内容不值得记忆
2. **生成内容价值低**：只看最近 1 轮对话，不了解已有记忆，导致产出碎片化、重复、内容浅薄

实际观察：openteam 相关对话产生了 4 个碎片 key（openteam / openteam-positioning / openteam-summary / openteam-memory-hints），内容高度重复，每条仅一句话。

## 设计思路

参考人类记忆的生物学机制，用计算机方式实现：

- 人类记忆不是实时形成的，而是在"离线"时（睡眠、反思）巩固
- 人类记忆会随时间"蒸馏"——细节蒸发，要点沉淀
- 人类记忆是重构的，不是录像式的

对应到智能体：不在每次对话结束时提取，而是让记忆经历三个阶段。

## 系统总览

### 阶段一：积累（Accumulate）

每次 session.idle 触发时，不调用 LLM，只将该 session 标记为"待巩固素材"。零 LLM 成本。

### 阶段二：巩固（Consolidate）

当素材积累到一定量，触发一次巩固。维护者看到这段时间所有会话摘要 + 当前记忆库存 + agent 主体定义，对 index 记忆做增删改操作。

### 阶段三：蒸馏（Distill）

定期对全量记忆库做一次全局整理——合并重复、浓缩细节为核心认知、删除过时内容。

第一版范围：只维护 index 类型记忆，resident 由 agent 自主管理。

## 阶段一：积累（Accumulate）

### 触发时机

保留现有 `session.idle` 事件监听，行为从"调用 LLM 提取"改为"标记素材"。

### 标记逻辑

idle 触发时：

1. 跳过系统 session（`metadata.system` 或标题以 `[系统]` 开头）
2. 通过 `lastAnalyzedCount` 检查是否有新消息（复用现有去重机制）
3. 检查通过后，将该 session 记录到待巩固列表

### 记录内容

```json
{
  "sessionID": "xxx",
  "agentName": "pm",
  "teamName": "team1",
  "messageCount": 12,
  "timestamp": "2026-01-29T10:00:00Z"
}
```

### 存储位置

`~/.opencode/agents/<team>/<agent>/.memory-state.json`（每个 agent 独立）：

```json
{
  "pendingSessions": [ ... ],
  "lastConsolidation": "2026-01-28T10:00:00Z",
  "lastDistillation": "2026-01-20T10:00:00Z"
}
```

### 巩固触发判断

每次新增标记后，检查是否满足巩固条件（满足任一）：

- 待巩固 session 数 ≥ 5（可配置）
- 距上次巩固 ≥ 24 小时（可配置）

## 阶段二：巩固（Consolidate）

### 输入材料

**① 会话素材**

遍历 `pendingSessions`，对每个 session 获取其 summary（OpenCode 已生成的消息级摘要）。如果 summary 不可用，回退到 `formatConversation` 取最近几轮对话。按时间排序，拼接为一段"这段时间发生了什么"的叙事。

**② 当前记忆库存**

读取该 agent 所有可写的 index 记忆块。对每个 index，列出已有的 key + summary + content。让维护者清楚地知道"我现在记住了什么"。

**③ Agent 主体定义**

读取 agent 的主体文件（如 `pm.md`），作为背景上下文注入。让维护者理解"我是谁、我关注什么"。

### 维护者的任务

> 基于这段时间的经历，审视我的记忆库，决定需要做哪些更新。

输出一组结构化操作（actions），针对 index 记忆：

- **create**：新建一个 key（附 summary + content）
- **update**：替换已有 key 的内容和摘要
- **append**：在已有 key 上补充新信息
- **delete**：移除过时的条目

每个 action 附带简短的 `reason`，用于日志审计。

### 执行

逐条执行 actions，调用现有的 `saveNote` / `deleteNote` 等函数写入文件。全部执行完毕后，清空 `pendingSessions`，更新 `lastConsolidation` 时间戳。

## 阶段三：蒸馏（Distill）

### 与巩固的区别

巩固是"把新经历整合进记忆"，蒸馏是"对已有记忆做一次全局整理"。巩固关注"最近发生了什么"，蒸馏关注"记忆库整体是否健康"。

### 触发条件（满足任一）

- 距上次蒸馏 ≥ 7 天（可配置）
- index 记忆总条目数超过阈值（例如 20 条）
- 手动触发：`openteam distill <team> [agent]`

触发检查点：每次巩固完成后，顺便检查是否需要蒸馏。

### 输入材料

- **全量记忆库存**：所有 index 的 key + summary + 完整 content
- **Agent 主体定义**

不需要会话素材。蒸馏的原材料就是记忆本身。

### 维护者的任务

> 审视我全部的记忆，让它更精炼、更有结构、更准确。

操作类型：

- **merge**：将内容重叠的多个 key 合并为一个
- **rewrite**：将冗长或过于具体的内容浓缩为核心认知
- **delete**：移除已被取代或不再相关的条目
- **keep**：显式标记不需要变动的条目（便于审计）

### 执行

与巩固相同，逐条执行 actions，写入文件。执行完毕后更新 `lastDistillation` 时间戳。

## Prompt 设计

### 巩固 Prompt

```
你是 {agentName} 的记忆维护者。

## 你的身份背景
{agent 主体定义内容}

## 你当前的记忆库存
{按 index 列出所有 key + summary + content}

## 最近的经历
{pendingSessions 的 summary 列表，按时间排序}

## 你的任务
基于最近的经历，审视你的记忆库，决定需要做哪些更新。

判断标准：
- 出现了新项目或新模块 → create
- 已有条目需要补充新信息 → append 或 update
- 偏好、约束、决策发生了变化 → update
- 踩坑经验或解决方案值得记录 → create 或 append
- 对话内容是一次性的、临时的 → 不操作

原则：
- 优先更新已有条目，而不是创建新条目
- 内容要有信息密度，不要写空泛的一句话概括
- 每个操作附带简短 reason
```

### 蒸馏 Prompt

```
你是 {agentName} 的记忆维护者。

## 你的身份背景
{agent 主体定义内容}

## 你当前的全部记忆
{所有 index 的 key + summary + 完整 content}

## 你的任务
对记忆库做一次全局整理，使其更精炼、更有结构。

操作：
- 内容重叠的条目 → merge 为一个
- 冗长或过于具体的内容 → rewrite 为核心认知
- 已过时或被取代的内容 → delete
- 仍然准确且有价值的 → keep

原则：
- 保留关键决策和原因，去掉过程细节
- 一个主题尽量归到一个条目
- 信息密度优先于信息完整度

删除约束（重要）：
- 禁止因为"与当前工作无关"或"不在焦点上"而删除笔记
- 记忆应跨项目、跨时期保留
- 只有内容已被合并、明确过时有误导、或内容为空时才允许删除
- 不确定是否应该删除时，选择 keep
```

### 输出格式（两者共用）

Prompt 要求模型用 yaml 代码块包裹输出，代码块前后可以有分析文字。解析器优先提取代码块内容，fallback 到整段解析和 `actions:` 截取。

````
```yaml
actions:
  - action: create|update|append|delete|merge|rewrite|keep
    index: projects
    key: openteam
    summary: "..."
    content: |
      ...
    reason: "为什么做这个操作"
    merge_from: ["key1", "key2"]  # 仅 merge 时需要
```
````

## 实现计划

### 需要改动的文件

**① `src/memory/extractor.js` — 核心重构**

- 移除现有的单轮提取逻辑（`EXTRACTOR_PROMPT`、`formatConversation`、`parseExtractorResponse`）
- 新增三个核心函数：
  - `markPendingSession(team, agent, sessionID, messageCount)` — 积累
  - `consolidate(team, agent, serveUrl)` — 巩固
  - `distill(team, agent)` — 蒸馏
- 新增状态管理：`readMemoryState` / `writeMemoryState`
- 新增巩固/蒸馏的 Prompt 模板和输出解析

**② `src/plugin/hooks.js` — 事件处理改动**

- `session.idle` handler 从"调用 extractMemories"改为"调用 markPendingSession + 检查是否触发巩固"
- 巩固完成后检查是否触发蒸馏

**③ `src/memory/memory.js` — 新增操作**

- `getMemoryInventory(team, agent)` — 返回完整记忆库存
- `mergeNotes(team, agent, index, sourceKeys, targetKey, content, summary)` — merge 支持

**④ `bin/openteam.js` — CLI 扩展（可选）**

- `openteam distill <team> [agent]` 手动触发蒸馏

### 不需要改动的部分

- 记忆工具（remember / note / lookup 等）
- Memory hints 注入逻辑
- systemTransform 记忆注入
- 模型选择逻辑（优先使用 extractor.model 配置，fallback 到 agent 主模型）

### 配置扩展

`team.json` 新增可选配置：

```json
{
  "extractor": {
    "model": { "providerID": "anthropic", "modelID": "claude-sonnet-4-5" },
    "consolidation": {
      "sessionThreshold": 5,
      "timeThreshold": "24h"
    },
    "distillation": {
      "timeThreshold": "7d",
      "entryThreshold": 20
    }
  }
}
```
