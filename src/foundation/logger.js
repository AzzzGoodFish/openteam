/**
 * 日志系统
 *
 * info/warn/error 默认写入日志文件，无需配置。
 * debug 需要启用：
 *   OPENTEAM_DEBUG=1      启用 debug 级别日志
 *   OPENTEAM_LOG_STDERR=1 调试时镜像到 stderr（便于 daemon/serve 捕获）
 *
 * 日志文件: ~/.openteam/openteam.log
 */

import fs from 'fs';
import path from 'path';
import { PATHS } from './constants.js';

// 延迟求值：首次写日志时才读配置，避免循环依赖
let resolved = false;
let debugEnabled = false;
let mirrorToStderr = false;

function resolve() {
  if (resolved) return;
  resolved = true;

  debugEnabled = process.env.OPENTEAM_DEBUG === '1';
  mirrorToStderr = process.env.OPENTEAM_LOG_STDERR === '1';
}

const logFilePath = path.join(PATHS.OPENTEAM_DIR, 'openteam.log');

function timestamp() {
  return new Date().toISOString();
}

function formatMessage(level, module, message, data) {
  const ts = timestamp();
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  return `[${ts}] [${level.toUpperCase()}] [${module}] ${message}${dataStr}`;
}

// 模块加载时确保日志目录存在（error 始终写入，目录必须可用）
try {
  if (!fs.existsSync(PATHS.OPENTEAM_DIR)) {
    fs.mkdirSync(PATHS.OPENTEAM_DIR, { recursive: true });
  }
} catch {
  // 无法创建目录时日志静默丢弃
}

function writeToFile(formatted) {
  try {
    fs.appendFileSync(logFilePath, formatted + '\n');
  } catch {
    // 写入失败静默丢弃
  }
}

function log(level, module, message, data = null) {
  resolve();
  // debug 需要 OPENTEAM_DEBUG=1，其余默认写入
  if (level === 'debug' && !debugEnabled) return;

  const formatted = formatMessage(level, module, message, data);
  writeToFile(formatted);

  // 在 Go 嵌入式 runtime（插件进程）中 fs 可能不可用，
  // console.error → serve stderr → daemon pipe 捕获 → 最终写入日志。
  // 仅在非 daemon 进程中输出，避免破坏 blessed dashboard 渲染。
  if ((level === 'error' || mirrorToStderr) && !process.env.OPENTEAM_DAEMON) {
    console.error(formatted);
  }
}

export function createLogger(module) {
  return {
    debug: (message, data) => log('debug', module, message, data),
    info: (message, data) => log('info', module, message, data),
    warn: (message, data) => log('warn', module, message, data),
    error: (message, data) => log('error', module, message, data),
  };
}
