import os from 'os';
import path from 'path';

const homeDir = os.homedir();

export const PATHS = {
  OPENCODE_DIR: path.join(homeDir, '.opencode'),
  AGENTS_DIR: path.join(homeDir, '.opencode/agents'),
};

export const FILES = {
  TEAM_CONFIG: 'team.json',
  AGENT_CONFIG: 'agent.json',
  SESSIONS: 'sessions.json',
  RUNTIME: '.runtime.json',
  ACTIVE_SESSIONS: '.active-sessions.json',
};

export const EXTENSIONS = {
  MEMORY_BLOCK: '.mem',
  AGENT_PROMPT: '.md',
};

export const DEFAULTS = {
  PORT_RANGE_START: 4096,
  PORT_RANGE_END: 4200,
  HOST: '127.0.0.1',
  SESSION_HISTORY_LIMIT: 5,
  MAX_SESSIONS_STORED: 100,
  MEMORY_LIMIT: 2000,
  INDEX_SEPARATOR: '---',
};

export const MEMORY_TYPES = {
  RESIDENT: 'resident',
  INDEX: 'index',
  SESSIONS: 'sessions',
};
