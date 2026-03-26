#!/usr/bin/env node

/**
 * ensureLinks 单元测试
 *
 * 使用临时目录模拟 ~/.openteam/{agents,skills} 和 ~/.claude/{agents,skills}。
 * 通过修改 PATHS 和 CLI_DIRS 常量来隔离测试环境。
 *
 * v2: 链接目标是全局目录（~/.claude/），不再是项目目录。
 * 每个测试前清空 fakeClaudeDir 保证隔离。
 *
 * 覆盖：
 * - 创建 agent symlink
 * - 幂等（重复调用跳过）
 * - 源不存在 → 警告不中止
 * - 目标是非 symlink 文件 → 冲突中止
 * - 更新指向别处的 symlink
 * - skill 目录链接
 * - 不支持的 cliType → 跳过
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const NC = '\x1b[0m';

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`${GREEN}  PASS${NC} ${name}`);
  } catch (e) {
    failed++;
    console.log(`${RED}  FAIL${NC} ${name}: ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'assertion failed');
}

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// ── 测试环境准备 ──

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'openteam-links-test-'));
const fakeOpenteamDir = path.join(tmpBase, '.openteam');
const fakeAgentsDefsDir = path.join(fakeOpenteamDir, 'agents');
const fakeSkillsDir = path.join(fakeOpenteamDir, 'skills');
const fakeClaudeDir = path.join(tmpBase, '.claude');

fs.mkdirSync(fakeAgentsDefsDir, { recursive: true });
fs.mkdirSync(fakeSkillsDir, { recursive: true });

// 修改 PATHS 常量（运行时替换）
import { PATHS } from '../src/foundation/constants.js';
const origAgentsDefsDir = PATHS.AGENTS_DEFS_DIR;
const origSkillsDir = PATHS.SKILLS_DIR;
PATHS.AGENTS_DEFS_DIR = fakeAgentsDefsDir;
PATHS.SKILLS_DIR = fakeSkillsDir;

import { ensureLinks, CLI_DIRS } from '../src/interfaces/daemon/links.js';

// 修改 CLI_DIRS 让链接目标在临时目录内（不污染真实 ~/.claude/）
const origCliDirs = { ...CLI_DIRS['claude-code'] };
CLI_DIRS['claude-code'] = {
  agents: path.join(fakeClaudeDir, 'agents'),
  skills: path.join(fakeClaudeDir, 'skills'),
};

/**
 * 每个测试前清空 fakeClaudeDir，保证隔离
 */
function resetClaudeDir() {
  fs.rmSync(fakeClaudeDir, { recursive: true, force: true });
}

function cleanup() {
  // 恢复 PATHS 和 CLI_DIRS
  PATHS.AGENTS_DEFS_DIR = origAgentsDefsDir;
  PATHS.SKILLS_DIR = origSkillsDir;
  CLI_DIRS['claude-code'] = origCliDirs;
  // 删除临时目录
  fs.rmSync(tmpBase, { recursive: true, force: true });
}

console.log('\n=== ensureLinks Unit Test ===\n');

// ── 不支持的 CLI 类型 ──

check('unsupported cliType returns ok with warning', () => {
  const result = ensureLinks({
    teamName: 'test', projectDir: '/tmp/any', cliType: 'opencode', agents: ['pm'],
  });
  assert(result.ok, 'should be ok');
  assertEq(result.linked.length, 0);
  assertEq(result.warned.length, 1);
});

// ── Agent 链接：源不存在 → 警告不中止 ──

check('agent source missing → warn, no error', () => {
  resetClaudeDir();
  const result = ensureLinks({
    teamName: 'test', projectDir: '/tmp/any', cliType: 'claude-code', agents: ['nonexist'],
  });
  assert(result.ok, 'should be ok');
  assertEq(result.linked.length, 0);
  assert(result.warned.length > 0, 'should have warnings');
  assert(result.warned[0].includes('nonexist'), 'warning should mention agent name');
});

// ── Agent 链接：正常创建 ──

check('creates agent symlink', () => {
  resetClaudeDir();
  fs.writeFileSync(path.join(fakeAgentsDefsDir, 'pm.md'), '# PM Agent');

  const result = ensureLinks({
    teamName: 'test', projectDir: '/tmp/any', cliType: 'claude-code', agents: ['pm'],
  });
  assert(result.ok, 'should be ok');
  assertEq(result.linked.length, 1);
  assertEq(result.warned.length, 0);

  const linkPath = path.join(fakeClaudeDir, 'agents', 'pm.md');
  assert(fs.lstatSync(linkPath).isSymbolicLink(), 'should be symlink');
  assertEq(fs.readlinkSync(linkPath), path.join(fakeAgentsDefsDir, 'pm.md'));
});

