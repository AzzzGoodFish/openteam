# 团队沟通工具设计

## 概述

重新设计 OpenTeam 的团队沟通机制，解决以下问题：

1. **单一工具职责过重**：原有 poke 工具既负责通知也负责管理
2. **缺乏异步通知**：所有沟通都是同步的，阻塞调用方
3. **权限不清晰**：没有区分普通成员和 leader 的能力边界

## 设计原则

- **职责分离**：沟通和管理是两件事
- **同步/异步分离**：通知不等回复，指令要等结果
- **权限明确**：leader 有管理权，普通成员只能沟通

## 工具设计

### tell（异步通知）

所有 agent 都可以使用，用于发送不需要等待回复的消息。

| 属性 | 说明 |
|------|------|
| 权限 | 所有人 |
| 模式 | 异步（fire and forget） |
| 参数 | `who`（目标，可选）、`message`（消息） |

特殊能力：
- Leader 可以广播：`who` 不填或填 `"all"` 时通知所有人
- 普通成员必须指定 `who`

### command（管理指令）

仅 leader 可用，用于团队管理操作。

| 属性 | 说明 |
|------|------|
| 权限 | 仅 leader |
| 模式 | 同步（等待结果） |
| 参数 | `action`、`who`（可选）、`message`（可选）、`cwd`（可选）、`alias`（可选） |

支持的 action：

| Action | 说明 | 必需参数 |
|--------|------|----------|
| status | 查看团队状态 | 无（可选 who 查看单人） |
| assign | 分配任务 | who, message |
| free | 让 agent 休息 | who |
| redirect | 切换工作目录 | who, cwd |

## 多实例支持

一个 agent 可以在不同目录同时运行多个实例。

### 会话存储格式

`~/.opencode/agents/<team>/.active-sessions.json`：

```json
{
  "pm": [
    { "sessionId": "ses_xxx", "cwd": "/path/to/project-a" }
  ],
  "developer": [
    { "sessionId": "ses_yyy", "cwd": "/path/to/project-a" },
    { "sessionId": "ses_zzz", "cwd": "/path/to/project-b", "alias": "feature-x" }
  ]
}
```

### 实例定位规则

当 `command` 或 `tell` 需要找到目标 agent 时：

1. **单实例**：直接使用
2. **多实例**：
   - 指定了 `cwd` → 匹配工作目录
   - 指定了 `alias` → 匹配别名
   - 都没指定 → 报错，要求明确指定

### who@alias 语法

支持 `who@alias` 格式快速指定：

```
command assign developer@feature-x "实现登录功能"
```

## Monitor 机制

### attach --watch 模式

`openteam attach <team> <agent> --watch` 进入监视模式：

1. 检查 active-sessions 中是否有该 agent 的会话
2. 有 → 自动 attach
3. 无 → 显示"等待会话..."，每 2 秒检查一次
4. 会话结束 → 清屏，回到等待状态

### free 断开机制

当 leader 执行 `command free <agent>` 时：

1. 从 active-sessions 中移除该实例记录
2. watch 模式检测到变化，kill attach 进程
3. 清屏，回到等待状态
4. 会话历史保留，不删除
