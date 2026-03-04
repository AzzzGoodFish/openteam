/**
 * 运行时状态持久化（serve 进程信息 + agent session 映射）
 */

import fs from 'fs';
import path from 'path';
import { PATHS, FILES, DEFAULTS, getTeamDir } from './constants.js';

/**
 * Get runtime file path for a team
 */
function getRuntimePath(teamName) {
  return path.join(getTeamDir(teamName), FILES.RUNTIME);
}

/**
 * Load runtime configuration
 * 兼容新格式（daemon.pid）和旧格式（pid）
 */
export function getRuntime(teamName) {
  const runtimePath = getRuntimePath(teamName);
  if (!fs.existsSync(runtimePath)) return null;

  try {
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));

    // 新格式：检查 daemon PID；旧格式：检查 pid
    const checkPid = runtime.daemon?.pid || runtime.pid;
    if (checkPid) {
      try {
        process.kill(checkPid, 0);
        return runtime;
      } catch {
        fs.unlinkSync(runtimePath);
        return null;
      }
    }
    return runtime;
  } catch {
    return null;
  }
}

/**
 * Save runtime configuration
 */
export function saveRuntime(teamName, runtime) {
  const teamDir = getTeamDir(teamName);
  if (!fs.existsSync(teamDir)) {
    fs.mkdirSync(teamDir, { recursive: true });
  }
  fs.writeFileSync(getRuntimePath(teamName), JSON.stringify(runtime, null, 2));
}

/**
 * Clear runtime configuration
 */
export function clearRuntime(teamName) {
  const runtimePath = getRuntimePath(teamName);
  if (fs.existsSync(runtimePath)) {
    fs.unlinkSync(runtimePath);
  }
}

/**
 * Check if serve is running for a team
 * 兼容新格式（serve.pid）和旧格式（pid）
 */
export function isServeRunning(teamName) {
  const runtime = getRuntime(teamName);
  if (!runtime) return false;
  const servePid = runtime.serve?.pid || runtime.pid;
  if (!servePid) return false;
  try {
    process.kill(servePid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get serve URL for a team
 * 兼容新格式（serve.host/port）和旧格式（host/port）
 */
export function getServeUrl(teamName) {
  const runtime = getRuntime(teamName);
  if (!runtime) return null;
  const host = runtime.serve?.host || runtime.host;
  const port = runtime.serve?.port || runtime.port;
  if (!host || !port) return null;
  return `http://${host}:${port}`;
}

/**
 * Find active serve URL by scanning all teams
 */
export function findActiveServeUrl() {
  if (!fs.existsSync(PATHS.AGENTS_DIR)) {
    return `http://${DEFAULTS.HOST}:${DEFAULTS.PORT_RANGE_START}`;
  }

  const entries = fs.readdirSync(PATHS.AGENTS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runtimePath = path.join(PATHS.AGENTS_DIR, entry.name, FILES.RUNTIME);

    if (fs.existsSync(runtimePath)) {
      try {
        const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
        const checkPid = runtime.daemon?.pid || runtime.pid;
        const host = runtime.serve?.host || runtime.host;
        const port = runtime.serve?.port || runtime.port;
        if (checkPid && host && port) {
          try {
            process.kill(checkPid, 0);
            return `http://${host}:${port}`;
          } catch {
            // Process not running
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return `http://${DEFAULTS.HOST}:${DEFAULTS.PORT_RANGE_START}`;
}

/**
 * Find an available port
 */
export async function findAvailablePort() {
  const net = await import('net');

  for (let port = DEFAULTS.PORT_RANGE_START; port <= DEFAULTS.PORT_RANGE_END; port++) {
    const available = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port, DEFAULTS.HOST);
    });

    if (available) return port;
  }

  throw new Error('No available port found');
}

/**
 * Get active sessions file path
 */
function getActiveSessionsPath(teamName) {
  return path.join(getTeamDir(teamName), FILES.ACTIVE_SESSIONS);
}

/**
 * Load active sessions
 */
export function loadActiveSessions(teamName) {
  const sessionsPath = getActiveSessionsPath(teamName);
  if (!fs.existsSync(sessionsPath)) return {};

  try {
    return JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Save active sessions
 */
export function saveActiveSessions(teamName, sessions) {
  const teamDir = getTeamDir(teamName);
  if (!fs.existsSync(teamDir)) {
    fs.mkdirSync(teamDir, { recursive: true });
  }
  fs.writeFileSync(getActiveSessionsPath(teamName), JSON.stringify(sessions, null, 2));
}

/**
 * Get all instances for an agent
 * Returns array of { sessionId, cwd, alias? }
 */
export function getAgentInstances(teamName, agentName) {
  const sessions = loadActiveSessions(teamName);
  const instances = sessions[agentName];
  if (!instances) return [];
  // Handle legacy format (single sessionId string)
  if (typeof instances === 'string') {
    return [{ sessionId: instances, cwd: null }];
  }
  return instances;
}

/**
 * Find instance by cwd or alias
 * Returns { sessionId, cwd, alias? } or null
 */
export function findInstance(teamName, agentName, { cwd, alias }) {
  const instances = getAgentInstances(teamName, agentName);
  if (alias) {
    return instances.find((i) => i.alias === alias) || null;
  }
  if (cwd) {
    return instances.find((i) => i.cwd === cwd) || null;
  }
  return null;
}

/**
 * Add or update an instance for an agent
 */
export function addInstance(teamName, agentName, { sessionId, cwd, alias }) {
  const sessions = loadActiveSessions(teamName);
  let instances = sessions[agentName];

  // Handle legacy format
  if (!instances || typeof instances === 'string') {
    instances = [];
  }

  // Remove existing instance with same cwd
  instances = instances.filter((i) => i.cwd !== cwd);

  // Add new instance
  const newInstance = { sessionId, cwd };
  if (alias) newInstance.alias = alias;
  instances.push(newInstance);

  sessions[agentName] = instances;
  saveActiveSessions(teamName, sessions);
}

/**
 * Remove an instance by cwd or alias
 */
export function removeInstance(teamName, agentName, { cwd, alias }) {
  const sessions = loadActiveSessions(teamName);
  let instances = sessions[agentName];

  if (!instances || typeof instances === 'string') return;

  if (alias) {
    instances = instances.filter((i) => i.alias !== alias);
  } else if (cwd) {
    instances = instances.filter((i) => i.cwd !== cwd);
  }

  sessions[agentName] = instances;
  saveActiveSessions(teamName, sessions);
}

/**
 * Clear all instances for an agent
 */
export function clearAgentInstances(teamName, agentName) {
  const sessions = loadActiveSessions(teamName);
  sessions[agentName] = [];
  saveActiveSessions(teamName, sessions);
}

// Legacy compatibility
export function setActiveSession(teamName, agentName, sessionID, cwd = null) {
  addInstance(teamName, agentName, { sessionId: sessionID, cwd });
}

export function getActiveSession(teamName, agentName) {
  const instances = getAgentInstances(teamName, agentName);
  if (instances.length === 0) return null;
  return instances[0].sessionId;
}