// ── 幂等：重复调用跳过 ──

check('idempotent — second call skips existing correct links', () => {
  resetClaudeDir();
  fs.writeFileSync(path.join(fakeAgentsDefsDir, 'dev.md'), '# Dev Agent');

  const r1 = ensureLinks({
    teamName: 'test', projectDir: '/tmp/any', cliType: 'claude-code', agents: ['dev'],
  });
  assert(r1.ok);
  assertEq(r1.linked.length, 1);

  const r2 = ensureLinks({
    teamName: 'test', projectDir: '/tmp/any', cliType: 'claude-code', agents: ['dev'],
  });
  assert(r2.ok);
  assertEq(r2.linked.length, 0, 'second call should not create');
  assertEq(r2.skipped.length, 1, 'second call should skip');
});

// ── 冲突：目标是非 symlink 文件 → 中止 ──

check('conflict — target is real file → returns error', () => {
  resetClaudeDir();
  const agentsDir = path.join(fakeClaudeDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  // 创建源和冲突的目标
  fs.writeFileSync(path.join(fakeAgentsDefsDir, 'arch.md'), '# Arch');
  fs.writeFileSync(path.join(agentsDir, 'arch.md'), 'conflicting real file');

  const result = ensureLinks({
    teamName: 'test', projectDir: '/tmp/any', cliType: 'claude-code', agents: ['arch'],
  });
  assert(!result.ok, 'should not be ok');
  assert(result.error.includes('冲突'), 'error should mention conflict');
});

// ── 更新：symlink 指向别处 → 更新 ──

check('stale symlink → updated to correct target', () => {
  resetClaudeDir();
  const agentsDir = path.join(fakeClaudeDir, 'agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(path.join(fakeAgentsDefsDir, 'qa.md'), '# QA');
  // 创建指向别处的 symlink
  const wrongTarget = path.join(tmpBase, 'wrong-qa.md');
  fs.writeFileSync(wrongTarget, 'wrong');
  fs.symlinkSync(wrongTarget, path.join(agentsDir, 'qa.md'));

  const result = ensureLinks({
    teamName: 'test', projectDir: '/tmp/any', cliType: 'claude-code', agents: ['qa'],
  });
  assert(result.ok, 'should be ok');
  assertEq(result.linked.length, 1, 'should count as created');
  assertEq(
    fs.readlinkSync(path.join(agentsDir, 'qa.md')),
    path.join(fakeAgentsDefsDir, 'qa.md'),
    'symlink should point to correct target'
  );
});

// ── Skill 目录链接 ──

check('creates skill directory symlinks', () => {
  resetClaudeDir();
  const skillDir = path.join(fakeSkillsDir, 'team-collab');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Team Collab');

  const result = ensureLinks({
    teamName: 'test', projectDir: '/tmp/any', cliType: 'claude-code', agents: [],
  });
  assert(result.ok, 'should be ok');
  assert(result.linked.length >= 1, 'should create skill link');

  const linkPath = path.join(fakeClaudeDir, 'skills', 'team-collab');
  assert(fs.lstatSync(linkPath).isSymbolicLink(), 'should be symlink');
  assertEq(fs.readlinkSync(linkPath), skillDir);
});

// ── Skills: 跳过非目录文件 ──

check('skills: skips non-directory entries', () => {
  resetClaudeDir();
  // 在 skills 目录里放一个文件（不是目录）
  fs.writeFileSync(path.join(fakeSkillsDir, 'README.md'), 'readme');

  const result = ensureLinks({
    teamName: 'test', projectDir: '/tmp/any', cliType: 'claude-code', agents: [],
  });
  assert(result.ok, 'should be ok');
  // README.md 不应该被链接（非目录）
  const readmeLink = path.join(fakeClaudeDir, 'skills', 'README.md');
  assert(!fs.existsSync(readmeLink), 'should not link non-directory entries');
});

// ── 多 agent + 混合情况 ──

check('mixed: some agents exist, some do not', () => {
  resetClaudeDir();
  // pm.md 已存在（从前面的测试写入 fakeAgentsDefsDir）, 'ghost' 不存在
  const result = ensureLinks({
    teamName: 'test', projectDir: '/tmp/any', cliType: 'claude-code', agents: ['pm', 'ghost'],
  });
  assert(result.ok, 'should be ok — source missing is warning, not error');
  assert(result.linked.length >= 1, 'pm should be linked');
  const pmLink = path.join(fakeClaudeDir, 'agents', 'pm.md');
  assert(fs.lstatSync(pmLink).isSymbolicLink(), 'pm.md should be a symlink');
  assert(result.warned.length >= 1, 'ghost should generate warning');
});

// ── 清理 ──
cleanup();

console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
