/**
 * 运行时状态持久化（serve 进程信息 + agent session 映射）
 */

import fs from 'fs';
import path from 'path';
import { PATHS, FILES, DEFAULTS, getTeamDir, getTeamStateDir } from './constants.js';
import { createLogger } from './logger.js';

const log = createLogger('state');

/**
 * 获取运行时文件路径（项目级）
 */
function getRuntimePath(teamName, projectDir) {
  return path.join(getTeamStateDir(teamName, projectDir), FILES.RUNTIME);
}

/**
 * 统一 runtime 格式（兼容旧格式 { pid, host, port } → 新格式 { daemon, serve, ... }）
 * 所有消费者使用 normalized 字段，旧格式映射集中在此一处
 */
function normalizeRuntime(raw) {
  if (!raw) return null;
  return {
    daemonPid:  raw.daemon?.pid  ?? raw.pid  ?? null,
    servePid:   raw.serve?.pid   ?? raw.pid  ?? null,
    serveHost:  raw.serve?.host  ?? raw.host ?? null,
    servePort:  raw.serve?.port  ?? raw.port ?? null,
    mux:        raw.mux        ?? null,
    projectDir: raw.projectDir ?? null,
    started:    raw.started    ?? null,
    team:       raw.team       ?? null,
    _raw: raw,
  };
}

/**
 * Load runtime configuration（返回 normalized 格式）
 */
export function getRuntime(teamName, projectDir, meta = null) {
  const runtimePath = getRuntimePath(teamName, projectDir);
  if (!fs.existsSync(runtimePath)) {
    if (meta?.trace) log.info('getRuntime.missing', { trace: meta.trace, teamName, runtimePath, reason: meta.reason });
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    const runtime = normalizeRuntime(raw);

    if (runtime.daemonPid) {
      try {
        process.kill(runtime.daemonPid, 0);
        if (meta?.trace) {
          log.info('getRuntime.hit', {
            trace: meta.trace,
            teamName,
            runtimePath,
            daemonPid: runtime.daemonPid,
            serveHost: runtime.serveHost,
            servePort: runtime.servePort,
            reason: meta.reason,
          });
        }
        return runtime;
      } catch {
        if (meta?.trace) log.warn('getRuntime.stalePid', { trace: meta.trace, teamName, runtimePath, daemonPid: runtime.daemonPid, reason: meta.reason });
        fs.unlinkSync(runtimePath);
        return null;
      }
    }
    if (meta?.trace) log.info('getRuntime.noPid', { trace: meta.trace, teamName, runtimePath, reason: meta.reason });
    return runtime;
  } catch {
    if (meta?.trace) log.error('getRuntime.parseFailed', { trace: meta.trace, teamName, runtimePath, reason: meta.reason });
    return null;
  }
}

/**
 * Save runtime configuration
 */
export function saveRuntime(teamName, projectDir, runtime) {
  const stateDir = getTeamStateDir(teamName, projectDir);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  fs.writeFileSync(getRuntimePath(teamName, projectDir), JSON.stringify(runtime, null, 2));
}

/**
 * Clear runtime configuration
 */
export function clearRuntime(teamName, projectDir) {
  const runtimePath = getRuntimePath(teamName, projectDir);
  if (fs.existsSync(runtimePath)) {
    fs.unlinkSync(runtimePath);
  }
}

/**
 * Check if serve is running for a team
 */
