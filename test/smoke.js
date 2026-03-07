#!/usr/bin/env node

/**
 * 最小 smoke 验证 — 发布前基础检查
 *
 * 覆盖：
 * 1. 源码模块 import（plugin 入口 + 各层关键模块）
 * 2. CLI --help 可运行
 * 3. list 命令可运行
 */

import { execSync } from 'child_process';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const NC = '\x1b[0m';

let passed = 0;
let failed = 0;

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

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`${GREEN}✓${NC} ${name}`);
    passed++;
  } catch (err) {
    console.log(`${RED}✗${NC} ${name}`);
    console.log(`  ${err.message}`);
    failed++;
  }
}

console.log('OpenTeam smoke test\n');

// 1. 模块 import
await checkAsync('import: plugin entry (src/index.js)', async () => {
  await import('../src/index.js');
});

await checkAsync('import: foundation/constants', async () => {
  await import('../src/foundation/constants.js');
});

await checkAsync('import: foundation/config', async () => {
  await import('../src/foundation/config.js');
});

await checkAsync('import: foundation/state', async () => {
  await import('../src/foundation/state.js');
});

await checkAsync('import: foundation/opencode', async () => {
  await import('../src/foundation/opencode.js');
});

await checkAsync('import: capabilities/lifecycle', async () => {
  await import('../src/capabilities/lifecycle.js');
});

await checkAsync('import: capabilities/messaging', async () => {
  await import('../src/capabilities/messaging.js');
});

// 2. CLI --help
check('cli: --help', () => {
  const out = execSync('node bin/openteam.js --help', { encoding: 'utf8' });
  if (!out.includes('openteam')) throw new Error('--help output missing "openteam"');
});

// 3. CLI list
check('cli: list', () => {
  execSync('node bin/openteam.js list', { encoding: 'utf8' });
});

// 结果
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
