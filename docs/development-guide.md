# OpenTeam 开发指南

## 环境要求

| 依赖 | 要求 |
|------|------|
| Node.js | 支持 ES Modules (v14+) |
| npm | 任意版本 |

## 安装

### 本地开发

```bash
# 克隆仓库
git clone <repo-url>
cd openteam

# 安装依赖
npm install

# 链接到全局（可选，用于测试 CLI）
npm link
```

## 项目结构

```
openteam/
├── bin/openteam.js      # CLI 入口
├── src/index.js         # 库入口
├── src/plugin/          # 插件核心（tools + hooks）
├── src/team/            # 团队管理
└── src/utils/           # 工具函数
```

> OpenTeam 仅负责协作编排；memory 功能不在本仓库。

## 开发命令

| 命令 | 说明 |
|------|------|
| `npm install` | 安装依赖 |
| `npm test` | 运行测试（目前无测试） |
| `npm link` | 链接到全局 |

## CLI 使用

```bash
# 启动团队
openteam start <team>

# 后台启动
openteam start <team> -d

# 附加到会话
openteam attach <team> [agent]
openteam attach <team> [agent] --watch
openteam attach <team> [agent] --watch --cwd /path/to/project

# 监控所有 agent
openteam monitor <team>

# 实时仪表盘
openteam dashboard <team>

# 查看状态
openteam status <team>

# 停止团队
openteam stop <team>
```

## 配置 OpenCode

在 `~/.opencode/opencode.json` 中添加：

```json
{
  "plugin": ["openteam"]
}
```

## 创建团队配置

### 1. 创建团队目录

```bash
mkdir -p ~/.opencode/agents/<team-name>
```

### 2. 创建 team.json

```json
{
  "name": "myteam",
  "leader": "pm",
  "agents": ["pm", "architect", "developer"]
}
```

### 3. 创建 agent 提示词

创建 `pm.md`, `architect.md`, `developer.md` 等文件，使用 YAML frontmatter 配置模型等信息。

## 运行时文件

| 文件 | 说明 |
|------|------|
| `.runtime.json` | 服务运行状态（含 monitor 信息） |
| `.active-sessions.json` | 活跃会话映射（多实例） |

`.active-sessions.json` 结构为 `agent -> [{ sessionId, cwd, alias? }]`。

## 调试

项目使用原生 JavaScript，无需编译。修改代码后直接运行即可测试。

```bash
# 直接运行 CLI
node bin/openteam.js start myteam

# 或使用 npm link 后
openteam start myteam
```

## 测试状态

⚠️ **目前无测试** - `npm test` 只是占位符。

## CI/CD 状态

⚠️ **目前无 CI/CD 配置**。
