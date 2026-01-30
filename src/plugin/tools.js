/**
 * Plugin tools implementation
 *
 * Memory tools:
 * - remember, correct, rethink: Resident memory operations
 * - note, lookup, erase, search: Index (note) operations
 * - review, reread: Session operations
 *
 * Team tools:
 * - tell: Async notification
 * - command: Leader management commands
 */

import fs from 'fs';
import { execSync } from 'child_process';
import { tool } from '@opencode-ai/plugin';
import { loadTeamConfig, isAgentInTeam } from '../team/config.js';
import {
  findActiveServeUrl,
  getServeUrl,
  getAgentInstances,
  findInstance,
  addInstance,
  removeInstance,
  getMonitorInfo,
} from '../team/serve.js';
import {
  appendMemory,
  replaceInMemory,
  writeMemory,
  saveNote,
  readNote,
  deleteNote,
  searchNotes,
} from '../memory/memory.js';
import { searchSessions, removeSession } from '../memory/sessions.js';
import {
  fetchSession,
  fetchMessages,
  createSession,
  postMessage,
  sessionExists,
} from '../utils/api.js';

/**
 * Parse agent name from session messages
 */
async function getCurrentAgent(sessionID) {
  try {
    const serveUrl = findActiveServeUrl();
    const messages = await fetchMessages(serveUrl, sessionID);
    if (!messages || messages.length === 0) return null;

    const lastMsg = messages[messages.length - 1];
    const agentName = lastMsg?.info?.agent;

    if (!agentName) return null;

    if (agentName.includes('/')) {
      const [team, name] = agentName.split('/');
      return { team, name, full: agentName };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Add a new pane to monitor for an agent instance
 * Creates pane for:
 * - Agents not in team.json (always)
 * - Additional instances of agents in team.json (2nd, 3rd, etc.)
 */
function addPaneToMonitor(teamName, agentName, cwd) {
  const monitorInfo = getMonitorInfo(teamName);
  if (!monitorInfo) return false;

  // Check if this is an additional instance that needs a new pane
  const teamConfig = loadTeamConfig(teamName);
  const isInTeam = teamConfig?.agents?.includes(agentName);
  const instances = getAgentInstances(teamName, agentName);

  // If agent is in team.json and this is the first instance,
  // monitor already has a pane for it (from initial setup)
  if (isInTeam && instances.length <= 1) {
    return false;
  }

  const { mux, sessionName } = monitorInfo;
  // Include --cwd to attach to specific instance
  const cmd = `openteam attach ${teamName} ${agentName} --watch --cwd '${cwd}'`;

  try {
    if (mux === 'tmux') {
      // Get total pane count across all windows
      const paneCount = parseInt(
        execSync(`tmux list-panes -t "${sessionName}" -a | wc -l`, { encoding: 'utf8' }).trim()
      );

      // If current window has 4 panes, create new window
      if (paneCount % 4 === 0) {
        execSync(`tmux new-window -t "${sessionName}" "${cmd}"`, { stdio: 'ignore' });
      } else {
        // Add pane to current window with tiled layout
        execSync(`tmux split-window -t "${sessionName}" "${cmd}"`, { stdio: 'ignore' });
        execSync(`tmux select-layout -t "${sessionName}" tiled`, { stdio: 'ignore' });
      }
    } else if (mux === 'zellij') {
      const env = { ...process.env, ZELLIJ_SESSION_NAME: sessionName };

      // Get current pane count via dump-layout
      const layout = execSync('zellij action dump-layout', { encoding: 'utf8', env });
      const paneCount = (layout.match(/pane command=/g) || []).length;

      // Every 4 panes, create new tab; otherwise add pane to current tab
      if (paneCount > 0 && paneCount % 4 === 0) {
        // Create new tab with command using layout file
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
        // Keep layout file for debugging
      } else {
        // Add pane to current tab with correct cwd
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
    // ========== Resident Memory Tools ==========

    remember: {
      description: '把一段信息记到脑子里。会追加到指定记忆的末尾。',
      args: {
        memory: tool.schema.string().describe('记忆名称，如 persona、human、projects'),
        content: tool.schema.string().describe('要记住的内容'),
      },
      execute: async (args, ctx) => {
        const agent = await getCurrentAgent(ctx.sessionID);
        if (!agent) return 'Error: 无法确定当前 agent';

        const result = appendMemory(agent.team, agent.name, args.memory, args.content);
        return result.success ? '已记住' : `Error: ${result.error}`;
      },
    },

    correct: {
      description: '更正记忆中的某段内容。用于修正错误或更新过时信息。',
      args: {
        memory: tool.schema.string().describe('记忆名称'),
        old_text: tool.schema.string().describe('要替换的原文（必须精确匹配）'),
        new_text: tool.schema.string().describe('更正后的内容'),
      },
      execute: async (args, ctx) => {
        const agent = await getCurrentAgent(ctx.sessionID);
        if (!agent) return 'Error: 无法确定当前 agent';

        const result = replaceInMemory(agent.team, agent.name, args.memory, args.old_text, args.new_text);
        return result.success ? '已更正' : `Error: ${result.error}`;
      },
    },

    rethink: {
      description: '重新整理一整块记忆。用于压缩冗长内容或重新组织结构。会覆盖原有内容，谨慎使用。',
      args: {
        memory: tool.schema.string().describe('记忆名称'),
        content: tool.schema.string().describe('整理后的完整内容'),
      },
      execute: async (args, ctx) => {
        const agent = await getCurrentAgent(ctx.sessionID);
        if (!agent) return 'Error: 无法确定当前 agent';

        const result = writeMemory(agent.team, agent.name, args.memory, args.content);
        return result.success ? '已重写' : `Error: ${result.error}`;
      },
    },

    // ========== Note Tools ==========

    note: {
      description: '记一条笔记。详情保存到笔记本，索引自动更新。适合保存较长的、以后需要查阅的内容。',
      args: {
        index: tool.schema.string().describe('笔记本名称，如 projects、specs、notes'),
        key: tool.schema.string().describe('笔记标识，如 jarvy、feature-login'),
        content: tool.schema.string().describe('笔记的详细内容'),
        summary: tool.schema.string().optional().describe('简短摘要，会显示在索引中。不填则自动截取开头'),
      },
      execute: async (args, ctx) => {
        const agent = await getCurrentAgent(ctx.sessionID);
        if (!agent) return 'Error: 无法确定当前 agent';

        const result = saveNote(agent.team, agent.name, args.index, args.key, args.content, args.summary);
        return result.success ? '已记录' : `Error: ${result.error}`;
      },
    },

    lookup: {
      description: '查阅一条笔记的详细内容。',
      args: {
        index: tool.schema.string().describe('笔记本名称'),
        key: tool.schema.string().describe('笔记标识'),
      },
      execute: async (args, ctx) => {
        const agent = await getCurrentAgent(ctx.sessionID);
        if (!agent) return 'Error: 无法确定当前 agent';

        const result = readNote(agent.team, agent.name, args.index, args.key);
        return result.success ? result.content : `Error: ${result.error}`;
      },
    },

    erase: {
      description: '删除一条笔记。索引会自动更新。',
      args: {
        index: tool.schema.string().describe('笔记本名称'),
        key: tool.schema.string().describe('笔记标识'),
      },
      execute: async (args, ctx) => {
        const agent = await getCurrentAgent(ctx.sessionID);
        if (!agent) return 'Error: 无法确定当前 agent';

        const result = deleteNote(agent.team, agent.name, args.index, args.key);
        return result.success ? '已删除' : `Error: ${result.error}`;
      },
    },

    search: {
      description: '在笔记本中搜索。返回匹配的笔记列表。',
      args: {
        index: tool.schema.string().describe('笔记本名称'),
        query: tool.schema.string().describe('搜索关键词'),
      },
      execute: async (args, ctx) => {
        const agent = await getCurrentAgent(ctx.sessionID);
        if (!agent) return 'Error: 无法确定当前 agent';

        const result = searchNotes(agent.team, agent.name, args.index, args.query);
        if (!result.success) return `Error: ${result.error}`;

        if (result.matches.length === 0) return '未找到匹配的笔记';

        return result.matches.map((m) => `${m.key}: ${m.summary}`).join('\n');
      },
    },

    // ========== Session Tools ==========

    review: {
      description: '回顾过去的对话。搜索历史会话记录。',
      args: {
        query: tool.schema.string().describe('搜索关键词，如主题、日期、人名'),
      },
      execute: async (args, ctx) => {
        const agent = await getCurrentAgent(ctx.sessionID);
        if (!agent) return 'Error: 无法确定当前 agent';

        const matches = searchSessions(agent.team, agent.name, args.query, 10);

        if (matches.length === 0) {
          return '未找到匹配的会话';
        }

        return matches
          .map((s) => {
            const date = new Date(s.time).toLocaleDateString('zh-CN');
            return `${s.id}: ${s.title} (${date})`;
          })
          .join('\n');
      },
    },

    reread: {
      description: '重读一次历史对话的完整内容。',
      args: {
        session_id: tool.schema.string().describe('会话ID，如 ses_abc123'),
        limit: tool.schema.number().optional().describe('最多读取多少条消息，默认50'),
      },
      execute: async (args, ctx) => {
        const agent = await getCurrentAgent(ctx.sessionID);
        if (!agent) return 'Error: 无法确定当前 agent';

        const serveUrl = findActiveServeUrl();

        try {
          const session = await fetchSession(serveUrl, args.session_id);
          if (!session) {
            removeSession(agent.team, agent.name, args.session_id);
            return `Error: 会话不存在或无法访问 - ${args.session_id}（已从记录中移除）`;
          }

          const messages = await fetchMessages(serveUrl, args.session_id);
          if (!messages || messages.length === 0) {
            return `会话 "${session.title}" 没有消息`;
          }

          const limit = args.limit || 50;
          const limitedMessages = messages.slice(-limit);

          let output = `# 会话: ${session.title}\n`;
          output += `ID: ${args.session_id}\n`;
          output += `创建时间: ${new Date(session.time?.created).toLocaleString('zh-CN')}\n`;
          output += `消息数: ${messages.length}${messages.length > limit ? ` (显示最近${limit}条)` : ''}\n`;
          output += `---\n\n`;

          for (const msg of limitedMessages) {
            const role = msg.role === 'user' ? '用户' : '助手';
            const time = new Date(msg.time?.created).toLocaleTimeString('zh-CN');

            output += `### ${role} (${time})\n`;

            if (msg.parts && msg.parts.length > 0) {
              for (const part of msg.parts) {
                if (part.type === 'text') {
                  output += `${part.text}\n`;
                } else if (part.type === 'tool_use') {
                  output += `[调用工具: ${part.name}]\n`;
                } else if (part.type === 'tool_result') {
                  output += `[工具结果]\n`;
                }
              }
            } else {
              output += `(无内容)\n`;
            }
            output += `\n`;
          }

          return output;
        } catch (e) {
          return `Error: 读取会话失败 - ${e.message}`;
        }
      },
    },

    // ========== Team Communication ==========

    tell: {
      description:
        '告诉某人一件事（异步，不等回复）。所有人都能用。Leader 可以广播给所有人。',
      args: {
        who: tool.schema
          .string()
          .optional()
          .describe('要告诉谁。不填或填 "all" 表示广播（仅 leader）'),
        message: tool.schema.string().describe('要说的话'),
      },
      execute: async (args, ctx) => {
        const currentAgent = await getCurrentAgent(ctx.sessionID);
        if (!currentAgent) {
          return 'Error: 无法确定当前 agent';
        }

        const teamConfig = loadTeamConfig(currentAgent.team);
        if (!teamConfig) {
          return 'Error: 团队配置不存在';
        }

        const serveUrl = getServeUrl(currentAgent.team);
        if (!serveUrl) {
          return 'Error: 团队 serve 未启动';
        }

        const isLeader = currentAgent.name === teamConfig.leader;
        const isBroadcast = !args.who || args.who === 'all';

        // Only leader can broadcast
        if (isBroadcast && !isLeader) {
          return 'Error: 只有 leader 才能广播';
        }

        // Determine targets
        let targets = [];
        if (isBroadcast) {
          targets = teamConfig.agents.filter((a) => a !== currentAgent.name);
        } else {
          if (!isAgentInTeam(currentAgent.team, args.who)) {
            return `Error: 团队里没有 "${args.who}"，可选: ${teamConfig.agents.join(', ')}`;
          }
          targets = [args.who];
        }

        // Get current agent's cwd for waking up offline agents
        const currentInstances = getAgentInstances(currentAgent.team, currentAgent.name);
        const defaultCwd = currentInstances[0]?.cwd || process.cwd();

        // Send to all targets (async, don't wait for response)
        const results = [];
        for (const target of targets) {
          let instances = getAgentInstances(currentAgent.team, target);

          // If agent is offline, wake it up by creating a new session
          if (instances.length === 0) {
            const metadata = {
              agent: `${currentAgent.team}/${target}`,
              team: currentAgent.team,
              role: target,
            };
            const session = await createSession(
              serveUrl,
              defaultCwd,
              `${target} 工作区`,
              metadata
            );
            if (session) {
              addInstance(currentAgent.team, target, { sessionId: session.id, cwd: defaultCwd });
              addPaneToMonitor(currentAgent.team, target, defaultCwd);
              instances = [{ sessionId: session.id, cwd: defaultCwd }];
              results.push(`${target}: 已唤醒`);
            } else {
              results.push(`${target}: 唤醒失败`);
              continue;
            }
          }

          // Send to first active instance
          let sent = false;
          for (const inst of instances) {
            const exists = await sessionExists(serveUrl, inst.sessionId);
            if (exists) {
              // Fire and forget - don't await response
              fetch(
                `${serveUrl}/session/${inst.sessionId}/message?directory=${encodeURIComponent(inst.cwd)}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    agent: `${currentAgent.team}/${target}`,
                    parts: [{ type: 'text', text: `[来自 ${currentAgent.name}] ${args.message}` }],
                  }),
                }
              ).catch(() => {});
              if (!results.includes(`${target}: 已唤醒`)) {
                results.push(`${target}: 已通知`);
              }
              sent = true;
              break;
            }
          }
          if (!sent && !results.some(r => r.startsWith(`${target}:`))) {
            results.push(`${target}: 发送失败`);
          }
        }

        return results.join('\n') || '没有可通知的人';
      },
    },

    command: {
      description:
        'Leader 专用指令。action: status（查看状态）、free（让人休息）、assign（分配任务）、redirect（切换目录）',
      args: {
        action: tool.schema.string().describe('指令：status、free、assign、redirect'),
        who: tool.schema.string().optional().describe('目标成员（status 时可选）'),
        message: tool.schema.string().optional().describe('任务内容（assign 时用）'),
        cwd: tool.schema.string().optional().describe('工作目录'),
        alias: tool.schema.string().optional().describe('实例别名'),
      },
      execute: async (args, ctx) => {
        const currentAgent = await getCurrentAgent(ctx.sessionID);
        if (!currentAgent) {
          return 'Error: 无法确定当前 agent';
        }

        const teamConfig = loadTeamConfig(currentAgent.team);
        if (!teamConfig) {
          return 'Error: 团队配置不存在';
        }

        if (currentAgent.name !== teamConfig.leader) {
          return `Error: 只有 ${teamConfig.leader} 才能使用 command`;
        }

        const serveUrl = getServeUrl(currentAgent.team);
        if (!serveUrl) {
          return 'Error: 团队 serve 未启动';
        }

        const action = args.action;

        // Parse who@alias format
        let who = args.who;
        let alias = args.alias;
        if (who && who.includes('@')) {
          const parts = who.split('@');
          who = parts[0];
          alias = parts[1];
        }

        // ========== STATUS ==========
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

        // Need who for other actions
        if (!who) {
          return 'Error: 请指定 who 参数';
        }

        if (!isAgentInTeam(currentAgent.team, who)) {
          return `Error: 团队里没有 "${who}"，可选: ${teamConfig.agents.join(', ')}`;
        }

        // ========== FREE ==========
        if (action === 'free') {
          const instances = getAgentInstances(currentAgent.team, who);

          if (instances.length === 0) {
            return `${who} 已经在休息了`;
          }

          if (instances.length > 1 && !args.cwd && !alias) {
            const list = instances
              .map((i) => `  - ${i.cwd}${i.alias ? ` @${i.alias}` : ''}`)
              .join('\n');
            return `${who} 有多个实例，请指定 cwd 或 alias:\n${list}`;
          }

          if (instances.length === 1) {
            removeInstance(currentAgent.team, who, { cwd: instances[0].cwd });
          } else {
            removeInstance(currentAgent.team, who, { cwd: args.cwd, alias });
          }

          return `${who} 去休息了`;
        }

        // ========== REDIRECT ==========
        if (action === 'redirect') {
          if (!args.cwd) {
            return 'Error: redirect 需要 cwd 参数';
          }

          if (!fs.existsSync(args.cwd)) {
            return `Error: 目录不存在 - ${args.cwd}`;
          }

          // Remove old instance(s)
          const instances = getAgentInstances(currentAgent.team, who);
          for (const inst of instances) {
            removeInstance(currentAgent.team, who, { cwd: inst.cwd });
          }

          // Create new session in new directory with metadata
          const metadata = {
            agent: `${currentAgent.team}/${who}`,
            team: currentAgent.team,
            role: who,
          };
          const session = await createSession(serveUrl, args.cwd, `${who} 工作区`, metadata);
          if (!session) {
            return 'Error: 创建会话失败';
          }

          addInstance(currentAgent.team, who, { sessionId: session.id, cwd: args.cwd, alias });

          return `${who} 已切换到 ${args.cwd}`;
        }

        // ========== ASSIGN ==========
        if (action === 'assign') {
          if (!args.message) {
            return 'Error: assign 需要 message 参数';
          }

          const instances = getAgentInstances(currentAgent.team, who);
          let targetInstance = null;
          let isNewSession = false;

          // Find or create instance
          if (instances.length > 0) {
            if (instances.length === 1 && !args.cwd && !alias) {
              targetInstance = instances[0];
            } else if (args.cwd || alias) {
              targetInstance = findInstance(currentAgent.team, who, { cwd: args.cwd, alias });
            } else {
              const list = instances
                .map((i) => `  - ${i.cwd}${i.alias ? ` @${i.alias}` : ''}`)
                .join('\n');
              return `${who} 有多个实例，请指定 cwd 或 alias:\n${list}`;
            }

            if (targetInstance) {
              const exists = await sessionExists(serveUrl, targetInstance.sessionId);
              if (!exists) {
                removeInstance(currentAgent.team, who, { cwd: targetInstance.cwd });
                targetInstance = null;
              }
            }
          }

          if (!targetInstance) {
            if (!args.cwd) {
              return 'Error: 需要 cwd 参数来创建工作区';
            }
            if (!fs.existsSync(args.cwd)) {
              return `Error: 目录不存在 - ${args.cwd}`;
            }

            const metadata = {
              agent: `${currentAgent.team}/${who}`,
              team: currentAgent.team,
              role: who,
            };
            const session = await createSession(
              serveUrl,
              args.cwd,
              `${who} 任务: ${args.message.slice(0, 20)}`,
              metadata
            );
            if (!session) {
              return 'Error: 创建会话失败';
            }

            targetInstance = { sessionId: session.id, cwd: args.cwd, alias };
            addInstance(currentAgent.team, who, targetInstance);
            isNewSession = true;
          }

          // Send task (sync, wait for response)
          const targetAgent = `${currentAgent.team}/${who}`;

          try {
            const response = await postMessage(
              serveUrl,
              targetInstance.sessionId,
              targetInstance.cwd,
              targetAgent,
              args.message
            );

            if (!response) {
              return 'Error: 发送失败';
            }

            // Add pane to monitor AFTER message sent (so pane sees history)
            if (isNewSession) {
              addPaneToMonitor(currentAgent.team, who, args.cwd);
            }

            const textParts = (response.parts || [])
              .filter((p) => p.type === 'text')
              .map((p) => p.text)
              .join('\n');

            const sessionHint = isNewSession ? '(新任务)' : '(继续任务)';
            return `[${who} 回复] ${sessionHint}\n${textParts || '(无回复)'}\n\n工作区: ${targetInstance.cwd}`;
          } catch (e) {
            return `Error: 分配失败 - ${e.message}`;
          }
        }

        return `Error: 未知指令 "${action}"，可用: status, free, assign, redirect`;
      },
    },
  };
}
