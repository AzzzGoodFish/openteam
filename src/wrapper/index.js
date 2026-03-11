#!/usr/bin/env node

/**
 * Wrapper Client — pane 内运行，桥接 openteam server <-> CLI
 *
 * 生命周期：
 *   1. 向 server 注册 agent
 *   2. 写入 MCP 配置文件
 *   3. 创建 PTY，在 PTY 内启动 CLI（CLI 拥有真正的终端）
 *   4. 轮询 server 拉取消息，通过 PTY master 注入 CLI
 *   5. CLI 退出时清理（注销 agent、停止轮询）
 *
 * PTY 架构：
 *   wrapper 持有 PTY master，CLI 连接 PTY slave。
 *   消息注入 = 写入 PTY master（CLI 视为键盘输入）。
 *   与 mux 类型无关 — tmux/zellij 均走同一路径。
 *
 * 环境变量（由 daemon 创建 pane 时设置）：
 *   OPENTEAM_SERVER_URL  - openteam server 地址
 *   OPENTEAM_AGENT       - agent 名称
 *   OPENTEAM_TEAM        - 团队名称
 *   OPENTEAM_PROJECT_DIR - 项目目录
 *   OPENTEAM_CLI         - CLI 类型（claude-code / opencode）
 *   OPENTEAM_AGENTS      - 团队成员列表（逗号分隔）
 *   OPENTEAM_MUX         - mux 类型（tmux / zellij）
 *   OPENTEAM_SESSION     - mux session 名称
 */

import fs from 'fs';
import path from 'path';
import * as pty from 'node-pty';
import { createAdapter } from '../adapters/base.js';
import { createLogger } from '../foundation/logger.js';

const log = createLogger('wrapper');
const POLL_INTERVAL = 1000;

async function main() {
  // ── 读取环境变量 ──
  const serverUrl = process.env.OPENTEAM_SERVER_URL;
  const agent = process.env.OPENTEAM_AGENT;
  const team = process.env.OPENTEAM_TEAM;
  const projectDir = process.env.OPENTEAM_PROJECT_DIR;
  const cliType = process.env.OPENTEAM_CLI;
  const agents = process.env.OPENTEAM_AGENTS?.split(',').filter(Boolean) || [];
  const cliArgs = process.env.OPENTEAM_CLI_ARGS ? JSON.parse(process.env.OPENTEAM_CLI_ARGS) : [];

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

  // ── 4. 创建 PTY，启动 CLI ──
  const cliLaunchArgs = adapter.buildLaunchArgs({ agent, systemPrompt, mcpConfigPath, cwd: projectDir, extraArgs: cliArgs });
  log.info('wrapper.cli.launch', { args: cliLaunchArgs });

  const ptyProcess = pty.spawn(cliLaunchArgs[0], cliLaunchArgs.slice(1), {
    name: 'xterm-256color',
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    cwd: projectDir,
    env: process.env,
  });

  // PTY 输出 → pane stdout（CLI 界面显示）+ 活动追踪
  let lastPtyOutput = 0;
  const ACTIVE_THRESHOLD = 3000; // 3 秒内有 PTY 输出视为运行中

  ptyProcess.onData(data => {
    lastPtyOutput = Date.now();
    process.stdout.write(data);
  });

  // pane stdin → PTY（键盘输入转发给 CLI）
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on('data', data => {
    ptyProcess.write(data.toString());
  });

  // 终端 resize → PTY resize（保持 CLI TUI 布局正确）
  process.stdout.on('resize', () => {
    ptyProcess.resize(
      process.stdout.columns || 80,
      process.stdout.rows || 24,
    );
  });

  // ── 5. 启动消息轮询 ──
  let polling = true;
  const pollTimer = setInterval(async () => {
    if (!polling) return;
    try {
      // 上报活动状态
      const active = (Date.now() - lastPtyOutput) < ACTIVE_THRESHOLD;
      heartbeat(serverUrl, agent, active).catch(() => {});

      const messages = await pullMessages(serverUrl, agent);
      for (const msg of messages) {
        injectMessage(ptyProcess, msg.message);
      }
    } catch (err) {
      log.warn('wrapper.poll.error', { error: err.message });
    }
  }, POLL_INTERVAL);

  // ── 6. CLI 退出时清理 ──
  ptyProcess.onExit(async ({ exitCode }) => {
    polling = false;
    clearInterval(pollTimer);
    // 恢复 stdin
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    await unregister(serverUrl, agent);
    cleanupMcpConfig(mcpConfigPath);
    log.info('wrapper.exit', { agent, exitCode });
    process.exit(exitCode || 0);
  });

  // ── 7. 信号转发 ──
  process.on('SIGTERM', () => {
    log.info('wrapper.sigterm', { agent });
    ptyProcess.kill();
  });
  process.on('SIGINT', () => {
    log.info('wrapper.sigint', { agent });
    ptyProcess.kill();
  });
}

// ── 消息注入 ──

/**
 * 通过 PTY master 注入消息到 CLI
 * 使用 bracketed paste 模式，防止多行消息被逐行执行
 */
function injectMessage(ptyProcess, message) {
  try {
    // 消息中的 \n 保持原样 — claude code 中 \n(0x0a) = 换行，\r(0x0d) = 提交
    ptyProcess.write(message);
    // 延迟发送 Enter 提交 — 确保 TUI 完成文本渲染
    setTimeout(() => ptyProcess.write('\r'), 100);
    log.info('wrapper.inject.ok', { preview: message.slice(0, 50) });
  } catch (err) {
    log.warn('wrapper.inject.failed', { error: err.message, preview: message.slice(0, 50) });
  }
}

// ── HTTP 辅助函数 ──

async function register(serverUrl, agent) {
  const MAX_RETRIES = 30;
  const RETRY_INTERVAL = 1000;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${serverUrl}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      log.info('wrapper.registered', { agent, attempt });
      return;
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        throw new Error(`register failed after ${MAX_RETRIES} attempts: ${err.message}`);
      }
      log.info('wrapper.register.retry', { agent, attempt, error: err.message });
      await new Promise(r => setTimeout(r, RETRY_INTERVAL));
    }
  }
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

async function heartbeat(serverUrl, agent, active) {
  await fetch(`${serverUrl}/api/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, active }),
  });
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

main().catch(err => {
  console.error('wrapper fatal:', err.message);
  process.exit(1);
});
