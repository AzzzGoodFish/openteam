# 记忆系统 v2 设计

## 概述

重新设计 OpenTeam 的记忆系统，借鉴 Letta (MemGPT) 的分层记忆架构，解决以下问题：

1. **记忆膨胀**：现有 blocks 全部展开，无大小限制
2. **缺乏层级**：所有信息平铺，无法区分重要性
3. **工具不自然**：memory_append/replace 不够拟人化

## 记忆模型

### 三层记忆

| 层级 | 类型 | 特点 | 访问方式 |
|------|------|------|----------|
| L1 | resident | 常驻 context，有大小限制 | 直接可见 |
| L2 | index | 索引常驻，详情按需加载 | 工具查询 |
| L3 | sessions | 会话历史索引 | 工具查询 |

### 类型说明

**resident（常驻记忆）**
- 始终在 system prompt 中
- 有字符数限制（limit）
- 适合：persona、当前状态、关键信息

**index（索引记忆）**
- 索引部分常驻（有 limit）
- 详情存储在子目录，按需查询
- 索引自动维护（note 时更新）
- 适合：项目列表、需求规格、技术笔记

**sessions（会话历史）**
- 特殊的索引类型
- 索引从 sessions.json 生成
- 详情通过 serve API 获取

## 配置格式

### agent.json

```json
{
  "memories": [
    {
      "name": "persona",
      "type": "resident",
      "limit": 1000,
      "readonly": true,
      "description": "我是谁，我的角色和职责"
    },
    {
      "name": "human",
      "type": "resident",
      "limit": 800,
      "description": "关于用户的信息"
    },
    {
      "name": "status",
      "type": "resident",
      "limit": 500,
      "description": "当前工作状态"
    },
    {
      "name": "projects",
      "type": "index",
      "limit": 1500,
      "description": "项目笔记本"
    },
    {
      "name": "specs",
      "type": "index",
      "limit": 1000,
      "description": "需求规格笔记本"
    },
    {
      "name": "sessions",
      "type": "sessions",
      "limit": 2000,
      "description": "历史会话记录"
    }
  ]
}
```

### 存储结构

```
~/.opencode/agents/<team>/<agent>/
  agent.json                 # 记忆配置
  memories/
    persona.mem              # resident 类型
    human.mem                # resident 类型
    status.mem               # resident 类型
    projects.mem             # index 索引
    projects/                # index 详情目录
      jarvy.mem
      openteam.mem
    specs.mem                # index 索引
    specs/
      memory-v2.mem
    sessions.mem             # sessions 索引（自动生成）
```

### 索引格式

索引文件由系统自动维护，格式：

```
jarvy: AI 助手项目
openteam: Agent 团队协作插件
---
（以下是 agent 的自由备注，可用 remember 添加）
jarvy 是 fish 的核心项目，优先级高。
```

`---` 以上是自动维护的条目列表，以下是 agent 的补充说明。

## 工具设计

### 设计原则

1. **工具名像人的动作**：remember、recall、rethink...
2. **参数少而明确**：不要 mode、options 这种复杂参数
3. **索引自动维护**：agent 只管内容，系统管格式

### 工具清单

#### 常驻记忆工具

| 工具 | 作用 | 参数 |
|------|------|------|
| remember | 记住（追加） | memory, content |
| correct | 更正（替换部分） | memory, old_text, new_text |
| rethink | 重想（重写整个） | memory, content |

#### 笔记工具

| 工具 | 作用 | 参数 |
|------|------|------|
| note | 记笔记 | index, key, content, summary? |
| lookup | 查笔记 | index, key |
| erase | 删笔记 | index, key |
| search | 找笔记 | index, query |

#### 会话工具

| 工具 | 作用 | 参数 |
|------|------|------|
| review | 回顾（搜索会话） | query |
| reread | 重读（会话详情） | session_id |

### 工具详细定义

