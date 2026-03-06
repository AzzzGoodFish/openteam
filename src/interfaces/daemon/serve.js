/**
 * Daemon 的 serve 子进程管理
 * serve 是 daemon 的直接子进程，生命周期绑定
 */

import { spawn } from 'child_process';
import { checkHealth } from '../../foundation/opencode.js';
import { createLogger } from '../../foundation/logger.js';

const log = createLogger('daemon:serve');

/**
 * 启动 opencode serve 子进程
 * @returns {Promise<{process, pid, port, host, url}>}
 */
export async function startServe(teamName, port, host) {
  const serveProcess = spawn('opencode', ['serve', '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OPENTEAM_TEAM: teamName,
      OPENMEMORY: process.env.OPENMEMORY || '',
    },
  });

  const url = `http://${host}:${port}`;

  // 等待 serve 就绪
  const ready = await waitForReady(url, 30);
  if (!ready) {
    serveProcess.kill();
    throw new Error('serve 启动超时');
  }

  // 转发 serve stderr（包含 Go runtime 和 plugin 输出）
  serveProcess.stderr.on('data', (chunk) => {
    log.error('serve stderr', { output: chunk.toString().trim() });
  });

  log.info(`serve started pid=${serveProcess.pid} port=${port}`);

  return {
    process: serveProcess,
    pid: serveProcess.pid,
    port,
    host,
    url,
  };
}

/**
 * 等待 serve HTTP 可达
 */
async function waitForReady(serveUrl, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    const ok = await checkHealth(serveUrl);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/**
 * 停止 serve 进程（优雅关闭，超时强杀）
 */
export async function stopServe(serveProcess, timeoutMs = 5000) {
  if (!serveProcess || serveProcess.exitCode !== null) return;

  log.info('stopping serve...');
  serveProcess.kill('SIGTERM');

  const exited = await Promise.race([
    new Promise(resolve => serveProcess.on('exit', () => resolve(true))),
    new Promise(resolve => setTimeout(() => resolve(false), timeoutMs)),
  ]);

  if (!exited) {
    log.warn('serve did not exit gracefully, sending SIGKILL');
    serveProcess.kill('SIGKILL');
  }
}

/**
 * 监听 serve 崩溃事件
 * @param {Function} onCrash - 崩溃回调 (code, signal) => void
 */
export function onServeCrash(serveProcess, onCrash) {
  serveProcess.on('exit', (code, signal) => {
    // 正常退出不触发（code 0 或 被 SIGTERM 杀死）
    if (code === 0 || signal === 'SIGTERM') return;
    log.error(`serve crashed code=${code} signal=${signal}`);
    onCrash(code, signal);
  });
}
