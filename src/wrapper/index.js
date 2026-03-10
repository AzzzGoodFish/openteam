#!/usr/bin/env node

/**
 * Wrapper Client — pane 内运行，桥接 openteam server <-> CLI
 *
 * 生命周期：
 *   1. 向 server 注册 agent
 *   2. 写入 MCP 配置文件
 *   3. 启动 CLI 子进程（stdio: 'inherit'，CLI 接管终端）
 *   4. 轮询 server 拉取消息，通过 mux send-keys 注入 CLI
 *   5. CLI 退出时清理（注销 agent、停止轮询）
 *
 * 环境变量（由 daemon 创建 pane 时设置）：
 *   OPENTEAM_SERVER_URL  - openteam server 地址
 *   OPENTEAM_AGENT       - agent 名称
 *   OPENTEAM_TEAM        - 团队名称
 *   OPENTEAM_PROJECT_DIR - 项目目录
 *   OPENTEAM_CLI         - CLI 类型（claude-code / opencode）
 *   OPENTEAM_AGENTS      - 团队成员列表（逗号分隔，如 pm,architect,developer,qa）
 *   OPENTEAM_MUX         - mux 类型（tmux / zellij）
 *   OPENTEAM_SESSION     - mux session 名称
 *   OPENTEAM_PANE_ID     - 当前 pane ID（tmux 用）
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { createAdapter } from '../adapters/base.js';
import { pasteText } from '../foundation/terminal.js';
import { createLogger } from '../foundation/logger.js';

const log = createLogger('wrapper');
const POLL_INTERVAL = 1000;  // 消息轮询间隔 (ms)

async function main() {
  // ── 读取环境变量 ──
  const serverUrl = process.env.OPENTEAM_SERVER_URL;
  const agent = process.env.OPENTEAM_AGENT;
  const team = process.env.OPENTEAM_TEAM;
  const projectDir = process.env.OPENTEAM_PROJECT_DIR;
  const cliType = process.env.OPENTEAM_CLI;
  const agents = process.env.OPENTEAM_AGENTS?.split(',').filter(Boolean) || [];
  const mux = process.env.OPENTEAM_MUX;
  const sessionName = process.env.OPENTEAM_SESSION;
  const paneId = process.env.OPENTEAM_PANE_ID;

  if (!serverUrl || !agent || !cliType || !projectDir) {
    console.error('Missing required env vars: OPENTEAM_SERVER_URL, OPENTEAM_AGENT, OPENTEAM_CLI, OPENTEAM_PROJECT_DIR');
    process.exit(1);
  }

  log.info('wrapper.start', { agent, team, cliType, serverUrl });

  // ── 1. 向 server 注册 ──
  await register(serverUrl, agent);

  // ── 2. 写入 MCP 配置 ──
  const adapter = await createAdapter(cliType);
  const mcpConfigPath = writeMcpConfig(adapter, serverUrl, agent, projectDir);

  // ── 3. 构建系统提示词 ──
  const systemPrompt = buildSystemPrompt(agent, team, agents);

  // ── 4. 启动 CLI 子进程 ──
  const cliArgs = adapter.buildLaunchArgs({ agent, systemPrompt, mcpConfigPath, cwd: projectDir });
  log.info('wrapper.cli.launch', { args: cliArgs });

  const cliProcess = spawn(cliArgs[0], cliArgs.slice(1), {
    stdio: 'inherit',  // CLI 直接占据终端（stdin/stdout/stderr 透传）
    cwd: projectDir,
  });

  // ── 5. 启动消息轮询 ──
  let polling = true;
  const pollTimer = setInterval(async () => {
    if (!polling) return;
    try {
      const messages = await pullMessages(serverUrl, agent);
      for (const msg of messages) {
        injectMessage(mux, sessionName, paneId, msg.message);
      }
    } catch (err) {
      // server 可能暂时不可达，静默重试
      log.warn('wrapper.poll.error', { error: err.message });
    }
  }, POLL_INTERVAL);

  // ── 6. CLI 退出时清理 ──
  cliProcess.on('exit', async (code) => {
    polling = false;
    clearInterval(pollTimer);
    await unregister(serverUrl, agent);
    cleanupMcpConfig(mcpConfigPath);
    log.info('wrapper.exit', { agent, code });
    process.exit(code || 0);
  });

  // ── 7. 信号转发 ──
  process.on('SIGTERM', () => {
    log.info('wrapper.sigterm', { agent });
    cliProcess.kill('SIGTERM');
  });
  process.on('SIGINT', () => {
    log.info('wrapper.sigint', { agent });
    cliProcess.kill('SIGINT');
  });
}

// ── HTTP 辅助函数 ──

async function register(serverUrl, agent) {
  const res = await fetch(`${serverUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent }),
  });
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
  log.info('wrapper.registered', { agent });
}

async function unregister(serverUrl, agent) {
  try {
    await fetch(`${serverUrl}/api/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    log.info('wrapper.unregistered', { agent });
  } catch {
    // server 可能已关闭，忽略
  }
}

async function pullMessages(serverUrl, agent) {
  const res = await fetch(`${serverUrl}/api/messages/${encodeURIComponent(agent)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.messages || [];
}

// ── MCP 配置 ──

function writeMcpConfig(adapter, serverUrl, agent, projectDir) {
  const config = adapter.buildMcpConfig({ serverUrl, agent });
  const configPath = adapter.getMcpConfigPath(projectDir, agent);

  // 确保目录存在
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  log.info('wrapper.mcp.config.written', { path: configPath });
  return configPath;
}

function cleanupMcpConfig(configPath) {
  try {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  } catch {
    // 忽略清理失败
  }
}

// ── 系统提示词 ──

function buildSystemPrompt(agent, team, agents) {
  // 精简版协作规则，通过 --append-system-prompt 注入到 CLI
  const teammates = agents.filter(a => a !== agent);
  const lines = [
    `You are agent "${agent}" in team "${team}".`,
  ];
  if (agents.length > 0) {
    lines.push(`Team members: ${agents.join(', ')}. Your teammates: ${teammates.join(', ')}.`);
  }
  lines.push(
    'Use the msg tool to communicate with other agents.',
    'Messages without [from xxx] prefix are from the boss — reply directly in your output.',
    'Messages with [from <agent>] are from team agents — reply using msg tool.',
    'NEVER use msg(who="boss") — boss is in your session, not an agent.',
    'Use taskboard tool to manage tasks: create (leader only), done, list.',
  );
  return lines.join(' ');
}

// ── 消息注入 ──

function injectMessage(mux, sessionName, paneId, message) {
  if (!mux || !sessionName || !paneId) {
    log.warn('wrapper.inject.skip', { reason: 'missing mux/session/pane info' });
    return;
  }
  const ok = pasteText(mux, sessionName, paneId, message);
  if (!ok) {
    log.warn('wrapper.inject.failed', { mux, sessionName, paneId, preview: message.slice(0, 50) });
  }
}

main().catch(err => {
  console.error('wrapper fatal:', err.message);
  process.exit(1);
});
