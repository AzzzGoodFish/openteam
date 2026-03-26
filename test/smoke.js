#!/usr/bin/env node

/**
 * 最小 smoke 验证 — 发布前基础检查
 *
 * 覆盖：
 * 1. 源码模块 import（各层关键模块）
 * 2. CLI --help 可运行
 * 3. list 命令可运行
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  addAgentPane,
  cleanMuxEnv,
  cleanupZellijSessionArtifacts,
  killSession,
  parseZellijSessions,
  startSession,
} from '../src/foundation/terminal.js';

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

function hasBinary(name) {
  try {
    execSync(`which ${name}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function queryZellij(sessionName, command) {
  const env = { ...cleanMuxEnv(), ZELLIJ_SESSION_NAME: sessionName };
  return execSync(command, { encoding: 'utf8', env });
}

function liveTabLayout(layout) {
  return layout.split('new_tab_template')[0] || layout;
}

function tabSection(layout, tabName) {
  const marker = `tab name="${tabName}"`;
  const start = layout.indexOf(marker);
  if (start === -1) return '';
  const next = layout.indexOf('\n    tab name="', start + marker.length);
  return layout.slice(start, next === -1 ? layout.length : next);
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
await checkAsync('import: foundation/constants', async () => {
  await import('../src/foundation/constants.js');
});

await checkAsync('import: foundation/config', async () => {
  await import('../src/foundation/config.js');
});

await checkAsync('import: foundation/state', async () => {
  await import('../src/foundation/state.js');
});

await checkAsync('import: foundation/tasks', async () => {
  await import('../src/foundation/tasks.js');
});

await checkAsync('import: capabilities/taskboard', async () => {
  await import('../src/capabilities/taskboard.js');
});

await checkAsync('import: server/hub', async () => {
  await import('../src/server/hub.js');
});

await checkAsync('import: server/index', async () => {
  await import('../src/server/index.js');
});

await checkAsync('import: adapters/base', async () => {
  await import('../src/adapters/base.js');
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

check('zellij: parse exited sessions as inactive', () => {
  const parsed = parseZellijSessions('\u001b[32;1mopenteam-dev-82b4f9b2\u001b[m [Created 0s ago] (EXITED - attach to resurrect)\n');
  if (parsed.length !== 1) throw new Error('expected one parsed zellij session');
  if (parsed[0].name !== 'openteam-dev-82b4f9b2') throw new Error('session name parsed incorrectly');
  if (!parsed[0].exited) throw new Error('exited zellij session was not marked exited');
});

check('zellij: cleanup removes resurrection cache', () => {
  const sessionName = `openteam-smoke-cache-${Date.now()}`;
  const root = path.join(os.tmpdir(), `openteam-zellij-cache-${process.pid}-${Date.now()}`);
  const cacheDir = path.join(root, '0.43.1', 'session_info', sessionName);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, 'session-layout.kdl'), 'layout {}');

  cleanupZellijSessionArtifacts(sessionName, root);

  if (fs.existsSync(cacheDir)) {
    throw new Error('zellij resurrection cache still exists after cleanup');
  }
  fs.rmSync(root, { recursive: true, force: true });
});

if (hasBinary('zellij')) {
  await checkAsync('zellij: daemon tab keeps single live pane', async () => {
    const sessionName = `openteam-smoke-${Date.now()}-daemon`;

    try {
      startSession('zellij', sessionName, 'bash -lc "sleep 30"', { foreground: false });
      await sleep(1000);

      const layout = queryZellij(sessionName, 'zellij action dump-layout');
      const activeLayout = liveTabLayout(layout);

      if (!activeLayout.includes('plugin location="zellij:status-bar"')) {
        throw new Error('missing zellij status bar in live layout');
      }
      if (activeLayout.includes('pane split_direction="vertical"')) {
        throw new Error('daemon startup still splits the initial zellij tab');
      }
    } finally {
      killSession(sessionName);
    }
  });

  await checkAsync('zellij: agent pane gets dedicated tab', async () => {
    const sessionName = `openteam-smoke-${Date.now()}-agent`;

    try {
      startSession('zellij', sessionName, 'bash -lc "sleep 30"', { foreground: false });
      await sleep(1000);
      addAgentPane('zellij', sessionName, 'bash -lc "sleep 30"', 'worker');
      await sleep(1000);

      const tabs = queryZellij(sessionName, 'zellij action query-tab-names');
      if (!tabs.split('\n').includes('worker')) {
        throw new Error('worker tab was not created');
      }

      const layout = queryZellij(sessionName, 'zellij action dump-layout');
      const workerLayout = tabSection(liveTabLayout(layout), 'worker');
      if (!workerLayout.includes('name="worker"')) {
        throw new Error('worker pane was not named');
      }
      if (workerLayout.includes('split_direction="vertical"')) {
        throw new Error('worker tab still opens as a split layout');
      }
    } finally {
      killSession(sessionName);
    }
  });
} else {
  console.log('- skip zellij smoke checks (zellij not installed)');
}

// 结果
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
