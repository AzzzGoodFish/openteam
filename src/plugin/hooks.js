/**
 * Plugin hooks implementation
 */

import fs from 'fs';
import path from 'path';
import { PATHS } from '../constants.js';
import { loadTeamConfig, loadAgentConfig } from '../team/config.js';
import { findActiveServeUrl } from '../team/serve.js';
import { loadAllMemories, formatMemoriesPrompt } from '../memory/memory.js';
import { saveSession, validateSessions } from '../memory/sessions.js';
import { fetchSession } from '../utils/api.js';

/**
 * Parse agent name from full format (team/agent or just agent)
 */
function parseAgentName(agentName, defaultTeam = null) {
  if (!agentName) return null;

  if (agentName.includes('/')) {
    const [team, name] = agentName.split('/');
    return { team, name, full: agentName };
  }

  if (defaultTeam) {
    return { team: defaultTeam, name: agentName, full: `${defaultTeam}/${agentName}` };
  }

  return null;
}

/**
 * Get current agent from session messages
 */
async function getCurrentAgent(sessionID, timeoutMs = 2000) {
  try {
    const serveUrl = findActiveServeUrl();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${serveUrl}/session/${sessionID}/message`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) return null;
      const messages = await res.json();

      if (!messages || messages.length === 0) return null;

      const lastMsg = messages[messages.length - 1];
      const agentName = lastMsg?.info?.agent;

      return parseAgentName(agentName);
    } catch {
      clearTimeout(timeoutId);
      return null;
    }
  } catch {
    return null;
  }
}

/**
 * Format team members prompt
 */
function formatTeamPrompt(teamConfig, currentAgentName) {
  if (!teamConfig?.agents?.length) return '';

  const teamMembers = teamConfig.agents
    .map((a) => (a === currentAgentName ? `- \`${a}\` (你)` : `- \`${a}\``))
    .join('\n');

  return `<team>\n团队成员：\n${teamMembers}\n</team>`;
}

/**
 * Create hooks for the plugin
 */
export function createHooks() {
  const processedSessions = new Set();
  const pendingPath = path.join(PATHS.AGENTS_DIR, '.pending-sessions.json');

  return {
    /**
     * Event hook - track session idle
     */
    event: async ({ event }) => {
      if (event.type !== 'session.idle') return;

      const sessionID = event.properties?.sessionID;
      if (!sessionID) return;

      if (processedSessions.has(sessionID)) return;
      processedSessions.add(sessionID);

      let pending = [];
      if (fs.existsSync(pendingPath)) {
        try {
          pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
        } catch {
          // Ignore
        }
      }
      pending.push({ sessionID, time: Date.now() });

      const pendingDir = path.dirname(pendingPath);
      if (!fs.existsSync(pendingDir)) {
        fs.mkdirSync(pendingDir, { recursive: true });
      }
      fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2));
    },

    /**
     * System transform hook - inject memory
     */
    systemTransform: async ({ sessionID }, output) => {
      try {
        const serveUrl = findActiveServeUrl();

        // Process pending sessions
        if (fs.existsSync(pendingPath)) {
          try {
            const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));

            for (const item of pending) {
              try {
                const agent = await getCurrentAgent(item.sessionID);
                if (!agent) continue;

                const session = await fetchSession(serveUrl, item.sessionID);
                if (!session) continue;

                saveSession(agent.team, agent.name, item.sessionID, session.title || 'Untitled');
              } catch {
                // Ignore errors
              }
            }

            fs.unlinkSync(pendingPath);
          } catch {
            // Ignore errors
          }
        }

        // Get current agent
        const agent = await getCurrentAgent(sessionID);
        if (!agent) return;

        // Validate sessions
        validateSessions(agent.team, agent.name, serveUrl).catch(() => {});

        // Load and inject memory
        const config = loadAgentConfig(agent.team, agent.name);
        if (config?.memories) {
          const memories = loadAllMemories(agent.team, agent.name);
          const memoriesPrompt = formatMemoriesPrompt(memories);
          if (memoriesPrompt) {
            (output.system ||= []).push(memoriesPrompt);
          }
        }

        // Inject team members
        const teamConfig = loadTeamConfig(agent.team);
        if (teamConfig) {
          const teamPrompt = formatTeamPrompt(teamConfig, agent.name);
          if (teamPrompt) {
            (output.system ||= []).push(teamPrompt);
          }
        }
      } catch (e) {
        console.error('[openteam] systemTransform error:', e.message);
      }
    },
  };
}