```javascript
// ========== 常驻记忆 ==========

remember: {
  description: '把一段信息记到脑子里。会追加到指定记忆的末尾。',
  args: {
    memory: '记忆名称，如 persona、human、projects',
    content: '要记住的内容'
  },
  returns: '成功返回"已记住"，失败返回错误原因'
}

correct: {
  description: '更正记忆中的某段内容。用于修正错误或更新过时信息。',
  args: {
    memory: '记忆名称',
    old_text: '要替换的原文（必须精确匹配）',
    new_text: '更正后的内容'
  },
  returns: '成功返回"已更正"，找不到原文会报错'
}

rethink: {
  description: '重新整理一整块记忆。用于压缩冗长内容或重新组织结构。会覆盖原有内容，谨慎使用。',
  args: {
    memory: '记忆名称',
    content: '整理后的完整内容'
  },
  returns: '成功返回"已重写"'
}

// ========== 笔记 ==========

note: {
  description: '记一条笔记。详情保存到笔记本，索引自动更新。适合保存较长的、以后需要查阅的内容。',
  args: {
    index: '笔记本名称，如 projects、specs、notes',
    key: '笔记标识，如 jarvy、feature-login',
    content: '笔记的详细内容',
    summary: '（可选）简短摘要，会显示在索引中。不填则自动截取开头'
  },
  returns: '成功返回"已记录"'
}

lookup: {
  description: '查阅一条笔记的详细内容。',
  args: {
    index: '笔记本名称',
    key: '笔记标识'
  },
  returns: '笔记内容，找不到会报错'
}

erase: {
  description: '删除一条笔记。索引会自动更新。',
  args: {
    index: '笔记本名称',
    key: '笔记标识'
  },
  returns: '成功返回"已删除"'
}

search: {
  description: '在笔记本中搜索。返回匹配的笔记列表。',
  args: {
    index: '笔记本名称',
    query: '搜索关键词'
  },
  returns: '匹配的笔记列表（key: 摘要），无匹配返回"未找到"'
}

// ========== 会话 ==========

review: {
  description: '回顾过去的对话。搜索历史会话记录。',
  args: {
    query: '搜索关键词，如主题、日期、人名'
  },
  returns: '匹配的会话列表（ID、标题、日期）'
}

reread: {
  description: '重读一次历史对话的完整内容。',
  args: {
    session_id: '会话ID，如 ses_abc123'
  },
  returns: '会话的完整内容'
}
```

## System Prompt 注入

### 格式

```xml
<memory>
<persona readonly="true">
我是 PM，负责产品规划和团队协调...
</persona>

<human>
fish 是我的用户，他喜欢简洁的代码风格...
</human>

<projects type="index">
jarvy: AI 助手项目
openteam: Agent 团队协作插件
---
jarvy 是 fish 的核心项目。
</projects>

<sessions type="sessions">
ses_abc123: 2025-01-20, 讨论 jarvy 记忆功能
ses_def456: 2025-01-22, openteam monitor 需求
ses_ghi789: 2025-01-26, 记忆系统设计
</sessions>
</memory>
```

### 加载逻辑

1. 遍历 memories 配置
2. 对于 resident 类型：直接加载 .mem 文件内容
3. 对于 index 类型：加载索引文件（.mem），标记 type="index"
4. 对于 sessions 类型：从 sessions.json 生成索引
5. 检查每个记忆是否超出 limit，超出则警告

## 大小限制处理

当记忆内容接近或超出 limit 时：

1. **警告**：在记忆末尾添加 `[警告: 接近容量上限，请考虑整理]`
2. **拒绝写入**：如果追加后会超出，返回错误提示 agent 先整理
3. **建议**：提示 agent 使用 rethink 压缩，或将部分内容 note 到笔记本

## 迁移计划

### 从 v1 迁移

1. 读取现有 agent.json 的 blocks 配置
2. 将 blocks 目录重命名为 memories
3. 转换配置格式：
   - `label` → `name`
   - `file` → 自动（memories/{name}.mem）
   - 新增 `type`（默认 resident）
   - 新增 `limit`（默认 2000）
4. 旧工具 memory_append/memory_replace 保留兼容，标记废弃

### 兼容性

- 旧配置格式仍可读取（自动转换）
- 旧工具仍可使用（内部映射到新工具）
- 新 agent 使用新配置格式

## 实现计划

1. **Phase 1**: 重构存储层（memories 目录结构、配置格式）
2. **Phase 2**: 实现新工具（9 个工具）
3. **Phase 3**: 更新 prompt 注入逻辑
4. **Phase 4**: 更新示例配置、文档
5. **Phase 5**: 测试、迁移脚本
