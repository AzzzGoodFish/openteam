/**
 * OpenTeam Plugin for OpenCode
 *
 * 团队协作插件。记忆功能已迁移到 openmemory 插件。
 */

import { tool } from '@opencode-ai/plugin';
import { createHooks } from './interfaces/plugin/hooks.js';
import { createToolDefs } from './interfaces/plugin/tools.js';

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
    'experimental.chat.system.transform': hooks.systemTransform,
    'experimental.chat.messages.transform': hooks.messagesTransform,
    tool: tools,
  };
};

export default OpenTeamPlugin;
