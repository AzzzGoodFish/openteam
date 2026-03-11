/**
 * Claude Code CLI 适配器
 *
 * claude code CLI 关键 flags：
 *   --agent <name>                 agent 模式
 *   --append-system-prompt <text>  追加系统提示词
 *   --mcp-config <path>           加载 MCP 配置文件
 *   --strict-mcp-config           只用 --mcp-config 指定的 MCP server
 *
 * MCP 配置格式（.mcp.json 风格）：
 *   { "openteam": { "type": "http", "url": "http://host:port/mcp?agent=xxx" } }
 */

import os from 'os';
import path from 'path';
import { BaseAdapter } from './base.js';

export class ClaudeCodeAdapter extends BaseAdapter {
  get binary() { return 'claude'; }

  buildLaunchArgs({ agent, systemPrompt, mcpConfigPath, cwd, extraArgs = [] }) {
    const args = [this.binary];
    if (agent) args.push('--agent', agent);
    if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
    if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
    args.push(...extraArgs);
    return args;
  }

  buildMcpConfig({ serverUrl, agent }) {
    // claude code --mcp-config 格式：需要 mcpServers 包裹
    return {
      mcpServers: {
        openteam: {
          type: 'http',
          url: `${serverUrl}/mcp?agent=${encodeURIComponent(agent)}`,
        },
      },
    };
  }

  getMcpConfigPath(projectDir, agent) {
    // 用临时目录避免污染项目的 .mcp.json（可能有用户自己的 MCP 配置）
    // 每个 agent 独立文件，避免多 agent 覆盖冲突
    // wrapper 通过 --mcp-config 显式传入这个路径
    return path.join(os.tmpdir(), `openteam-mcp-${agent}-${encodeURIComponent(path.basename(projectDir))}.json`);
  }
}
