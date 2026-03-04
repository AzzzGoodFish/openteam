/**
 * OpenTeam Dashboard
 *
 * 实时显示团队状态、Agent 状态和消息流
 */

import { getServeUrl, isServeRunning } from '../../foundation/state.js';
import { createDashboard, updateHeader, updateTeamStatus, updateAgentStatus, updateMessageStream } from './ui.js';
import { fetchTeamStatus, fetchAgentStatus, fetchMessageStream } from './data.js';

const REFRESH_INTERVAL = 3000; // 3 秒

/**
 * 启动 Dashboard
 */
export async function dashboard(teamName) {
  // 检查团队是否运行
  if (!isServeRunning(teamName)) {
    console.error(`\x1b[31m错误:\x1b[0m 团队 ${teamName} 未运行`);
    console.log(`请先运行: openteam start ${teamName}`);
    process.exit(1);
  }

  const serveUrl = getServeUrl(teamName);

  // 创建 UI
  const ui = createDashboard(teamName);

  // 初始渲染
  await refreshDashboard(ui, teamName, serveUrl);

  // 定期刷新
  const intervalId = setInterval(async () => {
    await refreshDashboard(ui, teamName, serveUrl);
  }, REFRESH_INTERVAL);

  // 清理资源
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
 * 刷新 Dashboard 数据并更新 UI
 */
async function refreshDashboard(ui, teamName, serveUrl) {
  try {
    const refreshTime = new Date().toLocaleString('zh-CN', { hour12: false });

    // 并行获取数据
    const [teamStatus, agentStatuses, messages] = await Promise.all([
      fetchTeamStatus(teamName),
      fetchAgentStatus(teamName, serveUrl),
      fetchMessageStream(teamName, serveUrl, 20),
    ]);

    // 更新 UI
    updateHeader(ui.header, teamName, refreshTime);
    updateTeamStatus(ui.teamStatus, teamStatus);
    updateAgentStatus(ui.agentStatus, agentStatuses);
    updateMessageStream(ui.messageStream, messages);

    ui.screen.render();
  } catch (err) {
    // 显示错误但不退出
    updateHeader(ui.header, teamName, `Error: ${err.message}`);
    ui.screen.render();
  }
}
