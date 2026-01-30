/**
 * Global settings for openteam
 *
 * 配置文件位置: ~/.openteam/settings.json
 *
 * 示例:
 * {
 *   "log": {
 *     "enabled": true,
 *     "level": "info"
 *   }
 * }
 */

import fs from 'fs';
import path from 'path';
import { PATHS } from '../constants.js';

const DEFAULT_SETTINGS = {
  log: {
    enabled: false,
    level: 'info',
  },
};

let cachedSettings = null;

/**
 * 加载 settings.json，不存在则返回默认值
 */
export function loadSettings() {
  if (cachedSettings) return cachedSettings;

  if (!fs.existsSync(PATHS.SETTINGS)) {
    cachedSettings = { ...DEFAULT_SETTINGS };
    return cachedSettings;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(PATHS.SETTINGS, 'utf8'));
    cachedSettings = {
      log: {
        ...DEFAULT_SETTINGS.log,
        ...raw?.log,
      },
    };
    return cachedSettings;
  } catch {
    cachedSettings = { ...DEFAULT_SETTINGS };
    return cachedSettings;
  }
}

/**
 * 清除缓存，下次 loadSettings 会重新读文件
 */
export function clearSettingsCache() {
  cachedSettings = null;
}

/**
 * 初始化 settings.json（如果不存在则创建默认文件）
 */
export function initSettings() {
  if (fs.existsSync(PATHS.SETTINGS)) return;

  const dir = path.dirname(PATHS.SETTINGS);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(PATHS.SETTINGS, JSON.stringify(DEFAULT_SETTINGS, null, 2) + '\n');
}
