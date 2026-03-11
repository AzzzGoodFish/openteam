#!/usr/bin/env node

/**
 * Phase 4 Integration 验收测试 — Daemon/Panes/MCP wiring/Deletions/Dashboard
 *
 * 测试策略：
 * - Daemon serve/panes 模块导入和导出
 * - MCP taskboard create/done 已接入 hub（不再是 TODO stub）
 * - 已删除 v1 模块确认不存在
 * - Dashboard data.js 数据源切换到 server REST API
 * - CLI 入口更新（wrapper command、daemon command）
 * - 全套回归
 *
 * 覆盖 PRD 验收标准：
 * 1. daemon/serve.js — in-process server 生命周期
 * 2. daemon/panes.js — wrapper 命令构建，agent pane 创建
 * 3. daemon/index.js — wired serve + panes + cliType
 * 4. server/mcp.js — taskboard create/done wired to hub
 * 5. capabilities/taskboard.js — hub.deliver() replaces deliverMessage
 * 6. dashboard/data.js — server REST API 数据源
 * 7. Deleted modules — v1 files removed
 * 8. CLI/bin — wrapper/daemon commands
 * 9. 无回归
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
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

console.log('Phase 4 Integration — Acceptance Tests\n');

// ============================================================
// 1. Daemon serve.js — in-process server (P0)
// ============================================================
console.log(`${YELLOW}--- 1. Daemon serve.js ---${NC}`);

let serveModule = null;
await checkAsync('P0: daemon/serve.js 可导入', async () => {
  serveModule = await import('../src/interfaces/daemon/serve.js');
});

if (serveModule) {
  check('P0: 导出 startServe 函数', () => {
    if (typeof serveModule.startServe !== 'function') {
      throw new Error(`startServe 不是函数: ${typeof serveModule.startServe}`);
    }
  });

  check('P0: 导出 stopServe 函数', () => {
    if (typeof serveModule.stopServe !== 'function') {
      throw new Error(`stopServe 不是函数: ${typeof serveModule.stopServe}`);
    }
  });

  check('P0: serve.js 调用 server/index.js startServer', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/interfaces/daemon/serve.js'), 'utf8'
    );
    if (!src.includes('startServer')) {
      throw new Error('serve.js 未引用 startServer');
    }
    if (!src.includes('server/index.js')) {
      throw new Error('serve.js 未引用 server/index.js');
    }
  });

  check('P0: serve.js 不启动子进程（in-process 模式）', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/interfaces/daemon/serve.js'), 'utf8'
    );
    if (src.includes('spawn') || src.includes('fork') || src.includes('child_process')) {
      throw new Error('serve.js 不应使用 child_process（应为 in-process）');
    }
  });
}

// ============================================================
// 2. Daemon panes.js — wrapper pane 管理 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 2. Daemon panes.js ---${NC}`);

let panesModule = null;
await checkAsync('P0: daemon/panes.js 可导入', async () => {
  panesModule = await import('../src/interfaces/daemon/panes.js');
});

if (panesModule) {
  check('P0: 导出 createAllAgentPanes 函数', () => {
    if (typeof panesModule.createAllAgentPanes !== 'function') {
      throw new Error('createAllAgentPanes 不是函数');
    }
  });

  check('P0: 导出 checkAndRespawn 函数', () => {
    if (typeof panesModule.checkAndRespawn !== 'function') {
      throw new Error('checkAndRespawn 不是函数');
    }
  });

  check('P0: panes.js 使用 wrapper 命令（非 opencode attach）', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/interfaces/daemon/panes.js'), 'utf8'
    );
    if (src.includes('opencode attach') || src.includes('attach')) {
      throw new Error('panes.js 不应使用 opencode attach（v1 已废弃）');
    }
    if (!src.includes('wrapper') && !src.includes('OPENTEAM_')) {
      throw new Error('panes.js 应构建 wrapper 启动命令');
    }
  });

  check('P0: panes.js 构建 wrapper 环境变量', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/interfaces/daemon/panes.js'), 'utf8'
    );
    const requiredEnvVars = ['OPENTEAM_SERVER_URL', 'OPENTEAM_AGENT', 'OPENTEAM_TEAM', 'OPENTEAM_CLI'];
    const missing = requiredEnvVars.filter(v => !src.includes(v));
    if (missing.length > 0) {
      throw new Error(`panes.js 缺少环境变量: ${missing.join(', ')}`);
    }
  });

  check('P0: panes.js 传递 cliType 参数', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/interfaces/daemon/panes.js'), 'utf8'
    );
    if (!src.includes('cliType')) {
      throw new Error('panes.js 应传递 cliType');
    }
  });
}

// ============================================================
// 3. Daemon index.js — wired serve + panes (P0)
// ============================================================
console.log(`\n${YELLOW}--- 3. Daemon index.js ---${NC}`);

let daemonModule = null;
await checkAsync('P0: daemon/index.js 可导入', async () => {
  daemonModule = await import('../src/interfaces/daemon/index.js');
});

if (daemonModule) {
  check('P0: 导出 runDaemon 函数', () => {
    if (typeof daemonModule.runDaemon !== 'function') {
      throw new Error('runDaemon 不是函数');
    }
  });

  check('P0: daemon 引用 serve.js 和 panes.js', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/interfaces/daemon/index.js'), 'utf8'
    );
    if (!src.includes('./serve.js') && !src.includes('startServe')) {
      throw new Error('daemon/index.js 未引用 serve.js');
    }
    if (!src.includes('./panes.js') && !src.includes('createAllAgentPanes')) {
      throw new Error('daemon/index.js 未引用 panes.js');
    }
  });

  check('P0: daemon 支持 cliType 选项', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/interfaces/daemon/index.js'), 'utf8'
    );
    if (!src.includes('cliType') && !src.includes('cli')) {
      throw new Error('daemon/index.js 应支持 cliType / cli 选项');
    }
  });

  check('P0: daemon 传递 wrapperOptions 给 panes', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/interfaces/daemon/index.js'), 'utf8'
    );
    if (!src.includes('wrapperOptions') && !src.includes('wrapper')) {
      throw new Error('daemon 应传递 wrapperOptions 给 panes');
    }
  });

  check('P0: daemon 优雅关闭（SIGTERM → stopServe + clearRuntime）', () => {
    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/interfaces/daemon/index.js'), 'utf8'
    );
    if (!src.includes('SIGTERM')) throw new Error('daemon 未处理 SIGTERM');
    if (!src.includes('stopServe')) throw new Error('daemon 关闭时未调用 stopServe');
    if (!src.includes('clearRuntime')) throw new Error('daemon 关闭时未清理 runtime');
  });
}

// ============================================================
// 4. MCP taskboard create/done wired to hub (P0)
// ============================================================
console.log(`\n${YELLOW}--- 4. MCP taskboard wiring ---${NC}`);

check('P0: mcp.js taskboard create 已接入 hub（非 TODO stub）', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/server/mcp.js'), 'utf8'
  );
  // 旧代码有 "TODO: taskboard create not yet wired" — 确认已删除
  if (src.includes('TODO') && src.includes('not yet wired')) {
    throw new Error('mcp.js 仍包含 "not yet wired" TODO — create/done 未接入');
  }
  // create 应调用 capabilities/taskboard.js 的 createTask
  if (!src.includes('createTask')) {
    throw new Error('mcp.js taskboard create 未调用 createTask');
  }
});

check('P0: mcp.js taskboard done 已接入 hub', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/server/mcp.js'), 'utf8'
  );
  if (!src.includes('completeTask')) {
    throw new Error('mcp.js taskboard done 未调用 completeTask');
  }
});

check('P0: mcp.js taskboard create 传递 hub 给 capabilities', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/server/mcp.js'), 'utf8'
  );
  // createTask 调用应包含 hub 参数
  if (!src.match(/createTask\s*\(\s*\{[^}]*hub/s)) {
    throw new Error('mcp.js createTask 调用未传递 hub');
  }
});

check('P0: mcp.js taskboard done 传递 hub 给 capabilities', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/server/mcp.js'), 'utf8'
  );
  if (!src.match(/completeTask\s*\(\s*\{[^}]*hub/s)) {
    throw new Error('mcp.js completeTask 调用未传递 hub');
  }
});

check('P0: mcp.js taskboard create 有 leader 权限校验', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/server/mcp.js'), 'utf8'
  );
  if (!src.includes('leader') || !src.match(/create.*leader|leader.*create/s)) {
    throw new Error('mcp.js taskboard create 未实现 leader 权限校验');
  }
});

// ============================================================
// 5. capabilities/taskboard.js — hub.deliver() (P0)
// ============================================================
console.log(`\n${YELLOW}--- 5. Taskboard hub integration ---${NC}`);

check('P0: taskboard.js 使用 hub.deliver() 投递通知', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/capabilities/taskboard.js'), 'utf8'
  );
  if (!src.includes('hub.deliver')) {
    throw new Error('taskboard.js 未使用 hub.deliver()');
  }
});

check('P0: taskboard.js 不依赖 messaging.js（已删除）', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/capabilities/taskboard.js'), 'utf8'
  );
  if (src.includes('messaging.js') || src.includes('deliverMessage')) {
    throw new Error('taskboard.js 仍引用已删除的 messaging.js');
  }
});

check('P0: taskboard.js createTask 接收 hub 参数', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/capabilities/taskboard.js'), 'utf8'
  );
  if (!src.match(/createTask\s*\(\s*\{[^}]*hub/s)) {
    throw new Error('createTask 签名未包含 hub 参数');
  }
});

check('P0: taskboard.js completeTask 接收 hub 参数', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/capabilities/taskboard.js'), 'utf8'
  );
  if (!src.match(/completeTask\s*\(\s*\{[^}]*hub/s)) {
    throw new Error('completeTask 签名未包含 hub 参数');
  }
});

// ============================================================
// 6. Dashboard data source migration (P0)
// ============================================================
console.log(`\n${YELLOW}--- 6. Dashboard 数据源 ---${NC}`);

check('P0: dashboard/data.js 使用 /api/status 获取 agent 状态', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/interfaces/dashboard/data.js'), 'utf8'
  );
  if (!src.includes('/api/status')) {
    throw new Error('data.js 未使用 /api/status 端点');
  }
});

check('P0: dashboard/data.js 不依赖 opencode API（已删除）', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/interfaces/dashboard/data.js'), 'utf8'
  );
  // 只检查 import/require 语句中的 opencode 引用，注释中提及不算依赖
  const lines = src.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
  const codeOnly = lines.join('\n');
  if (codeOnly.includes('foundation/opencode') || /import\s.*opencode/.test(codeOnly) || /require\(.*opencode/.test(codeOnly)) {
    throw new Error('data.js 仍引用已删除的 opencode 模块');
  }
});

check('P0: dashboard/index.js createEmbeddedDashboard 接收 serveUrl', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/interfaces/dashboard/index.js'), 'utf8'
  );
  if (!src.includes('serveUrl') && !src.includes('serve')) {
    throw new Error('createEmbeddedDashboard 未接收 server URL');
  }
});

check('P1: dashboard/data.js 导出 fetchAgentStatus', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/interfaces/dashboard/data.js'), 'utf8'
  );
  if (!src.includes('export') || !src.includes('fetchAgentStatus')) {
    throw new Error('data.js 未导出 fetchAgentStatus');
  }
});

check('P1: dashboard/data.js fetchAgentStatus 使用 fetch 调用 server', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/interfaces/dashboard/data.js'), 'utf8'
  );
  if (!src.includes('fetch(') || !src.includes('/api/status')) {
    throw new Error('fetchAgentStatus 未使用 fetch 调用 server API');
  }
});

// ============================================================
// 7. Deleted v1 modules (P0)
// ============================================================
console.log(`\n${YELLOW}--- 7. 已删除 v1 模块 ---${NC}`);

const deletedFiles = [
  'src/index.js',
  'src/interfaces/plugin/tools.js',
  'src/interfaces/plugin/hooks.js',
  'src/foundation/opencode.js',
  'src/capabilities/messaging.js',
  'src/capabilities/lifecycle.js',
];

for (const f of deletedFiles) {
  check(`P0: ${f} 已删除`, () => {
    const abs = path.resolve(import.meta.dirname, '..', f);
    if (fs.existsSync(abs)) {
      throw new Error(`${f} 仍存在，应在 Phase 4 中删除`);
    }
  });
}

check('P0: src/ 中无残留 import 引用已删除模块', () => {
  try {
    const result = execSync(
      'grep -r "opencode\\.js\\|lifecycle\\.js\\|messaging\\.js\\|plugin/" src/ --include="*.js" -l 2>/dev/null || true',
      { encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..') }
    ).trim();
    if (result) {
      // 过滤掉 adapters/opencode.js（适配器文件，不是被删的 foundation/opencode.js）
      const files = result.split('\n').filter(f =>
        !f.includes('adapters/opencode.js') && !f.includes('adapters/base.js')
      );
      if (files.length > 0) {
        throw new Error(`以下文件仍引用已删除模块:\n  ${files.join('\n  ')}`);
      }
    }
  } catch (err) {
    if (err.message.includes('仍引用')) throw err;
    // grep 没找到匹配是好事
  }
});

check('P0: package.json 不包含 @opencode-ai/plugin 依赖', () => {
  const pkg = JSON.parse(fs.readFileSync(
    path.resolve(import.meta.dirname, '../package.json'), 'utf8'
  ));
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (allDeps['@opencode-ai/plugin'] || allDeps['@opencode-ai/core']) {
    throw new Error('package.json 仍包含 opencode 相关依赖');
  }
});

// ============================================================
// 8. CLI/bin 更新 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 8. CLI/bin 更新 ---${NC}`);

check('P0: bin/openteam.js 包含 wrapper 命令', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../bin/openteam.js'), 'utf8'
  );
  if (!src.includes('wrapper')) {
    throw new Error('bin/openteam.js 缺少 wrapper 命令');
  }
});

check('P0: bin/openteam.js 包含 daemon 命令', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../bin/openteam.js'), 'utf8'
  );
  if (!src.includes('daemon')) {
    throw new Error('bin/openteam.js 缺少 daemon 命令');
  }
});

check('P0: bin/openteam.js daemon 命令接受 --cli 选项', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../bin/openteam.js'), 'utf8'
  );
  if (!src.includes("'--cli")) {
    throw new Error('daemon 命令未支持 --cli 选项');
  }
});

check('P0: bin/openteam.js 不导入已删除的 plugin 入口', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../bin/openteam.js'), 'utf8'
  );
  if (src.includes('plugin') || src.includes('src/index.js')) {
    throw new Error('bin/openteam.js 仍引用 plugin 入口');
  }
});

check('P0: start 命令支持 --cli 选项', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../bin/openteam.js'), 'utf8'
  );
  // start 命令应有 --cli 选项传递 CLI 类型
  if (!src.match(/start.*--cli|--cli.*start/s)) {
    throw new Error('start 命令未支持 --cli 选项');
  }
});

check('P0: wrapper/daemon 命令是隐藏的（内部命令）', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../bin/openteam.js'), 'utf8'
  );
  // 隐藏命令通常标记 { hidden: true }
  if (!src.includes('hidden: true')) {
    throw new Error('wrapper/daemon 命令应标记为 hidden');
  }
});

// ============================================================
// 9. 集成验证 — taskboard through hub (P0)
// ============================================================
console.log(`\n${YELLOW}--- 9. Taskboard-Hub 集成 ---${NC}`);

// 验证 taskboard 通过 hub 发送的通知确实出现在 hub 队列中
const { MessageHub } = await import('../src/server/hub.js');
const { createTask, completeTask, listTasks } = await import('../src/capabilities/taskboard.js');
const { FILES, getTeamDir, getTeamStateDir } = await import('../src/foundation/constants.js');

const INTEG_TEAM = `_qa-integ-${Date.now()}`;
const INTEG_PROJECT = `/tmp/openteam-qa-integ-${Date.now()}`;
const integTeamDir = getTeamDir(INTEG_TEAM);
const integStateDir = getTeamStateDir(INTEG_TEAM, INTEG_PROJECT);

fs.mkdirSync(integTeamDir, { recursive: true });
fs.writeFileSync(path.join(integTeamDir, FILES.TEAM_CONFIG), JSON.stringify({
  leader: 'pm',
  agents: ['pm', 'architect', 'developer'],
}));
fs.mkdirSync(integStateDir, { recursive: true });

const intHub = new MessageHub();
intHub.register('pm');
intHub.register('architect');
intHub.register('developer');

process.on('exit', () => {
  try { fs.rmSync(integTeamDir, { recursive: true, force: true }); } catch {}
});

await checkAsync('P0: createTask 通过 hub 投递通知到 assignee 队列', async () => {
  const result = await createTask({
    teamName: INTEG_TEAM, projectDir: INTEG_PROJECT, hub: intHub,
    title: '集成测试任务', assignee: 'architect', dependsOn: [], trace: 'integ',
  });
  if (!result.ok) throw new Error(`创建失败: ${result.error}`);

  // 无依赖任务应立即通知 assignee — 消息应出现在 hub 队列
  const msgs = intHub.pull('architect');
  if (msgs.length === 0) {
    throw new Error('hub 队列中无消息 — createTask 未通过 hub 投递通知');
  }
  const taskMsg = msgs.find(m => m.message.includes('[task #'));
  if (!taskMsg) {
    throw new Error(`消息不包含 [task #] 格式: ${msgs.map(m=>m.message).join('; ')}`);
  }
});

await checkAsync('P0: completeTask 通过 hub 通知 leader', async () => {
  const result = await completeTask({
    teamName: INTEG_TEAM, projectDir: INTEG_PROJECT, hub: intHub,
    agentName: 'architect', taskId: 1, trace: 'integ-done',
  });
  if (!result.ok) throw new Error(`完成失败: ${result.error}`);

  // 非 leader 完成任务 → leader (pm) 应收到 [task #1 done] 通知
  const leaderMsgs = intHub.pull('pm');
  const doneMsg = leaderMsgs.find(m => m.message.includes('done'));
  if (!doneMsg) {
    throw new Error(`leader 未收到完成通知: ${leaderMsgs.map(m=>m.message).join('; ')}`);
  }
});

await checkAsync('P0: 依赖满足时 hub 投递下游通知', async () => {
  // 创建 #2 依赖 #1（已完成） → 应立即通知
  // 先清空队列
  intHub.pull('developer');

  const result = await createTask({
    teamName: INTEG_TEAM, projectDir: INTEG_PROJECT, hub: intHub,
    title: '下游任务', assignee: 'developer', dependsOn: [1], trace: 'integ-dep',
  });
  if (!result.ok) throw new Error(`创建失败: ${result.error}`);

  const devMsgs = intHub.pull('developer');
  if (devMsgs.length === 0) {
    throw new Error('依赖已满足的任务应立即通知 — hub 队列为空');
  }
});

// ============================================================
// 10. 完整模块树验证 (P1)
// ============================================================
console.log(`\n${YELLOW}--- 10. 模块树完整性 ---${NC}`);

const v2Modules = [
  'src/foundation/constants.js',
  'src/foundation/config.js',
  'src/foundation/state.js',
  'src/foundation/tasks.js',
  'src/foundation/terminal.js',
  'src/foundation/logger.js',
  'src/capabilities/taskboard.js',
  'src/server/hub.js',
  'src/server/mcp.js',
  'src/server/routes.js',
  'src/server/index.js',
  'src/adapters/base.js',
  'src/adapters/claude-code.js',
  'src/adapters/opencode.js',
  'src/wrapper/index.js',
  'src/interfaces/cli.js',
  'src/interfaces/daemon/index.js',
  'src/interfaces/daemon/serve.js',
  'src/interfaces/daemon/panes.js',
  'src/interfaces/dashboard/index.js',
  'src/interfaces/dashboard/ui.js',
  'src/interfaces/dashboard/data.js',
];

for (const f of v2Modules) {
  check(`P1: ${f} 存在`, () => {
    const abs = path.resolve(import.meta.dirname, '..', f);
    if (!fs.existsSync(abs)) {
      throw new Error(`${f} 不存在`);
    }
  });
}

// ============================================================
// 11. 无回归 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 11. 无回归 ---${NC}`);

check('P0: smoke 测试通过', () => {
  execSync('node test/smoke.js', {
    encoding: 'utf8',
    cwd: path.resolve(import.meta.dirname, '..'),
  });
});

check('P0: hub 测试通过', () => {
  execSync('node test/hub.test.js', {
    encoding: 'utf8',
    cwd: path.resolve(import.meta.dirname, '..'),
  });
});

check('P0: task-board 测试通过', () => {
  execSync('node test/task-board.js', {
    encoding: 'utf8',
    cwd: path.resolve(import.meta.dirname, '..'),
    timeout: 120000,
  });
});

check('P0: CLI 测试通过', () => {
  execSync('node test/cli-simplification.js', {
    encoding: 'utf8',
    cwd: path.resolve(import.meta.dirname, '..'),
  });
});

// ============================================================
// 结果
// ============================================================
console.log(`\n${'='.repeat(50)}`);
console.log(`${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log(`${RED}REJECTED${NC}`);
} else {
  console.log(`${GREEN}ACCEPTED${NC}`);
}

process.exit(failed > 0 ? 1 : 0);
