/**
 * OpenTeam Plugin for OpenCode
 *
 * Agent-centric team collaboration with memory management.
 */

import { tool } from '@opencode-ai/plugin';
import { createHooks } from './plugin/hooks.js';
import { createToolDefs } from './plugin/tools.js';
const OpenTeamPlugin = async (ctx) => {
  // Only load when started via openteam (OPENTEAM_TEAM env var is set)
  const teamName = process.env.OPENTEAM_TEAM;
  if (!teamName) {
    return {};
  }

  const hooks = createHooks(ctx);
  const toolDefs = createToolDefs(ctx);

  // Convert tool definitions to OpenCode format
  const tools = {};
  for (const [name, def] of Object.entries(toolDefs)) {
    tools[name] = tool({
      description: def.description,
      args: def.args,
      execute: def.execute,
    });
  }

  return {
    event: hooks.event,
    'experimental.chat.system.transform': hooks.systemTransform,
    'experimental.chat.messages.transform': hooks.messagesTransform,
    tool: tools,
  };
};

// Export both default and named for compatibility
export default OpenTeamPlugin;
export { OpenTeamPlugin };
