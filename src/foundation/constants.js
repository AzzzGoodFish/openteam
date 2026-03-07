import os from 'os';
import path from 'path';
import crypto from 'crypto';

const homeDir = os.homedir();

export const PATHS = {
  OPENCODE_DIR: path.join(homeDir, '.opencode'),
  AGENTS_DIR: path.join(homeDir, '.opencode/agents'),
  OPENTEAM_DIR: path.join(homeDir, '.openteam'),
  SETTINGS: path.join(homeDir, '.openteam', 'settings.json'),
};

export const FILES = {
  TEAM_CONFIG: 'team.json',
  RUNTIME: '.runtime.json',
  ACTIVE_SESSIONS: '.active-sessions.json',
};

export const DEFAULTS = {
  PORT_RANGE_START: 4096,
  PORT_RANGE_END: 4200,
  HOST: '127.0.0.1',
};

export function getTeamDir(teamName) {
  return path.join(PATHS.AGENTS_DIR, teamName);
}

/**
 * 计算项目目录的 SHA-256 哈希（前 8 位十六进制）
 */
export function projectDirHash(projectDir) {
  return crypto.createHash('sha256').update(projectDir).digest('hex').slice(0, 8);
}

/**
 * 获取团队的项目级状态目录（纯计算，不创建）
 * 路径: ~/.opencode/agents/<teamName>/<hash>/
 */
export function getTeamStateDir(teamName, projectDir) {
  return path.join(PATHS.AGENTS_DIR, teamName, projectDirHash(projectDir));
}
