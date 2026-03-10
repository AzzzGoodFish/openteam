/**
 * CLI 适配器基类 + 工厂函数
 *
 * 每个适配器封装特定 CLI 工具的启动参数、MCP 配置方式等差异。
 * adapters/ 是基础层 — 只提供 CLI 命令构建，不含业务逻辑。
 */

/**
 * CLI 适配器基类
 */
export class BaseAdapter {
  /**
   * CLI 二进制名称
   * @returns {string}
   */
  get binary() {
    throw new Error('subclass must implement binary getter');
  }

  /**
   * 构建 CLI 启动命令参数（数组形式，第一个元素是二进制名）
   * @param {object} params
   * @param {string} params.agent - agent 名称
   * @param {string} params.systemPrompt - 追加的系统提示词
   * @param {string} params.mcpConfigPath - MCP 配置文件路径
   * @param {string} params.cwd - 工作目录
   * @returns {string[]} 命令数组，如 ['claude', '--agent', 'pm', ...]
   */
  buildLaunchArgs({ agent, systemPrompt, mcpConfigPath, cwd }) {
    throw new Error('subclass must implement buildLaunchArgs');
  }

  /**
   * 构建 MCP 配置对象
   * 返回可写入 JSON 文件的配置，让 CLI 知道如何连接 openteam MCP server。
   * @param {object} params
   * @param {string} params.serverUrl - openteam server URL
   * @param {string} params.agent - agent 名称
   * @returns {object} MCP 配置 JSON
   */
  buildMcpConfig({ serverUrl, agent }) {
    throw new Error('subclass must implement buildMcpConfig');
  }

  /**
   * MCP 配置文件路径（每个 agent 独立，避免多 agent 覆盖冲突）
   * @param {string} projectDir - 项目目录
   * @param {string} agent - agent 名称
   * @returns {string} MCP 配置文件的绝对路径
   */
  getMcpConfigPath(projectDir, agent) {
    throw new Error('subclass must implement getMcpConfigPath');
  }
}

/**
 * 适配器工厂
 * @param {string} cliType - CLI 类型标识（'claude-code' | 'opencode'）
 * @returns {BaseAdapter}
 */
export async function createAdapter(cliType) {
  // 动态 import 避免启动时加载所有适配器
  const adapters = {
    'claude-code': () => import('./claude-code.js').then(m => new m.ClaudeCodeAdapter()),
    'opencode': () => import('./opencode.js').then(m => new m.OpenCodeAdapter()),
  };

  const factory = adapters[cliType];
  if (!factory) {
    throw new Error(`Unknown CLI type: "${cliType}". Available: ${Object.keys(adapters).join(', ')}`);
  }
  return factory();
}
