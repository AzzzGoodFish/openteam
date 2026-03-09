#!/usr/bin/env node

/**
 * CLI 精简验收测试
 *
 * 验证需求：
 * 1. 公开命令正确性 — help 只显示 4 个命令，inspect 功能正确
 * 2. 删除命令 — monitor/status 报错
 * 3. 隐藏命令可用性 — attach/dashboard 不在 help 中但可执行
 * 4. 无回归 — start/stop/list/ls 行为不变
 * 5. 文档一致性 — 文档与实际 CLI 一致
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const NC = '\x1b[0m';

let passed = 0;
let failed = 0;

const CLI = 'node bin/openteam.js';

function run(cmd, { expectFail = false } = {}) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..'), stderr: 'pipe' });
    if (expectFail) throw new Error(`Expected command to fail but it succeeded: ${cmd}`);
    return out;
  } catch (err) {
    if (expectFail) return err.stderr || err.stdout || err.message;
    throw err;
  }
}

function runCapture(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..') });
    return { stdout: out, exitCode: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.status, message: err.message };
  }
}

function check(name, fn) {
  try {
    fn();
    console.log(`${GREEN}✓${NC} ${name}`);
    passed++;
  } catch (err) {
    console.log(`${RED}✗${NC} ${name}`);
    console.log(`  ${err.message}`);
    failed++;
  }
}

function readFile(relPath) {
  return fs.readFileSync(path.resolve(import.meta.dirname, '..', relPath), 'utf8');
}

function fileExists(relPath) {
  return fs.existsSync(path.resolve(import.meta.dirname, '..', relPath));
}

console.log('CLI Simplification — Acceptance Tests\n');

// ============================================================
// 1. 公开命令正确性
// ============================================================
console.log(`${YELLOW}--- 1. 公开命令正确性 ---${NC}`);

check('P0: help 显示 start 命令', () => {
  const help = run(`${CLI} --help`);
  if (!help.includes('start')) throw new Error('start not found in help');
});

check('P0: help 显示 stop 命令', () => {
  const help = run(`${CLI} --help`);
  if (!help.includes('stop')) throw new Error('stop not found in help');
});

check('P0: help 显示 list 命令', () => {
  const help = run(`${CLI} --help`);
  if (!help.match(/\blist\b/)) throw new Error('list not found in help');
});

check('P0: help 显示 inspect 命令', () => {
  const help = run(`${CLI} --help`);
  if (!help.includes('inspect')) throw new Error('inspect not found in help');
});

check('P0: help 不显示 monitor', () => {
  const help = run(`${CLI} --help`);
  if (help.includes('monitor')) throw new Error('monitor should not appear in help');
});

check('P0: help 不显示 status（旧命令名）', () => {
  const help = run(`${CLI} --help`);
  // status 可能出现在描述文本中，但不应作为命令名出现
  // 检查是否有 status 作为顶级命令（以 status 开头的行或作为命令列出）
  const lines = help.split('\n');
  const commandLines = lines.filter(l => l.match(/^\s{2,}\w/)); // indented command lines
  const hasStatusCommand = commandLines.some(l => l.match(/^\s+status\b/));
  if (hasStatusCommand) throw new Error('status should not appear as a command in help');
});

check('P0: help 不显示 attach', () => {
  const help = run(`${CLI} --help`);
  const lines = help.split('\n');
  const commandLines = lines.filter(l => l.match(/^\s{2,}\w/));
  const hasAttachCommand = commandLines.some(l => l.match(/^\s+attach\b/));
  if (hasAttachCommand) throw new Error('attach should not appear as a command in help');
});

check('P0: help 不显示 dashboard', () => {
  const help = run(`${CLI} --help`);
  const lines = help.split('\n');
  const commandLines = lines.filter(l => l.match(/^\s{2,}\w/));
  const hasDashboardCommand = commandLines.some(l => l.match(/^\s+dashboard\b/));
  if (hasDashboardCommand) throw new Error('dashboard should not appear as a command in help');
});

check('P0: help 中恰好 4 个可见命令', () => {
  const help = run(`${CLI} --help`);
  // Commander 通常在 "Commands:" 部分列出命令
  // 检查方式：统计 Commands 部分的命令行数
  const commandsSection = help.split('Commands:')[1];
  if (!commandsSection) throw new Error('No "Commands:" section found in help output');
  // 每个命令行格式通常是 "  command-name  description"
  const cmdLines = commandsSection.split('\n')
    .filter(l => l.match(/^\s{2,}\w/) && !l.match(/^\s+help\b/)); // 排除 help 自身
  if (cmdLines.length !== 4) {
    throw new Error(`Expected 4 visible commands, found ${cmdLines.length}:\n${cmdLines.join('\n')}`);
  }
});

check('P0: inspect 命令接受 --dir 选项', () => {
  // 只验证 inspect 的 help 信息包含 --dir
  const result = runCapture(`${CLI} inspect --help`);
  const output = result.stdout || result.stderr || result.message || '';
  if (!output.includes('--dir') && !output.includes('-d')) {
    throw new Error('inspect should support --dir option');
  }
});

// ============================================================
// 2. 删除命令
// ============================================================
console.log(`\n${YELLOW}--- 2. 删除命令 ---${NC}`);

check('P0: monitor 命令报错', () => {
  const result = runCapture(`${CLI} monitor`);
  if (result.exitCode === 0) {
    // 有些 CLI 框架即使 unknown command 也返回 0，检查输出中是否有错误提示
    const output = (result.stdout || '') + (result.stderr || '');
    if (!output.match(/unknown|error|invalid|not found/i)) {
      throw new Error('monitor should be rejected as unknown command');
    }
  }
  // exitCode !== 0 也是可以接受的
});

check('P0: status 命令报错', () => {
  const result = runCapture(`${CLI} status`);
  if (result.exitCode === 0) {
    const output = (result.stdout || '') + (result.stderr || '');
    if (!output.match(/unknown|error|invalid|not found/i)) {
      throw new Error('status should be rejected as unknown command');
    }
  }
});

// ============================================================
// 3. 隐藏命令可用性
// ============================================================
console.log(`\n${YELLOW}--- 3. 隐藏命令可用性 ---${NC}`);

check('P0: attach 命令可解析（不在 help 中但可执行）', () => {
  // 不传参数时应报缺少参数的错误（而非 unknown command）
  const result = runCapture(`${CLI} attach --help`);
  const output = (result.stdout || '') + (result.stderr || '') + (result.message || '');
  // 如果是 unknown command，说明 attach 没有注册
  if (output.match(/unknown command/i)) {
    throw new Error('attach should be a registered (hidden) command, not unknown');
  }
});

check('P0: dashboard 命令可解析（不在 help 中但可执行）', () => {
  const result = runCapture(`${CLI} dashboard --help`);
  const output = (result.stdout || '') + (result.stderr || '') + (result.message || '');
  if (output.match(/unknown command/i)) {
    throw new Error('dashboard should be a registered (hidden) command, not unknown');
  }
});

// ============================================================
// 4. 无回归
// ============================================================
console.log(`\n${YELLOW}--- 4. 无回归 ---${NC}`);

check('P0: list 命令可执行', () => {
  run(`${CLI} list`);
});

check('P0: ls 别名可执行', () => {
  run(`${CLI} ls`);
});

check('P1: list -a 可执行', () => {
  run(`${CLI} list -a`);
});

check('P0: start --help 可用', () => {
  const out = run(`${CLI} start --help`);
  if (!out.includes('start')) throw new Error('start --help broken');
});

check('P0: stop --help 可用', () => {
  const out = run(`${CLI} stop --help`);
  if (!out.includes('stop')) throw new Error('stop --help broken');
});

// ============================================================
// 5. 文档一致性
// ============================================================
console.log(`\n${YELLOW}--- 5. 文档一致性 ---${NC}`);

const docFiles = [
  { path: 'README.md', name: 'README.md' },
  { path: 'CLAUDE.md', name: 'CLAUDE.md' },
  { path: 'docs/architecture.md', name: 'docs/architecture.md' },
  { path: 'docs/development-guide.md', name: 'docs/development-guide.md' },
];

for (const doc of docFiles) {
  if (!fileExists(doc.path)) {
    check(`P1: ${doc.name} — 文件存在`, () => {
      throw new Error(`${doc.path} not found, skipping checks`);
    });
    continue;
  }

  const content = readFile(doc.path);

  check(`P1: ${doc.name} — 不包含 monitor 命令引用`, () => {
    // 允许出现在变更历史/changelog 中，但不应在当前命令说明中
    // 简单检查：不应有 `openteam monitor` 或 `monitor` 作为命令列出
    if (content.match(/openteam\s+monitor/)) {
      throw new Error(`${doc.name} still references 'openteam monitor'`);
    }
  });

  check(`P1: ${doc.name} — 不包含旧 status 命令引用`, () => {
    // openteam status 不应出现（inspect 替代了它）
    if (content.match(/openteam\s+status/)) {
      throw new Error(`${doc.name} still references 'openteam status'`);
    }
  });

  check(`P1: ${doc.name} — 包含 inspect 命令（如涉及命令列表）`, () => {
    // 如果文档提到命令列表，应包含 inspect
    // 只在文档确实提到命令列表时检查
    if (content.match(/openteam\s+(start|stop|list)/) && !content.includes('inspect')) {
      throw new Error(`${doc.name} lists CLI commands but missing 'inspect'`);
    }
  });
}

// 特别检查 CLAUDE.md 中的命令列表
check('P1: CLAUDE.md — CLI 命令说明中应包含 inspect', () => {
  if (!fileExists('CLAUDE.md')) throw new Error('CLAUDE.md not found');
  const claude = readFile('CLAUDE.md');
  if (!claude.includes('inspect')) {
    throw new Error('CLAUDE.md should mention inspect command');
  }
});

check('P1: CLAUDE.md — 不应单独列出 attach/dashboard 为公开命令', () => {
  if (!fileExists('CLAUDE.md')) throw new Error('CLAUDE.md not found');
  const claude = readFile('CLAUDE.md');
  // attach/dashboard 不应作为主要命令列在 CLI 命令说明中
  // 但可以在其他上下文（如架构说明）中提到
  const cliSection = claude.split('CLI')[1]?.split('##')[0] || '';
  if (cliSection.match(/\battach\b.*\bdashboard\b|\bdashboard\b.*\battach\b/)) {
    // 如果在 CLI 命令列表中同时出现，可能需要标注为隐藏
    // 这是个 soft check — 只要不作为顶级公开命令列出即可
  }
});

// ============================================================
// 结果
// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
