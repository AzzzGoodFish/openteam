/**
 * Daemon 的 server 生命周期管理
 * server 以 in-process 方式运行在 daemon 进程内（非子进程）
 */

import { startServer } from '../../server/index.js';
import { createLogger } from '../../foundation/logger.js';

const log = createLogger('daemon:serve');

/**
 * 启动 openteam server（in-process）
 * @param {object} options
 * @param {string} options.teamName - 团队名称
 * @param {string} options.projectDir - 项目目录
 * @param {object} options.teamConfig - 团队配置
 * @param {number} options.port - 端口
 * @param {string} options.host - 主机
 * @returns {Promise<{ hub: MessageHub, url: string, port: number, host: string, close: Function }>}
 */
export async function startServe({ teamName, projectDir, teamConfig, port, host }) {
  log.info('starting server', { teamName, port, host });

  const result = await startServer({ teamName, projectDir, teamConfig, host, port });

  log.info(`server started on ${result.url}`);

  return {
    hub: result.hub,
    url: result.url,
    port,
    host,
    close: result.close,
  };
}

/**
 * 停止 server（优雅关闭）
 */
export async function stopServe(closeFn) {
  if (!closeFn) return;
  log.info('stopping server...');
  try {
    await closeFn();
    log.info('server stopped');
  } catch (err) {
    log.error('server stop error', { error: err.message });
  }
}
