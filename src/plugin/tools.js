/**
 * Plugin tools implementation — 团队通信
 *
 * 记忆工具（recall/review/reread）已迁移到 openmemory 插件。
 * openteam 只保留:
 * - msg: 异步消息（像微信）
 * - command: Leader 管理指令
 */

import fs from 'fs';
import { execSync } from 'child_process';
import { tool } from '@opencode-ai/plugin';
import { loadTeamConfig, isAgentInTeam } from '../team/config.js';
import {
  getServeUrl,
  getAgentInstances,
  addInstance,
  removeInstance,
  getMonitorInfo,
} from '../team/serve.js';
import {
  createSession,
  sessionExists,
} from '../utils/api.js';
import { getCurrentAgent } from '../utils/agent.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('tools');

/**
 * Add a new pane to monitor for an agent instance
 */
function addPaneToMonitor(teamName, agentName, cwd) {
  const monitorInfo = getMonitorInfo(teamName);
  if (!monitorInfo) return false;

  const teamConfig = loadTeamConfig(teamName);
  const isInTeam = teamConfig?.agents?.includes(agentName);
  const instances = getAgentInstances(teamName, agentName);

  if (isInTeam && instances.length <= 1) return false;

  const { mux, sessionName } = monitorInfo;
  const cmd = `openteam attach ${teamName} ${agentName} --watch --cwd '${cwd}'`;

  try {
    if (mux === 'tmux') {
      const paneCount = parseInt(
        execSync(`tmux list-panes -t "${sessionName}" -a | wc -l`, { encoding: 'utf8' }).trim()
      );

      if (paneCount % 4 === 0) {
        execSync(`tmux new-window -t "${sessionName}" "${cmd}"`, { stdio: 'ignore' });
      } else {
        execSync(`tmux split-window -t "${sessionName}" "${cmd}"`, { stdio: 'ignore' });
        execSync(`tmux select-layout -t "${sessionName}" tiled`, { stdio: 'ignore' });
      }
    } else if (mux === 'zellij') {
      const env = { ...process.env, ZELLIJ_SESSION_NAME: sessionName };

      const layout = execSync('zellij action dump-layout', { encoding: 'utf8', env });
      const paneCount = (layout.match(/pane command=/g) || []).length;

      if (paneCount > 0 && paneCount % 4 === 0) {
        const tabLayout = `layout {
    tab name="${agentName}" cwd="${cwd}" {
        pane size=1 borderless=true {
            plugin location="zellij:tab-bar"
        }
        pane command="bash" name="${agentName}" start_suspended=false {
            args "-c" "${cmd}"
        }
        pane size=2 borderless=true {
            plugin location="zellij:status-bar"
        }
    }
}`;
        const layoutPath = `/tmp/openteam-tab-${agentName}.kdl`;
        fs.writeFileSync(layoutPath, tabLayout);
        execSync(`zellij action new-tab --layout "${layoutPath}" --name "${agentName}"`, {
          stdio: 'ignore',
          env,
        });
      } else {
        execSync(`zellij run --name "${agentName}" --cwd "${cwd}" -- ${cmd}`, { stdio: 'ignore', env });
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Create tool definitions for the plugin
 */
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

        let targets = [];
        if (isBroadcast) {
          targets = teamConfig.agents.filter((a) => a !== currentAgent.name);
        } else {
          if (!isAgentInTeam(currentAgent.team, args.who)) {
            return `Error: 团队里没有 "${args.who}"，可选: ${teamConfig.agents.join(', ')}`;
          }
          targets = [args.who];
        }

        const currentInstances = getAgentInstances(currentAgent.team, currentAgent.name);
        const defaultCwd = currentInstances[0]?.cwd || process.cwd();

        const msgPreview = args.message.slice(0, 30) + (args.message.length > 30 ? '...' : '');
        log.info(`[${currentAgent.name}] event=msg_send to=${targets.join(',')} preview="${msgPreview}"`);

        const results = [];
        for (const target of targets) {
          let instances = getAgentInstances(currentAgent.team, target);

          if (instances.length === 0) {
            const metadata = {
              agent: `${currentAgent.team}/${target}`,
              team: currentAgent.team,
              role: target,
            };
            const session = await createSession(serveUrl, defaultCwd, `${target} 工作区`, metadata);
            if (session) {
              addInstance(currentAgent.team, target, { sessionId: session.id, cwd: defaultCwd });
              addPaneToMonitor(currentAgent.team, target, defaultCwd);
              instances = [{ sessionId: session.id, cwd: defaultCwd }];
              results.push(`${target}: 已唤醒`);
              log.info(`[${target}] event=agent_wake`);
            } else {
              results.push(`${target}: 唤醒失败`);
              continue;
            }
          }

          let sent = false;
          for (const inst of instances) {
            const exists = await sessionExists(serveUrl, inst.sessionId);
            if (exists) {
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                await fetch(
                  `${serveUrl}/session/${inst.sessionId}/prompt_async?directory=${encodeURIComponent(inst.cwd)}`,
                  {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      agent: `${currentAgent.team}/${target}`,
                      parts: [{ type: 'text', text: `[from ${currentAgent.name}] ${args.message}` }],
                    }),
                    signal: controller.signal,
                  }
                );
                clearTimeout(timeoutId);
                if (!results.includes(`${target}: 已唤醒`)) {
                  results.push(`${target}: 已通知`);
                }
                sent = true;
              } catch {
                // ignore
              }
              break;
            }
          }
          if (!sent && !results.some((r) => r.startsWith(`${target}:`))) {
            results.push(`${target}: 发送失败`);
          }
        }

        return results.join('\n') || '没有可通知的人';
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

        const action = args.action;

        let who = args.who;
        let alias = args.alias;
        if (who && who.includes('@')) {
          const parts = who.split('@');
          who = parts[0];
          alias = parts[1];
        }

        // STATUS
        if (action === 'status') {
          const agents = who ? [who] : teamConfig.agents;
          const lines = [];

          for (const agentName of agents) {
            const instances = getAgentInstances(currentAgent.team, agentName);
            if (instances.length === 0) {
              lines.push(`${agentName}: 休息中`);
            } else {
              for (const inst of instances) {
                const aliasHint = inst.alias ? ` @${inst.alias}` : '';
                const valid = await sessionExists(serveUrl, inst.sessionId);
                const status = valid ? '工作中' : '已断开';
                lines.push(`${agentName}${aliasHint}: ${inst.cwd || '(未知目录)'} [${status}]`);
              }
            }
          }

          return lines.join('\n') || '没有团队成员';
        }

        if (!who) return 'Error: 请指定 who 参数';

        if (!isAgentInTeam(currentAgent.team, who)) {
          return `Error: 团队里没有 "${who}"，可选: ${teamConfig.agents.join(', ')}`;
        }

        // FREE
        if (action === 'free') {
          const instances = getAgentInstances(currentAgent.team, who);
          if (instances.length === 0) return `${who} 已经在休息了`;

          if (instances.length > 1 && !args.cwd && !alias) {
            const list = instances.map((i) => `  - ${i.cwd}${i.alias ? ` @${i.alias}` : ''}`).join('\n');
            return `${who} 有多个实例，请指定 cwd 或 alias:\n${list}`;
          }

          if (instances.length === 1) {
            removeInstance(currentAgent.team, who, { cwd: instances[0].cwd });
          } else {
            removeInstance(currentAgent.team, who, { cwd: args.cwd, alias });
          }

          return `${who} 去休息了`;
        }

        // REDIRECT
        if (action === 'redirect') {
          if (!args.cwd) return 'Error: redirect 需要 cwd 参数';
          if (!fs.existsSync(args.cwd)) return `Error: 目录不存在 - ${args.cwd}`;

          const instances = getAgentInstances(currentAgent.team, who);
          for (const inst of instances) {
            removeInstance(currentAgent.team, who, { cwd: inst.cwd });
          }

          const metadata = {
            agent: `${currentAgent.team}/${who}`,
            team: currentAgent.team,
            role: who,
          };
          const session = await createSession(serveUrl, args.cwd, `${who} 工作区`, metadata);
          if (!session) return 'Error: 创建会话失败';

          addInstance(currentAgent.team, who, { sessionId: session.id, cwd: args.cwd, alias });
          return `${who} 已切换到 ${args.cwd}`;
        }

        return `Error: 未知指令 "${action}"，可用: status, free, redirect`;
      },
    },
  };
}
