import os from 'os';
import path from 'path';

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
