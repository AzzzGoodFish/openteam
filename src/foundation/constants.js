import os from 'os';
import path from 'path';
import crypto from 'crypto';

const homeDir = os.homedir();

export const PATHS = {
  OPENTEAM_DIR: path.join(homeDir, '.openteam'),
  SETTINGS: path.join(homeDir, '.openteam', 'settings.json'),
  AGENTS_DEFS_DIR: path.join(homeDir, '.openteam', 'agents'),   // agent 定义（所有团队共享）
  SKILLS_DIR: path.join(homeDir, '.openteam', 'skills'),         // skill 定义
  TEAMS_DIR: path.join(homeDir, '.openteam', 'teams'),           // 团队配置 + 运行时状态
};

export const FILES = {
  TEAM_CONFIG: 'team.json',
  TEAM_PROMPT: 'team-prompt.md',
  STATE: '.state.json',
  RUNTIME: '.runtime.json',              // 迁移兼容用
  TASKS: '.tasks.json',
};

export const DEFAULTS = {
  PORT_RANGE_START: 4096,
  PORT_RANGE_END: 4200,
  HOST: '127.0.0.1',
};

export function getTeamDir(teamName) {
  return path.join(PATHS.TEAMS_DIR, teamName);
}

/**
 * 计算项目目录的 SHA-256 哈希（前 8 位十六进制）
 */
export function projectDirHash(projectDir) {
  return crypto.createHash('sha256').update(projectDir).digest('hex').slice(0, 8);
}

/**
 * 获取团队的项目级状态目录（纯计算，不创建）
 * 路径: ~/.openteam/teams/<teamName>/<hash>/
 */
export function getTeamStateDir(teamName, projectDir) {
  return path.join(PATHS.TEAMS_DIR, teamName, projectDirHash(projectDir));
}

/**
 * 获取团队实例的 mux session 名称
 */
export function getSessionName(teamName, projectDir) {
  return `openteam-${teamName}-${projectDirHash(projectDir)}`;
}

/**
 * 获取团队的 mux session 名称前缀（用于按前缀匹配/扫描）
 */
export function getSessionPrefix(teamName) {
  return `openteam-${teamName}-`;
}
