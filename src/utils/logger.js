/**
 * Logger utility for openteam
 *
 * 配置优先级: 环境变量 > settings.json > 默认值
 *
 * 环境变量（覆盖 settings）:
 *   OPENTEAM_LOG=1       启用日志
 *   OPENTEAM_LOG_LEVEL=debug|info|warn|error
 *
 * settings.json:
 *   { "log": { "enabled": true, "level": "info" } }
 *
 * 日志文件: ~/.openteam/openteam.log
 */

import fs from 'fs';
import path from 'path';
import { PATHS } from '../constants.js';

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

  // 先读 settings.json（直接读文件，避免循环依赖 settings.js）
  let settings = {};
  try {
    if (fs.existsSync(PATHS.SETTINGS)) {
      settings = JSON.parse(fs.readFileSync(PATHS.SETTINGS, 'utf8'));
    }
  } catch {
    // ignore
  }

  const envLog = process.env.OPENTEAM_LOG;
  const envLevel = process.env.OPENTEAM_LOG_LEVEL;

  isEnabled = envLog ? envLog !== '' : !!settings?.log?.enabled;
  const levelStr = envLevel || settings?.log?.level || 'info';
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

let dirEnsured = false;
function ensureLogDir() {
  if (dirEnsured) return;
  try {
    if (!fs.existsSync(PATHS.OPENTEAM_DIR)) {
      fs.mkdirSync(PATHS.OPENTEAM_DIR, { recursive: true });
    }
    dirEnsured = true;
  } catch {
    // ignore
  }
}

function writeToFile(formatted) {
  try {
    ensureLogDir();
    fs.appendFileSync(logFilePath, formatted + '\n');
  } catch {
    // ignore
  }
}

function log(level, module, message, data = null) {
  resolve();
  if (!isEnabled) return;
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

export function getLogFilePath() {
  return logFilePath;
}

export function clearLog() {
  try {
    if (fs.existsSync(logFilePath)) {
      fs.unlinkSync(logFilePath);
    }
    return true;
  } catch {
    return false;
  }
}

export function isLoggingEnabled() {
  resolve();
  return isEnabled;
}
