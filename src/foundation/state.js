/**
 * 统一状态持久化（.state.json）
 * 状态文件在 shutdown 后保留，停止的实例仍可被扫描发现
 *
 * v2: agent 在线状态由 server hub 内存管理（wrapper 注册/注销），
 * 不再需要 session 相关的文件持久化函数。
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
  const oldSessionsPath = path.join(stateDir, '.active-sessions.json');

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
 */
function normalizeRuntime(raw) {
  if (!raw) return null;
  const serverData = raw.server ?? raw.serve ?? null;  // 兼容旧格式
  return {
    daemon:     raw.daemon    ?? null,
    server:     serverData,
    daemonPid:  raw.daemon?.pid  ?? raw.pid  ?? null,
    serverPort: serverData?.port ?? raw.port ?? null,
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
          trace: meta.trace, teamName,
          daemonPid: runtime.daemonPid,
          reason: meta.reason,
        });
      }
      return runtime;
    } catch {
      if (meta?.trace) log.warn('getRuntime.stalePid', { trace: meta.trace, teamName, daemonPid: runtime.daemonPid, reason: meta.reason });
      return null;
    }
  }

  // 无 daemonPid 说明实例已停止
  return null;
}

/**
 * Save runtime configuration
 */
export function saveRuntime(teamName, projectDir, runtimeData) {
  saveState(teamName, projectDir, runtimeData);
}

/**
 * Clear runtime configuration（保留 projectDir/team/started）
 */
export function clearRuntime(teamName, projectDir) {
  const state = loadState(teamName, projectDir);
  if (!state || Object.keys(state).length === 0) return;
  saveState(teamName, projectDir, {
    projectDir: state.projectDir,
    team: state.team,
    started: state.started,
  });
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
 * 扫描团队的所有运行实例
 */
export function listRunningInstances(teamName) {
  return listInstances(teamName).filter(i => i.alive);
}

/**
 * 扫描所有团队的所有实例（含运行中和已停止的）
 */
export function listAllInstances() {
  if (!fs.existsSync(PATHS.TEAMS_DIR)) return [];
  const results = [];
  let teamDirs;
  try {
    teamDirs = fs.readdirSync(PATHS.TEAMS_DIR, { withFileTypes: true });
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
 */
export function listAllRunningInstances() {
  return listAllInstances().filter(i => i.alive);
}
