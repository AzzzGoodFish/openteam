/**
 * OpenCode Plugin 工具定义 — 权限校验 + 路由到 capabilities
 */

import fs from 'fs';
import { tool } from '@opencode-ai/plugin/tool';
import { getCurrentAgent, freeAgent, redirectAgent, getStatus } from '../../capabilities/lifecycle.js';
import { sendMessage, broadcast } from '../../capabilities/messaging.js';
import { createTask, completeTask, listTasks } from '../../capabilities/taskboard.js';
import { loadTeamConfig, isAgentInTeam } from '../../foundation/config.js';
import { getServeUrl } from '../../foundation/state.js';
import { createLogger } from '../../foundation/logger.js';

const log = createLogger('tools');

function createTraceID() {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createToolDefs() {
  return {
    msg: {
      description:
        'Send a message to a team agent (async). Your text output is invisible to other agents — use this tool to communicate. When you receive [from <agent>], reply with msg. IMPORTANT: When you receive [from boss], reply directly in your output — boss is in your session, not an agent. Leader can broadcast by omitting "who".',
      args: {
        who: tool.schema
          .string()
          .optional()
          .describe('Target agent name. Omit or set to "all" to broadcast (leader only).'),
        message: tool.schema.string().describe('Message content'),
      },
      execute: async (args, ctx) => {
        const trace = createTraceID();
        log.info('msg.execute.start', {
          trace,
          fromSessionID: ctx.sessionID,
          who: args.who || 'all',
          isBroadcast: !args.who || args.who === 'all',
        });

        const currentAgent = await getCurrentAgent(ctx.sessionID, 2000, { trace, reason: 'msg.execute' });
        if (!currentAgent) return 'Error: unable to identify current agent';

        const teamConfig = loadTeamConfig(currentAgent.team);
        if (!teamConfig) return 'Error: team config not found';

        const projectDir = currentAgent.projectDir;
        if (!projectDir) return 'Error: unable to determine project directory';
        const serveUrl = getServeUrl(currentAgent.team, projectDir, { trace, reason: 'msg.execute' });
        if (!serveUrl) return 'Error: team serve is not running';

        const isLeader = currentAgent.name === teamConfig.leader;
        const isBroadcast = !args.who || args.who === 'all';

        if (isBroadcast && !isLeader) return 'Error: only the leader can broadcast';

        if (isBroadcast) {
          // 广播
          const msgPreview = args.message.slice(0, 30) + (args.message.length > 30 ? '...' : '');
          log.info(`[${currentAgent.name}] event=broadcast preview="${msgPreview}"`, { trace, serveUrl });
          return broadcast({ from: currentAgent, message: args.message, teamName: currentAgent.team, projectDir, serveUrl, trace });
        }

        // 单点发送
        if (args.who === 'boss') {
          return 'Error: boss is in your session — reply directly in your output, no need to use msg.';
        }

        if (!isAgentInTeam(currentAgent.team, args.who)) {
          return `Error: "${args.who}" is not in the team. Available agents: ${teamConfig.agents.join(', ')}`;
        }

        const msgPreview = args.message.slice(0, 30) + (args.message.length > 30 ? '...' : '');
        log.info(`[${currentAgent.name}] event=msg_send to=${args.who} preview="${msgPreview}"`, { trace, serveUrl });

        return sendMessage({
          trace,
          from: currentAgent,
          to: args.who,
          message: args.message,
          teamName: currentAgent.team,
          projectDir,
          serveUrl,
        });
      },
    },

    command: {
      description:
        'Leader-only commands for team management. Actions: status (view status), free (release agent), redirect (change working directory).',
      args: {
        action: tool.schema.string().describe('Action: status, free, or redirect'),
        who: tool.schema.string().optional().describe('Target agent (optional for status)'),
        cwd: tool.schema.string().optional().describe('Working directory (for redirect)'),
        alias: tool.schema.string().optional().describe('Instance alias'),
      },
      execute: async (args, ctx) => {
        const currentAgent = await getCurrentAgent(ctx.sessionID);
        if (!currentAgent) return 'Error: unable to identify current agent';

        const teamConfig = loadTeamConfig(currentAgent.team);
        if (!teamConfig) return 'Error: team config not found';

        if (currentAgent.name !== teamConfig.leader) {
          return `Error: only ${teamConfig.leader} can use command`;
        }

        const projectDir = currentAgent.projectDir;
        if (!projectDir) return 'Error: unable to determine project directory';
        const serveUrl = getServeUrl(currentAgent.team, projectDir);
        if (!serveUrl) return 'Error: team serve is not running';

        let who = args.who;
        let alias = args.alias;
        if (who && who.includes('@')) {
          const parts = who.split('@');
          who = parts[0];
          alias = parts[1];
        }

        // STATUS
        if (args.action === 'status') {
          return getStatus(currentAgent.team, projectDir, serveUrl, who);
        }

        if (!who) return 'Error: "who" parameter is required';

        if (!isAgentInTeam(currentAgent.team, who)) {
          return `Error: "${who}" is not in the team. Available agents: ${teamConfig.agents.join(', ')}`;
        }

        // FREE
        if (args.action === 'free') {
          return freeAgent(currentAgent.team, projectDir, who, { cwd: args.cwd, alias });
        }

        // REDIRECT
        if (args.action === 'redirect') {
          if (!args.cwd) return 'Error: redirect requires "cwd" parameter';
          if (!fs.existsSync(args.cwd)) return `Error: directory not found - ${args.cwd}`;
          return redirectAgent(currentAgent.team, projectDir, who, args.cwd, serveUrl, { alias });
        }

        return `Error: unknown action "${args.action}". Available: status, free, redirect`;
      },
    },

    taskboard: {
      description:
        'Task management. Actions: create (leader only), done (mark complete), list (view all tasks).',
      args: {
        action: tool.schema.string().describe('Action: create, done, or list'),
        title: tool.schema.string().optional().describe('Task title (required for create)'),
        description: tool.schema.string().optional().describe('Task description (optional for create)'),
        assignee: tool.schema.string().optional().describe('Assignee agent name (required for create)'),
        depends_on: tool.schema.array(tool.schema.number()).optional().describe('Dependency task IDs (optional for create)'),
        id: tool.schema.number().optional().describe('Task ID (required for done)'),
      },
      execute: async (args, ctx) => {
        const trace = createTraceID();
        const currentAgent = await getCurrentAgent(ctx.sessionID, 2000, { trace, reason: 'task.execute' });
        if (!currentAgent) return 'Error: unable to identify current agent';

        const teamConfig = loadTeamConfig(currentAgent.team);
        if (!teamConfig) return 'Error: team config not found';

        const projectDir = currentAgent.projectDir;
        if (!projectDir) return 'Error: unable to determine project directory';
        const serveUrl = getServeUrl(currentAgent.team, projectDir, { trace, reason: 'task.execute' });
        if (!serveUrl) return 'Error: team serve is not running';

        // CREATE
        if (args.action === 'create') {
          if (currentAgent.name !== teamConfig.leader) {
            return `Error: only ${teamConfig.leader} can create tasks`;
          }
          if (!args.title) return 'Error: create requires "title" parameter';
          if (!args.assignee) return 'Error: create requires "assignee" parameter';

          const result = await createTask({
            teamName: currentAgent.team, projectDir, serveUrl,
            title: args.title,
            description: args.description || '',
            assignee: args.assignee,
            dependsOn: args.depends_on || [],
            trace,
          });

          if (!result.ok) return `Error: ${result.error}`;

          let response = `Task #${result.task.id} created: "${result.task.title}" → ${result.task.assignee}`;
          if (result.triggered && result.triggered.length > 0) {
            response += `\nNotified: ${result.triggered.join(', ')}`;
          } else if (result.task.dependsOn.length > 0) {
            response += `\nWaiting on: ${result.task.dependsOn.map(id => '#' + id).join(', ')}`;
          }
          return response;
        }

        // DONE
        if (args.action === 'done') {
          if (args.id == null) return 'Error: done requires "id" parameter';

          const result = await completeTask({
            teamName: currentAgent.team, projectDir, serveUrl,
            agentName: currentAgent.name,
            taskId: args.id,
            trace,
          });

          if (!result.ok) return `Error: ${result.error}`;

          let response = `Task #${result.task.id} "${result.task.title}" completed`;
          if (result.triggered.length > 0) {
            response += `\nTriggered downstream:\n${result.triggered.join('\n')}`;
          }
          return response;
        }

        // LIST
        if (args.action === 'list') {
          const tasks = listTasks(currentAgent.team, projectDir);
          if (tasks.length === 0) return 'No tasks';

          return tasks.map(t => {
            const status = t.status === 'done' ? '✓' : '⏳';
            const deps = t.dependsOn.length > 0 ? ` (depends on ${t.dependsOn.map(id => '#' + id).join(',')})` : '';
            const desc = t.description ? `\n   ${t.description}` : '';
            return `#${t.id} ${status} ${t.title} → ${t.assignee}${deps}${desc}`;
          }).join('\n');
        }

        return `Error: unknown action "${args.action}". Available: create, done, list`;
      },
    },
  };
}
