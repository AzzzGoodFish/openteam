/**
 * MCP tools 注册 — msg + taskboard
 *
 * 注册两个 MCP tools 到 McpServer 实例。
 * agent 身份通过 sessionAgentMap 查找（session 初始化时从 URL 参数捕获）。
 */

import { z } from 'zod';
import { createLogger } from '../foundation/logger.js';

const log = createLogger('mcp');

/**
 * 注册 MCP tools 到 McpServer 实例
 *
 * @param {McpServer} mcpServer - MCP server 实例（每个 session 一个）
 * @param {MessageHub} hub - 消息中枢（全局共享）
 * @param {Function} getAgentFromSession - (ctx) => agentName，从 MCP 上下文获取调用者身份
 * @param {object} teamContext - { teamName, projectDir, teamConfig }
 */
export function setupMcpTools(mcpServer, hub, getAgentFromSession, teamContext) {
  const { teamName, projectDir, teamConfig } = teamContext;

  // ── msg tool ──
  mcpServer.registerTool(
    'msg',
    {
      description: 'Send a message to a team agent (async). Your text output is invisible to other agents — use this tool to communicate. When you receive [from <agent>], reply with msg. IMPORTANT: When you receive [from boss], reply directly in your output — boss is in your session, not an agent. Leader can broadcast by omitting "who".',
      inputSchema: z.object({
        who: z.string().optional().describe('Target agent name. Omit to broadcast (leader only).'),
        message: z.string().describe('Message content'),
      }),
    },
    async ({ who, message }, ctx) => {
      const callerAgent = getAgentFromSession(ctx);
      if (!callerAgent) {
        return { content: [{ type: 'text', text: 'Error: unable to identify caller agent' }] };
      }

      const isLeader = callerAgent === teamConfig.leader;
      const isBroadcast = !who || who === 'all';

      // boss 拦截
      if (who === 'boss') {
        return { content: [{ type: 'text', text: 'Error: boss is in your session. Reply directly in your output — do not use msg to talk to boss.' }] };
      }

      if (isBroadcast && !isLeader) {
        return { content: [{ type: 'text', text: 'Error: only the leader can broadcast' }] };
      }

      if (isBroadcast) {
        const prefixedMessage = `[from ${callerAgent}] ${message}`;
        const results = hub.broadcast({ from: callerAgent, message: prefixedMessage, agents: teamConfig.agents });
        const summary = results.map(r => `${r.to}: ${r.online ? 'delivered' : 'queued'}`).join(', ');
        return { content: [{ type: 'text', text: summary }] };
      }

      // 单点发送
      if (!teamConfig.agents.includes(who)) {
        return { content: [{ type: 'text', text: `Error: "${who}" is not in the team. Available: ${teamConfig.agents.join(', ')}` }] };
      }

      const prefixedMessage = `[from ${callerAgent}] ${message}`;
      const result = hub.deliver({ from: callerAgent, to: who, message: prefixedMessage });
      return { content: [{ type: 'text', text: `${who}: ${result.online ? 'delivered' : 'queued'}` }] };
    }
  );

  // ── taskboard tool ──
  mcpServer.registerTool(
    'taskboard',
    {
      description: 'Task management. Actions: create (leader only), done (mark complete), list (view all tasks).',
      inputSchema: z.object({
        action: z.string().describe('Action: create, done, or list'),
        title: z.string().optional().describe('Task title (for create)'),
        description: z.string().optional().describe('Task description (for create)'),
        assignee: z.string().optional().describe('Assignee agent name (for create)'),
        depends_on: z.array(z.number()).optional().describe('Dependency task IDs (for create)'),
        id: z.number().optional().describe('Task ID (for done)'),
      }),
    },
    async ({ action, title, description, assignee, depends_on, id }, ctx) => {
      const callerAgent = getAgentFromSession(ctx);
      if (!callerAgent) {
        return { content: [{ type: 'text', text: 'Error: unable to identify caller agent' }] };
      }

      if (action === 'list') {
        // list 是纯读取，直接复用 capabilities 层
        const { listTasks } = await import('../capabilities/taskboard.js');
        const tasks = listTasks(teamName, projectDir);
        if (tasks.length === 0) {
          return { content: [{ type: 'text', text: 'No tasks' }] };
        }
        const formatted = tasks.map(t => {
          const status = t.status === 'done' ? '\u2713' : '\u23f3';
          const deps = t.dependsOn.length > 0 ? ` (depends on ${t.dependsOn.map(d => '#' + d).join(',')})` : '';
          return `#${t.id} ${status} ${t.title} \u2192 ${t.assignee}${deps}`;
        }).join('\n');
        return { content: [{ type: 'text', text: formatted }] };
      }

      // create 和 done 需要 deliverMessage 适配 hub，阶段 4 接入
      return { content: [{ type: 'text', text: `TODO: taskboard ${action} not yet wired to hub` }] };
    }
  );

  log.info('mcp.tools.registered', { tools: ['msg', 'taskboard'] });
}
