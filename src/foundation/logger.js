/**
 * 日志系统
 *
 * error 级别始终写入日志文件（无需配置）
 * debug/info/warn 需要启用：
 *   OPENTEAM_LOG=1       启用日志
 *   OPENTEAM_LOG_LEVEL=debug|info|warn|error
 *
 * 日志文件: ~/.openteam/openteam.log
 */

import fs from 'fs';
import path from 'path';
import { PATHS } from './constants.js';

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// 延迟求值：首次写日志时才读配置，避免循环依赖
let resolved = false;
let isEnabled = false;
let minLevel = LOG_LEVELS.info;

function resolve() {
  if (resolved) return;
  resolved = true;

  const envLog = process.env.OPENTEAM_LOG;
  const envLevel = process.env.OPENTEAM_LOG_LEVEL;

  isEnabled = !!envLog && envLog !== '';
  const levelStr = envLevel || 'info';
  minLevel = LOG_LEVELS[levelStr] ?? LOG_LEVELS.info;
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
  // error 始终记录，其余需要 OPENTEAM_LOG=1
  if (!isEnabled && level !== 'error') return;
  if (LOG_LEVELS[level] < minLevel) return;

  const formatted = formatMessage(level, module, message, data);
  writeToFile(formatted);
}

export function createLogger(module) {
  return {
    debug: (message, data) => log('debug', module, message, data),
    info: (message, data) => log('info', module, message, data),
    warn: (message, data) => log('warn', module, message, data),
    error: (message, data) => log('error', module, message, data),
  };
}

