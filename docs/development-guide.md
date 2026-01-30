# OpenTeam 开发指南

## 环境要求

| 依赖 | 要求 |
|------|------|
| Node.js | 支持 ES Modules (v14+) |
| npm | 任意版本 |

## 安装

### 作为全局 CLI 工具

```bash
npm install -g openteam
```

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
├── src/plugin/          # 插件核心
├── src/memory/          # 记忆系统
├── src/team/            # 团队管理
└── src/utils/           # 工具函数
```

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

# 监控所有 agent
openteam monitor <team>

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

创建 `pm.md`, `architect.md`, `developer.md` 等文件。

### 4. 创建 agent 配置

在 `<team>/<agent>/agent.json` 中配置记忆：

```json
{
  "name": "pm",
  "memories": [
    { "name": "persona", "type": "resident", "limit": 1000 },
    { "name": "projects", "type": "index", "limit": 1500 }
  ]
}
```

## 运行时文件

| 文件 | 说明 |
|------|------|
| `.runtime.json` | 服务运行状态 |
| `.active-sessions.json` | 活跃会话映射 |
| `sessions.json` | 会话历史 |
| `memories/*.mem` | 记忆文件 |

## 调试

项目使用原生 JavaScript，无需编译。修改代码后直接运行即可测试。

```bash
# 直接运行 CLI
node bin/openteam.js start myteam

# 或使用 npm link 后
openteam start myteam
```

## 测试状态

⚠️ **目前无测试**

package.json 中 test 脚本为空：
```json
"test": "echo \"No tests yet\""
```

## CI/CD 状态

⚠️ **目前无 CI/CD 配置**

未检测到 GitHub Actions 或其他 CI 配置。
