/**
 * Logger utility for openteam
 *
 * Enable logging by setting environment variable:
 *   OPENTEAM_LOG=1  - Enable logging (writes to file)
 *
 * Log level:
 *   OPENTEAM_LOG_LEVEL=debug|info|warn|error (default: info)
 *
 * Log file location: ~/.openteam/openteam.log
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Log configuration from environment
const LOG_MODE = process.env.OPENTEAM_LOG || '';
const LOG_LEVEL = process.env.OPENTEAM_LOG_LEVEL || 'info';

const isEnabled = LOG_MODE !== '';

const openteamDir = path.join(os.homedir(), '.openteam');
const logFilePath = path.join(openteamDir, 'openteam.log');
const minLevel = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.info;

/**
 * Format timestamp
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Format log message
 */
function formatMessage(level, module, message, data) {
  const ts = timestamp();
  const dataStr = data ? ' ' + JSON.stringify(data) : '';
  return `[${ts}] [${level.toUpperCase()}] [${module}] ${message}${dataStr}`;
}

// Ensure log directory exists (only once)
let dirEnsured = false;
function ensureLogDir() {
  if (dirEnsured) return;
  try {
    if (!fs.existsSync(openteamDir)) {
      fs.mkdirSync(openteamDir, { recursive: true });
    }
    dirEnsured = true;
  } catch {
    // Silently ignore
  }
}

/**
 * Write to log file
 */
function writeToFile(formatted) {
  try {
    ensureLogDir();
    fs.appendFileSync(logFilePath, formatted + '\n');
  } catch {
    // Silently ignore write errors
  }
}

/**
 * Core log function
 */
function log(level, module, message, data = null) {
  if (!isEnabled) return;
  if (LOG_LEVELS[level] < minLevel) return;

  const formatted = formatMessage(level, module, message, data);
  writeToFile(formatted);
}

/**
 * Create a logger instance for a specific module
 */
export function createLogger(module) {
  return {
    debug: (message, data) => log('debug', module, message, data),
    info: (message, data) => log('info', module, message, data),
    warn: (message, data) => log('warn', module, message, data),
    error: (message, data) => log('error', module, message, data),
  };
}

/**
 * Get log file path
 */
export function getLogFilePath() {
  return logFilePath;
}

/**
 * Clear log file
 */
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

/**
 * Check if logging is enabled
 */
export function isLoggingEnabled() {
  return isEnabled;
}
