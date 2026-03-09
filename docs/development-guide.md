# OpenTeam 开发指南

## 环境要求

| 依赖 | 要求 |
|------|------|
| Node.js | 18+（需要全局 fetch） |
| npm | 任意版本 |
| tmux 或 zellij | 任一 |

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
├── bin/openteam.js              # CLI 入口
├── src/
│   ├── index.js                 # Plugin 入口
│   ├── interfaces/              # 接口层（CLI、daemon、dashboard、plugin）
│   ├── capabilities/            # 能力层（lifecycle、messaging）
│   └── foundation/              # 基础层（state、config、opencode、terminal、logger）
```

三层架构，依赖单向向下：Interfaces → Capabilities → Foundation。

> OpenTeam 仅负责协作编排；memory 功能不在本仓库。

## 文档约定

- `README.md`：面向使用者的安装、启动、命令说明。
- `docs/architecture.md`：当前架构、模块边界、运行时模型。
- `docs/archive/`：历史方案和设计记录，不作为现行实现约定。

## 开发命令

| 命令 | 说明 |
|------|------|
| `npm install` | 安装依赖 |
| `npm test` | 运行 smoke 验证 |
| `npm link` | 链接到全局 |

## CLI 使用

```bash
# 启动团队
openteam start <team>

# 后台启动
openteam start <team> -d

# 指定项目目录
openteam start <team> --dir /path/to/project

# 查看状态
openteam inspect <team>
openteam inspect <team> --dir /path/to/project

# 列出团队
openteam list

# 停止团队
openteam stop <team>
openteam stop <team> --dir /path/to/project
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

在团队目录下创建 `pm.md`, `architect.md`, `developer.md` 等文件。

## 运行时文件

运行时状态按项目隔离，位于 `~/.opencode/agents/<team>/<hash>/`：

| 文件 | 说明 |
|------|------|
| `.runtime.json` | daemon/serve/mux 运行状态 |
| `.active-sessions.json` | agent → [{ sessionId, cwd }] 会话映射 |

`<hash>` 是 projectDir 的 SHA-256 前 8 位十六进制。

## 调试

项目使用原生 JavaScript，无需编译。修改代码后直接运行即可测试。

```bash
# 直接运行 CLI
node bin/openteam.js start myteam

# 或使用 npm link 后
openteam start myteam
```

## 上游依赖说明

`@opencode-ai/plugin` 根入口在 Node ESM 下有扩展名问题，代码通过 `@opencode-ai/plugin/tool` 子路径导入绕过。

## 测试状态

⚠️ **基础 smoke 验证** - `npm test` 验证模块加载和 CLI 基本功能。

## CI/CD 状态

⚠️ **目前无 CI/CD 配置**。
