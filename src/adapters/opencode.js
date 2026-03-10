/**
 * OpenCode CLI 适配器
 *
 * TODO: opencode 的 CLI flags 和 MCP 配置方式待确认。
 * 当前实现基于推测，联调时根据实际文档调整。
 */

import os from 'os';
import path from 'path';
import { BaseAdapter } from './base.js';

export class OpenCodeAdapter extends BaseAdapter {
  get binary() { return 'opencode'; }

  buildLaunchArgs({ agent, systemPrompt, mcpConfigPath, cwd }) {
    const args = [this.binary];
    // TODO: opencode 的 system prompt 和 agent 参数待确认
    if (systemPrompt) args.push('--prompt', systemPrompt);
    return args;
  }

  buildMcpConfig({ serverUrl, agent }) {
    // TODO: opencode 的 MCP 配置格式待确认
    return {
      openteam: {
        type: 'http',
        url: `${serverUrl}/mcp?agent=${encodeURIComponent(agent)}`,
      },
    };
  }

  getMcpConfigPath(projectDir, agent) {
    // TODO: opencode 的 MCP 配置路径待确认
    return path.join(os.tmpdir(), `openteam-mcp-opencode-${agent}-${encodeURIComponent(path.basename(projectDir))}.json`);
  }
}
