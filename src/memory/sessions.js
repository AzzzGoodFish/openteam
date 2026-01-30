/**
 * Session history management
 */

import fs from 'fs';
import path from 'path';
import { FILES, DEFAULTS } from '../constants.js';
import { getTeamDir, loadAgentConfig } from '../team/config.js';
import { listAllSessions } from '../utils/api.js';

/**
 * Get sessions file path for an agent
 */
function getSessionsPath(teamName, agentName) {
  return path.join(getTeamDir(teamName), agentName, FILES.SESSIONS);
}

/**
 * Load recent sessions for an agent
 */
export function loadSessions(teamName, agentName, limit = DEFAULTS.SESSION_HISTORY_LIMIT) {
  const sessionsPath = getSessionsPath(teamName, agentName);
  if (!fs.existsSync(sessionsPath)) return [];

  try {
    const data = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    return (data.sessions || []).slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Save a session record
 */
export function saveSession(teamName, agentName, sessionID, title) {
  const agentDir = path.join(getTeamDir(teamName), agentName);
  const sessionsPath = path.join(agentDir, FILES.SESSIONS);

  // Ensure directory exists
  if (!fs.existsSync(agentDir)) {
    fs.mkdirSync(agentDir, { recursive: true });
  }

  // Load existing sessions
  let data = { sessions: [] };
  if (fs.existsSync(sessionsPath)) {
    try {
      data = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    } catch {
      // Ignore parse errors
    }
  }

  // Check if session already exists
  const existingIndex = data.sessions.findIndex((s) => s.id === sessionID);
  const record = {
    id: sessionID,
    title: title || 'Untitled',
    time: Date.now(),
  };

  if (existingIndex >= 0) {
    data.sessions[existingIndex] = record;
  } else {
    data.sessions.unshift(record);
  }

  // Keep only the last N sessions
  data.sessions = data.sessions.slice(0, DEFAULTS.MAX_SESSIONS_STORED);

  fs.writeFileSync(sessionsPath, JSON.stringify(data, null, 2));
}

/**
 * Remove a session from records
 */
export function removeSession(teamName, agentName, sessionID) {
  const sessionsPath = getSessionsPath(teamName, agentName);
  if (!fs.existsSync(sessionsPath)) return;

  try {
    const data = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    const before = data.sessions?.length || 0;
    data.sessions = (data.sessions || []).filter((s) => s.id !== sessionID);

    if (data.sessions.length < before) {
      fs.writeFileSync(sessionsPath, JSON.stringify(data, null, 2));
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Validate and clean stale sessions
 */
export async function validateSessions(teamName, agentName, serveUrl) {
  const sessionsPath = getSessionsPath(teamName, agentName);
  if (!fs.existsSync(sessionsPath)) return;

  try {
    // Get all existing sessions from serve
    const allSessions = await listAllSessions(serveUrl);
    const existingIds = new Set(allSessions.map((s) => s.id));

    // Filter local records
    const data = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    const before = data.sessions?.length || 0;
    data.sessions = (data.sessions || []).filter((s) => existingIds.has(s.id));

    // Save if changed
    if (data.sessions.length < before) {
      fs.writeFileSync(sessionsPath, JSON.stringify(data, null, 2));
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Search sessions by query
 */
export function searchSessions(teamName, agentName, query, limit = 10) {
  const sessions = loadSessions(teamName, agentName, DEFAULTS.MAX_SESSIONS_STORED);
  const queryLower = query.toLowerCase();

  return sessions.filter((s) => s.title.toLowerCase().includes(queryLower)).slice(0, limit);
}

/**
 * Format sessions for system prompt injection
 */
export function formatSessionsPrompt(sessions) {
  if (sessions.length === 0) return '';

  let prompt = '<recent_sessions>\n';
  prompt += '最近你处理的会话：\n';

  sessions.forEach((session, i) => {
    const date = new Date(session.time).toLocaleDateString('zh-CN');
    prompt += `${i + 1}. ${session.title} (${date})\n`;
  });

  prompt += '</recent_sessions>';

  return prompt;
}

/**
 * Get auto inject limit from agent config
 */
export function getAutoInjectLimit(teamName, agentName) {
  const config = loadAgentConfig(teamName, agentName);
  return config?.session_history?.auto_inject_recent || DEFAULTS.SESSION_HISTORY_LIMIT;
}
