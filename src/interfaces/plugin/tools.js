/**
 * OpenCode Plugin 工具定义 — 权限校验 + 路由到 capabilities
 */

import fs from 'fs';
import { tool } from '@opencode-ai/plugin';
import { getCurrentAgent, freeAgent, redirectAgent, getStatus } from '../../capabilities/lifecycle.js';
import { sendMessage, broadcast } from '../../capabilities/messaging.js';
import { loadTeamConfig, isAgentInTeam } from '../../foundation/config.js';
import { getServeUrl } from '../../foundation/state.js';
import { createLogger } from '../../foundation/logger.js';

const log = createLogger('tools');

export function createToolDefs() {
  return {
    msg: {
      description:
        '发消息（异步，像发微信）。直接输出文字对方看不到，必须用 msg。收到 [from xxx] 消息后需用 msg 回复对方才能看到。Leader 可广播。',
      args: {
        who: tool.schema
          .string()
          .optional()
          .describe('发给谁。不填或填 "all" 表示广播（仅 leader）'),
        message: tool.schema.string().describe('消息内容'),
      },
      execute: async (args, ctx) => {
        const currentAgent = await getCurrentAgent(ctx.sessionID);
        if (!currentAgent) return 'Error: 无法确定当前 agent';

        const teamConfig = loadTeamConfig(currentAgent.team);
        if (!teamConfig) return 'Error: 团队配置不存在';

        const serveUrl = getServeUrl(currentAgent.team);
        if (!serveUrl) return 'Error: 团队 serve 未启动';

        const isLeader = currentAgent.name === teamConfig.leader;
        const isBroadcast = !args.who || args.who === 'all';

        if (isBroadcast && !isLeader) return 'Error: 只有 leader 才能广播';

        if (isBroadcast) {
          // 广播
          const msgPreview = args.message.slice(0, 30) + (args.message.length > 30 ? '...' : '');
          log.info(`[${currentAgent.name}] event=broadcast preview="${msgPreview}"`);
          return broadcast({ from: currentAgent, message: args.message, teamName: currentAgent.team, serveUrl });
        }

        // 单点发送
        if (!isAgentInTeam(currentAgent.team, args.who)) {
          return `Error: 团队里没有 "${args.who}"，可选: ${teamConfig.agents.join(', ')}`;
        }

        const msgPreview = args.message.slice(0, 30) + (args.message.length > 30 ? '...' : '');
        log.info(`[${currentAgent.name}] event=msg_send to=${args.who} preview="${msgPreview}"`);

        return sendMessage({
          from: currentAgent,
          to: args.who,
          message: args.message,
          teamName: currentAgent.team,
          serveUrl,
        });
      },
    },

    command: {
      description:
        'Leader 专用指令。action: status（查看状态）、free（让人休息）、redirect（切换目录）',
      args: {
        action: tool.schema.string().describe('指令：status、free、redirect'),
        who: tool.schema.string().optional().describe('目标成员（status 时可选）'),
        cwd: tool.schema.string().optional().describe('工作目录（redirect 时用）'),
        alias: tool.schema.string().optional().describe('实例别名'),
      },
      execute: async (args, ctx) => {
        const currentAgent = await getCurrentAgent(ctx.sessionID);
        if (!currentAgent) return 'Error: 无法确定当前 agent';

        const teamConfig = loadTeamConfig(currentAgent.team);
        if (!teamConfig) return 'Error: 团队配置不存在';

        if (currentAgent.name !== teamConfig.leader) {
          return `Error: 只有 ${teamConfig.leader} 才能使用 command`;
        }

        const serveUrl = getServeUrl(currentAgent.team);
        if (!serveUrl) return 'Error: 团队 serve 未启动';

        let who = args.who;
        let alias = args.alias;
        if (who && who.includes('@')) {
          const parts = who.split('@');
          who = parts[0];
          alias = parts[1];
        }

        // STATUS
        if (args.action === 'status') {
          return getStatus(currentAgent.team, serveUrl, who);
        }

        if (!who) return 'Error: 请指定 who 参数';

        if (!isAgentInTeam(currentAgent.team, who)) {
          return `Error: 团队里没有 "${who}"，可选: ${teamConfig.agents.join(', ')}`;
        }

        // FREE
        if (args.action === 'free') {
          return freeAgent(currentAgent.team, who, { cwd: args.cwd, alias });
        }

        // REDIRECT
        if (args.action === 'redirect') {
          if (!args.cwd) return 'Error: redirect 需要 cwd 参数';
          if (!fs.existsSync(args.cwd)) return `Error: 目录不存在 - ${args.cwd}`;
          return redirectAgent(currentAgent.team, who, args.cwd, serveUrl, { alias });
        }

        return `Error: 未知指令 "${args.action}"，可用: status, free, redirect`;
      },
    },
  };
}
