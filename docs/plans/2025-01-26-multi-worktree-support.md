# Multi-Worktree Support Design [已实现]

## 背景

用户的开发场景：
1. 一个项目可能有多个需求并行开发
2. 每个需求可能在不同的 git worktree 中进行
3. 希望能在任意目录和 PM 讨论项目需求
4. agent 应该以自身为中心组织，而非以项目为中心

## OpenCode 限制

经调研，opencode 目前**不支持**会话中途更改工作目录：
- 工作目录在启动时通过 `-c` 参数设置
- 会话中无法通过 `cd` 或其他方式改变工作目录
- 相关 feature request: issues #2177, #1143, #1877

## 设计方案

### 核心原则

**agent 记忆知道项目在哪，而不是依赖工作目录**

### 1. PM 的项目管理

PM 使用 `projects` 索引记忆管理所有项目信息：

```
# projects.idx

jarvy-factory | 多 agent 协作插件
another-proj | 另一个项目
```

每个项目有详细笔记 `projects/jarvy-factory.note`：

```yaml
name: jarvy-factory
path: ~/dev/llm/jarvy-factory
description: OpenCode 多 agent 协作插件

worktrees:
  - name: main
    path: ~/dev/llm/jarvy-factory
    branch: main
    status: 稳定
  - name: openteam
    path: ~/dev/llm/jarvy-factory/openteam
    branch: feature/openteam
    status: 开发中
  - name: feature-x
    path: ~/dev/llm/jarvy-factory/feature-x
    branch: feature/x
    status: 规划中

current_focus: openteam
```

### 2. 使用场景

#### 场景 A：在任意目录和 PM 讨论

```bash
# 在家目录启动 PM
cd ~
opencode -c ~/.opencode/agents/team1/pm
```

PM 通过 `lookup('projects', 'jarvy-factory')` 知道项目在哪，可以：
- 用完整路径读取代码 `cat ~/dev/llm/jarvy-factory/openteam/src/...`
- 讨论需求和架构
- 记录决策到项目笔记

#### 场景 B：进入 worktree 开发

```bash
# 进入具体 worktree 启动 developer
cd ~/dev/llm/jarvy-factory/openteam
opencode -c ~/.opencode/agents/team1/developer
```

developer 在启动时：
- 检测当前目录
- 通过 `lookup` 或 `search` 找到对应项目和 worktree
- 自动加载相关上下文

#### 场景 C：PM 协调多个 worktree

PM 记忆中维护所有 worktree 的状态，可以：
- 追踪各个 worktree 的进度
- 告诉 developer 去哪个目录工作
- 汇总各 worktree 的完成情况

### 3. 跨目录操作

当 agent 需要查看其他位置的文件时，使用完整路径：

```bash
# 在 openteam worktree 中查看主分支的代码
cat ~/dev/llm/jarvy-factory/src/something.js
```

这避免了对"切换目录"功能的依赖。

### 4. 启动脚本（可选）

为了方便，可以创建启动脚本：

```bash
# ~/.local/bin/team
#!/bin/bash
# 快速启动 team agent

AGENT=${1:-pm}
TEAM=${2:-team1}

opencode -c ~/.opencode/agents/$TEAM/$AGENT "$@"
```

使用方式：
```bash
team pm          # 启动 PM
team developer   # 启动 developer
```

## 实现计划

### Phase 1：PM 项目管理增强

1. 更新 PM 的 agent.json，添加 projects 索引记忆
2. 更新 PM 的 persona，增加项目管理职责描述
3. 创建示例项目笔记模板

### Phase 2：目录检测（可选）

1. 在 SessionStart hook 中检测当前工作目录
2. 尝试匹配已知项目/worktree
3. 自动提供相关上下文

### Phase 3：启动脚本

1. 创建 `team` 启动脚本
2. 支持快速切换 agent

## 不做的事情

- 不等待 opencode 实现目录切换功能
- 不 hack opencode 内部实现
- 不限制 agent 只能在特定目录启动

## 总结

这个方案的核心是**让记忆成为项目位置的真实来源**，而不是依赖工作目录。这样：
- PM 可以在任何地方讨论任何项目
- Developer 在 worktree 中工作时知道上下文
- 不需要 opencode 的新功能支持