export function isServeRunning(teamName, projectDir) {
  const runtime = getRuntime(teamName, projectDir);
  if (!runtime?.servePid) return false;
  try {
    process.kill(runtime.servePid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get serve URL for a team
 */
export function getServeUrl(teamName, projectDir, meta = null) {
  const runtime = getRuntime(teamName, projectDir, meta);
  if (!runtime) {
    if (meta?.trace) log.warn('getServeUrl.runtimeMissing', { trace: meta.trace, teamName, reason: meta.reason });
    return null;
  }
  if (!runtime.serveHost || !runtime.servePort) {
    if (meta?.trace) log.warn('getServeUrl.incompleteRuntime', { trace: meta.trace, teamName, host: runtime.serveHost, port: runtime.servePort, reason: meta.reason });
    return null;
  }
  const url = `http://${runtime.serveHost}:${runtime.servePort}`;
  if (meta?.trace) log.info('getServeUrl.hit', { trace: meta.trace, teamName, url, reason: meta.reason });
  return url;
}

/**
 * Find active serve URL by scanning all teams（嵌套扫描 <team>/<hash>/.runtime.json）
 */
export function findActiveServeUrl(meta = null) {
  if (!fs.existsSync(PATHS.AGENTS_DIR)) {
    const fallback = `http://${DEFAULTS.HOST}:${DEFAULTS.PORT_RANGE_START}`;
    if (meta?.trace) log.warn('findActiveServeUrl.agentsDirMissing', { trace: meta.trace, fallback, reason: meta.reason });
    return fallback;
  }

  const teamDirs = fs.readdirSync(PATHS.AGENTS_DIR, { withFileTypes: true });

  for (const teamEntry of teamDirs) {
    if (!teamEntry.isDirectory()) continue;
    const teamDir = path.join(PATHS.AGENTS_DIR, teamEntry.name);

    // 扫描 hash 子目录
    let hashDirs;
    try {
      hashDirs = fs.readdirSync(teamDir, { withFileTypes: true });
    } catch { continue; }

    for (const hashEntry of hashDirs) {
      if (!hashEntry.isDirectory()) continue;
      const runtimePath = path.join(teamDir, hashEntry.name, FILES.RUNTIME);

      if (!fs.existsSync(runtimePath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
        const rt = normalizeRuntime(raw);
        if (rt.daemonPid && rt.serveHost && rt.servePort) {
          try {
            process.kill(rt.daemonPid, 0);
            const url = `http://${rt.serveHost}:${rt.servePort}`;
            if (meta?.trace) {
              log.info('findActiveServeUrl.hit', {
                trace: meta.trace,
                teamName: teamEntry.name,
                url,
                daemonPid: rt.daemonPid,
                reason: meta.reason,
              });
            }
            return url;
          } catch {
            // Process not running
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  const fallback = `http://${DEFAULTS.HOST}:${DEFAULTS.PORT_RANGE_START}`;
  if (meta?.trace) log.warn('findActiveServeUrl.fallback', { trace: meta.trace, fallback, reason: meta.reason });
  return fallback;
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
 * 获取活跃会话文件路径（项目级）
 */
function getActiveSessionsPath(teamName, projectDir) {
  return path.join(getTeamStateDir(teamName, projectDir), FILES.ACTIVE_SESSIONS);
}

/**
 * Load active sessions（读取时统一格式：每个 agent → [{ sessionId, cwd, ... }]）
 */
export function loadActiveSessions(teamName, projectDir) {
  const sessionsPath = getActiveSessionsPath(teamName, projectDir);
  if (!fs.existsSync(sessionsPath)) return {};

  try {
    const raw = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    // 统一旧格式（agent → "sessionId" 字符串）为数组
    for (const [agent, value] of Object.entries(raw)) {
      if (typeof value === 'string') {
        raw[agent] = [{ sessionId: value, cwd: null }];
      } else if (!Array.isArray(value)) {
        raw[agent] = [];
      }
    }
    return raw;
  } catch {
    return {};
  }
}

/**
 * Save active sessions
 */
export function saveActiveSessions(teamName, projectDir, sessions) {
  const stateDir = getTeamStateDir(teamName, projectDir);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  fs.writeFileSync(getActiveSessionsPath(teamName, projectDir), JSON.stringify(sessions, null, 2));
}

/**
 * Get all instances for an agent
 * Returns array of { sessionId, cwd, alias? }
 */
export function getAgentInstances(teamName, projectDir, agentName) {
  const sessions = loadActiveSessions(teamName, projectDir);
  return sessions[agentName] || [];
}

/**
 * Find instance by cwd or alias
 * Returns { sessionId, cwd, alias? } or null
 */
export function findInstance(teamName, projectDir, agentName, { cwd, alias }) {
  const instances = getAgentInstances(teamName, projectDir, agentName);
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
export function addInstance(teamName, projectDir, agentName, { sessionId, cwd, alias }) {
  const sessions = loadActiveSessions(teamName, projectDir);
  let instances = sessions[agentName] || [];

  // Remove existing instance with same cwd
  instances = instances.filter((i) => i.cwd !== cwd);

  // Add new instance
  const newInstance = { sessionId, cwd };
  if (alias) newInstance.alias = alias;
  instances.push(newInstance);

  sessions[agentName] = instances;
  saveActiveSessions(teamName, projectDir, sessions);
}

/**
 * Remove an instance by cwd or alias
 */
export function removeInstance(teamName, projectDir, agentName, { cwd, alias }) {
  const sessions = loadActiveSessions(teamName, projectDir);
  let instances = sessions[agentName];

  if (!instances || instances.length === 0) return;

  if (alias) {
    instances = instances.filter((i) => i.alias !== alias);
  } else if (cwd) {
    instances = instances.filter((i) => i.cwd !== cwd);
  }

  sessions[agentName] = instances;
  saveActiveSessions(teamName, projectDir, sessions);
}

/**
 * 扫描团队的所有运行实例（按 hash 子目录）
 * @returns {Array<{ projectDir: string, runtime: object, hash: string }>}
 */
export function listRunningInstances(teamName) {
  const teamDir = getTeamDir(teamName);
  if (!fs.existsSync(teamDir)) return [];

  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(teamDir, { withFileTypes: true });
  } catch { return []; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runtimePath = path.join(teamDir, entry.name, FILES.RUNTIME);
    if (!fs.existsSync(runtimePath)) continue;

    try {
      const raw = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
      const runtime = normalizeRuntime(raw);
      if (!runtime.daemonPid) continue;

      process.kill(runtime.daemonPid, 0); // 检查进程存活
      results.push({
        projectDir: runtime.projectDir,
        runtime,
        hash: entry.name,
      });
    } catch {
      // 进程不存在或解析失败，跳过
    }
  }

  return results;
}
