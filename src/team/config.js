/**
 * Team and agent configuration management
 */

import fs from 'fs';
import path from 'path';
import { PATHS, FILES } from '../constants.js';

/**
 * Get team directory path
 */
export function getTeamDir(teamName) {
  return path.join(PATHS.AGENTS_DIR, teamName);
}

/**
 * Load team configuration
 */
export function loadTeamConfig(teamName) {
  const configPath = path.join(getTeamDir(teamName), FILES.TEAM_CONFIG);
  if (!fs.existsSync(configPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Load agent configuration (memory blocks config)
 */
export function loadAgentConfig(teamName, agentName) {
  const configPath = path.join(getTeamDir(teamName), agentName, FILES.AGENT_CONFIG);
  if (!fs.existsSync(configPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Get list of agents in a team
 */
export function getTeamAgents(teamName) {
  const config = loadTeamConfig(teamName);
  return config?.agents || [];
}

/**
 * Get team leader
 */
export function getTeamLeader(teamName) {
  const config = loadTeamConfig(teamName);
  return config?.leader || 'pm';
}

/**
 * Check if agent exists in team
 */
export function isAgentInTeam(teamName, agentName) {
  const agents = getTeamAgents(teamName);
  return agents.includes(agentName);
}

/**
 * List all teams
 */
export function listTeams() {
  if (!fs.existsSync(PATHS.AGENTS_DIR)) return [];

  const entries = fs.readdirSync(PATHS.AGENTS_DIR, { withFileTypes: true });
  const teams = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const teamConfigPath = path.join(PATHS.AGENTS_DIR, entry.name, FILES.TEAM_CONFIG);
    if (fs.existsSync(teamConfigPath)) {
      teams.push(entry.name);
    }
  }

  return teams;
}
