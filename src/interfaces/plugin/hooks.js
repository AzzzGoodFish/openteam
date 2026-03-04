/**
 * OpenCode Plugin hook 定义 — 薄委托层
 */

import { tagBossMessage, injectTeamContext } from '../../capabilities/messaging.js';

export function createHooks() {
  return {
    messagesTransform: async (_input, output) => {
      tagBossMessage(output.messages);
    },
    systemTransform: async (input, output) => {
      await injectTeamContext(input.sessionID, output);
    },
  };
}
