/**
 * OpenTeam Dashboard
 *
 * 支持两种模式：
 * - 独立运行：`dashboard(teamName)` — 自管理生命周期
 * - 嵌入 daemon：`createEmbeddedDashboard(teamName, serveUrl)` — 由 daemon 管理生命周期
 */

import { getServeUrl, isServeRunning } from '../../foundation/state.js';
import { createDashboard, updateHeader, updateTeamStatus, updateAgentStatus, updateMessageStream } from './ui.js';
import { fetchTeamStatus, fetchAgentStatus, fetchMessageStream } from './data.js';

const REFRESH_INTERVAL = 3000;

/**
 * 独立模式：启动 Dashboard（原有行为不变）
 */
export async function dashboard(teamName) {
  if (!isServeRunning(teamName)) {
    console.error(`\x1b[31m错误:\x1b[0m 团队 ${teamName} 未运行`);
    console.log(`请先运行: openteam start ${teamName}`);
    process.exit(1);
  }

  const serveUrl = getServeUrl(teamName);
  const ui = createDashboard(teamName);

  await refreshDashboard(ui, teamName, serveUrl);

  const intervalId = setInterval(async () => {
    await refreshDashboard(ui, teamName, serveUrl);
  }, REFRESH_INTERVAL);

  process.on('exit', () => {
    clearInterval(intervalId);
    ui.screen.destroy();
  });

  process.on('SIGINT', () => {
    clearInterval(intervalId);
    ui.screen.destroy();
    process.exit(0);
  });
}

/**
 * 嵌入模式：创建 dashboard 并返回控制句柄
 * daemon 负责调用 start/stop，dashboard 不自行退出
 *
 * @returns {{ start: () => void, stop: () => void, refresh: () => Promise<void> }}
 */
export function createEmbeddedDashboard(teamName, serveUrl) {
  const ui = createDashboard(teamName);
  let intervalId = null;

  // 嵌入模式下禁用 q 退出（daemon 管生命周期）
  ui.screen.unkey(['q', 'C-c']);
  ui.screen.key(['q'], () => {
    updateHeader(ui.header, teamName, '使用 openteam stop 停止团队');
    ui.screen.render();
  });

  return {
    start() {
      refreshDashboard(ui, teamName, serveUrl);
      intervalId = setInterval(async () => {
        try {
          await refreshDashboard(ui, teamName, serveUrl);
        } catch {
          // 渲染失败不影响 daemon 核心功能
        }
      }, REFRESH_INTERVAL);
    },
    stop() {
      if (intervalId) clearInterval(intervalId);
      try { ui.screen.destroy(); } catch { /* ignore */ }
    },
    async refresh() {
      await refreshDashboard(ui, teamName, serveUrl);
    },
  };
}

/**
 * 刷新 Dashboard 数据并更新 UI
 */
export async function refreshDashboard(ui, teamName, serveUrl) {
  try {
    const refreshTime = new Date().toLocaleString('zh-CN', { hour12: false });

    const [teamStatus, agentStatuses, messages] = await Promise.all([
      fetchTeamStatus(teamName),
      fetchAgentStatus(teamName, serveUrl),
      fetchMessageStream(teamName, serveUrl, 20),
    ]);

    updateHeader(ui.header, teamName, refreshTime);
    updateTeamStatus(ui.teamStatus, teamStatus);
    updateAgentStatus(ui.agentStatus, agentStatuses);
    updateMessageStream(ui.messageStream, messages);

    ui.screen.render();
  } catch (err) {
    updateHeader(ui.header, teamName, `Error: ${err.message}`);
    ui.screen.render();
  }
}
