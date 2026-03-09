/**
 * 统一状态持久化（合并原 .runtime.json + .active-sessions.json → .state.json）
 * 状态文件在 shutdown 后保留，停止的实例仍可被扫描发现
 */

import fs from 'fs';
import path from 'path';
import { PATHS, FILES, DEFAULTS, getTeamDir, getTeamStateDir } from './constants.js';
import { createLogger } from './logger.js';

const log = createLogger('state');

// ─── 核心读写 ───────────────────────────────────────────────

function getStatePath(teamName, projectDir) {
  return path.join(getTeamStateDir(teamName, projectDir), FILES.STATE);
}

/**
 * 读取统一状态文件，含旧文件自动迁移
 */
function loadState(teamName, projectDir) {
  const statePath = getStatePath(teamName, projectDir);

  if (fs.existsSync(statePath)) {
    try {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      return {};
    }
  }

  // 迁移旧格式文件
  const stateDir = getTeamStateDir(teamName, projectDir);
  const oldRuntimePath = path.join(stateDir, FILES.RUNTIME);
  const oldSessionsPath = path.join(stateDir, FILES.ACTIVE_SESSIONS);

  const state = {};
  if (fs.existsSync(oldRuntimePath)) {
    try { Object.assign(state, JSON.parse(fs.readFileSync(oldRuntimePath, 'utf8'))); } catch {}
  }
  if (fs.existsSync(oldSessionsPath)) {
    try { state.sessions = JSON.parse(fs.readFileSync(oldSessionsPath, 'utf8')); } catch {}
  }

  if (Object.keys(state).length > 0) {
    saveState(teamName, projectDir, state);
    try { if (fs.existsSync(oldRuntimePath)) fs.unlinkSync(oldRuntimePath); } catch {}
    try { if (fs.existsSync(oldSessionsPath)) fs.unlinkSync(oldSessionsPath); } catch {}
  }

  return state;
}

function saveState(teamName, projectDir, state) {
  const stateDir = getTeamStateDir(teamName, projectDir);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  fs.writeFileSync(getStatePath(teamName, projectDir), JSON.stringify(state, null, 2));
}

// ─── Runtime 格式兼容 ───────────────────────────────────────

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

// ─── Runtime 函数 ───────────────────────────────────────────

/**
 * Load runtime configuration（返回 normalized 格式）
 */
export function getRuntime(teamName, projectDir, meta = null) {
  const state = loadState(teamName, projectDir);
  if (!state || Object.keys(state).length === 0) {
    if (meta?.trace) log.info('getRuntime.missing', { trace: meta.trace, teamName, reason: meta.reason });
    return null;
  }

  const runtime = normalizeRuntime(state);

  if (runtime.daemonPid) {
    try {
      process.kill(runtime.daemonPid, 0);
      if (meta?.trace) {
        log.info('getRuntime.hit', {
          trace: meta.trace,
          teamName,
          daemonPid: runtime.daemonPid,
          serveHost: runtime.serveHost,
          servePort: runtime.servePort,
          reason: meta.reason,
        });
      }
      return runtime;
    } catch {
      if (meta?.trace) log.warn('getRuntime.stalePid', { trace: meta.trace, teamName, daemonPid: runtime.daemonPid, reason: meta.reason });
      // 不删除文件 — 状态文件持久保留
      return null;
    }
  }

  // 无 daemonPid 说明实例已停止
  return null;
}

/**
 * Save runtime configuration（保留 sessions）
 */
export function saveRuntime(teamName, projectDir, runtimeData) {
  const state = loadState(teamName, projectDir);
  const sessions = state.sessions || {};
  saveState(teamName, projectDir, { ...runtimeData, sessions });
}

/**
 * Clear runtime configuration（保留 projectDir/team/sessions/started）
 */
export function clearRuntime(teamName, projectDir) {
  const state = loadState(teamName, projectDir);
  if (!state || Object.keys(state).length === 0) return;
  saveState(teamName, projectDir, {
    projectDir: state.projectDir,
    team: state.team,
    started: state.started,
    sessions: state.sessions || {},
  });
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

// ─── Session 函数 ───────────────────────────────────────────

/**
 * Load active sessions（读取时统一格式：每个 agent → [{ sessionId, cwd, ... }]）
 */
export function loadActiveSessions(teamName, projectDir) {
  const state = loadState(teamName, projectDir);
  const raw = state.sessions || {};

  // 统一旧格式（agent → "sessionId" 字符串）为数组
  for (const [agent, value] of Object.entries(raw)) {
    if (typeof value === 'string') {
      raw[agent] = [{ sessionId: value, cwd: null }];
    } else if (!Array.isArray(value)) {
      raw[agent] = [];
    }
  }
  return raw;
}

/**
 * Save active sessions（保留 runtime 字段）
 */
export function saveActiveSessions(teamName, projectDir, sessions) {
  const state = loadState(teamName, projectDir);
  state.sessions = sessions;
  saveState(teamName, projectDir, state);
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

// ─── 扫描函数 ───────────────────────────────────────────────

/**
 * 扫描团队的所有实例（含运行中和已停止的）
 * @returns {Array<{ projectDir: string, runtime: object|null, hash: string, alive: boolean, started: string|null }>}
 */
export function listInstances(teamName) {
  const teamDir = getTeamDir(teamName);
  if (!fs.existsSync(teamDir)) return [];

  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(teamDir, { withFileTypes: true });
  } catch { return []; }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const statePath = path.join(teamDir, entry.name, FILES.STATE);
    if (!fs.existsSync(statePath)) continue;

    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const runtime = normalizeRuntime(state);
      let alive = false;

      if (runtime?.daemonPid) {
        try {
          process.kill(runtime.daemonPid, 0);
          alive = true;
        } catch {}
      }

      results.push({
        projectDir: state.projectDir ?? null,
        runtime: alive ? runtime : null,
        hash: entry.name,
        alive,
        started: state.started ?? null,
      });
    } catch {}
  }

  return results;
}

/**
 * 扫描团队的所有运行实例（按 hash 子目录）
 * @returns {Array<{ projectDir: string, runtime: object, hash: string }>}
 */
export function listRunningInstances(teamName) {
  return listInstances(teamName).filter(i => i.alive);
}

/**
 * 扫描所有团队的所有实例（含运行中和已停止的）
 */
export function listAllInstances() {
  if (!fs.existsSync(PATHS.AGENTS_DIR)) return [];
  const results = [];
  let teamDirs;
  try {
    teamDirs = fs.readdirSync(PATHS.AGENTS_DIR, { withFileTypes: true });
  } catch { return []; }

  for (const teamEntry of teamDirs) {
    if (!teamEntry.isDirectory()) continue;
    const teamName = teamEntry.name;
    for (const inst of listInstances(teamName)) {
      results.push({ teamName, ...inst });
    }
  }
  return results;
}

/**
 * 扫描所有团队的所有运行实例
 * @returns {Array<{ teamName: string, projectDir: string, runtime: object, hash: string }>}
 */
export function listAllRunningInstances() {
  return listAllInstances().filter(i => i.alive);
}
