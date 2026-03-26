#!/usr/bin/env node

/**
 * Phase 3 Adapters + Wrapper 验收测试
 *
 * 测试策略：
 * - 适配器模块导入验证
 * - BaseAdapter 接口完整性（必须实现的方法）
 * - ClaudeCodeAdapter 行为正确性（启动命令、MCP 配置、配置路径）
 * - OpenCodeAdapter 行为正确性
 * - 工厂函数 createAdapter（正确分发 + 错误处理）
 * - Wrapper 模块存在性 + 导出
 * - Wrapper 环境变量协议
 * - 无回归
 *
 * 覆盖 PRD 验收标准：
 * 1. Adapter 接口定义（base.js）
 * 2. Claude Code 适配器（claude-code.js）
 * 3. OpenCode 适配器（opencode.js）
 * 4. Wrapper 桥接进程（wrapper/index.js）
 * 5. 无回归
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

console.log('Phase 3 Adapters + Wrapper — Acceptance Tests\n');

// ============================================================
// 0. 模块发现
// ============================================================
console.log(`${YELLOW}--- 0. 模块发现 ---${NC}`);

const expectedFiles = [
  'src/adapters/base.js',
  'src/adapters/claude-code.js',
  'src/adapters/opencode.js',
  'src/wrapper/index.js',
];

for (const f of expectedFiles) {
  check(`模块存在: ${f}`, () => {
    const abs = path.resolve(import.meta.dirname, '..', f);
    if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
  });
}

// ============================================================
// 1. BaseAdapter 接口定义 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 1. BaseAdapter 接口 ---${NC}`);

let baseModule = null;
await checkAsync('P0: base.js 可导入', async () => {
  baseModule = await import('../src/adapters/base.js');
});

if (baseModule) {
  const { BaseAdapter, createAdapter } = baseModule;

  check('P0: BaseAdapter 类已导出', () => {
    if (typeof BaseAdapter !== 'function') {
      throw new Error(`BaseAdapter 不是构造函数: ${typeof BaseAdapter}`);
    }
  });

  check('P0: createAdapter 工厂函数已导出', () => {
    if (typeof createAdapter !== 'function') {
      throw new Error(`createAdapter 不是函数: ${typeof createAdapter}`);
    }
  });

  check('P0: BaseAdapter.binary 是 getter/属性', () => {
    const adapter = new BaseAdapter();
    // 调用 binary 应该抛错（子类必须实现）
    let threw = false;
    try { const _ = adapter.binary; } catch { threw = true; }
    if (!threw) throw new Error('BaseAdapter.binary 应抛出 "subclass must implement" 错误');
  });

  check('P0: BaseAdapter.buildLaunchArgs 要求子类实现', () => {
    const adapter = new BaseAdapter();
    let threw = false;
    try { adapter.buildLaunchArgs({}); } catch { threw = true; }
    if (!threw) throw new Error('BaseAdapter.buildLaunchArgs 应抛出 "subclass must implement" 错误');
  });

  check('P0: BaseAdapter.buildMcpConfig 要求子类实现', () => {
    const adapter = new BaseAdapter();
    let threw = false;
    try { adapter.buildMcpConfig({}); } catch { threw = true; }
    if (!threw) throw new Error('BaseAdapter.buildMcpConfig 应抛出 "subclass must implement" 错误');
  });

  check('P0: BaseAdapter.getMcpConfigPath 要求子类实现', () => {
    const adapter = new BaseAdapter();
    let threw = false;
    try { adapter.getMcpConfigPath('/tmp', 'pm'); } catch { threw = true; }
    if (!threw) throw new Error('BaseAdapter.getMcpConfigPath 应抛出 "subclass must implement" 错误');
  });
}

// ============================================================
// 2. ClaudeCodeAdapter (P0)
// ============================================================
console.log(`\n${YELLOW}--- 2. ClaudeCodeAdapter ---${NC}`);

let claudeModule = null;
await checkAsync('P0: claude-code.js 可导入', async () => {
  claudeModule = await import('../src/adapters/claude-code.js');
});

if (claudeModule) {
  const { ClaudeCodeAdapter } = claudeModule;

  check('P0: ClaudeCodeAdapter 类已导出', () => {
    if (typeof ClaudeCodeAdapter !== 'function') {
      throw new Error(`ClaudeCodeAdapter 不是构造函数: ${typeof ClaudeCodeAdapter}`);
    }
  });

  const adapter = new ClaudeCodeAdapter();

  check('P0: binary 返回 "claude"', () => {
    if (adapter.binary !== 'claude') {
      throw new Error(`binary 应为 "claude"，实际: "${adapter.binary}"`);
    }
  });

  check('P0: buildLaunchArgs 返回数组', () => {
    const args = adapter.buildLaunchArgs({
      agent: 'pm',
      systemPrompt: 'test prompt',
      mcpConfigPath: '/tmp/mcp.json',
      cwd: '/tmp/project',
    });
    if (!Array.isArray(args)) throw new Error(`应返回数组，实际: ${typeof args}`);
  });

  check('P0: buildLaunchArgs 包含 claude 二进制', () => {
    const args = adapter.buildLaunchArgs({ agent: 'pm' });
    if (!args.includes('claude')) throw new Error(`参数应包含 "claude": ${args.join(' ')}`);
  });

  check('P0: buildLaunchArgs 包含 --agent 参数', () => {
    const args = adapter.buildLaunchArgs({ agent: 'architect' });
    const idx = args.indexOf('--agent');
    if (idx < 0 || args[idx + 1] !== 'architect') {
      throw new Error(`应包含 --agent architect: ${args.join(' ')}`);
    }
  });

  check('P0: buildLaunchArgs 包含 --append-system-prompt', () => {
    const args = adapter.buildLaunchArgs({
      agent: 'pm',
      systemPrompt: 'you are a team member',
    });
    const idx = args.indexOf('--append-system-prompt');
    if (idx < 0) throw new Error(`应包含 --append-system-prompt: ${args.join(' ')}`);
    if (!args[idx + 1] || !args[idx + 1].includes('team member')) {
      throw new Error(`system prompt 内容不匹配: ${args.join(' ')}`);
    }
  });

  check('P0: buildLaunchArgs 包含 --mcp-config', () => {
    const args = adapter.buildLaunchArgs({
      agent: 'pm',
      mcpConfigPath: '/tmp/openteam-mcp.json',
    });
    const idx = args.indexOf('--mcp-config');
    if (idx < 0) throw new Error(`应包含 --mcp-config: ${args.join(' ')}`);
    if (args[idx + 1] !== '/tmp/openteam-mcp.json') {
      throw new Error(`mcp 配置路径不匹配: ${args[idx + 1]}`);
    }
  });

  check('P0: buildMcpConfig 返回 openteam MCP 配置', () => {
    const config = adapter.buildMcpConfig({
      serverUrl: 'http://127.0.0.1:4096',
      agent: 'pm',
    });
    if (!config.openteam) throw new Error('配置应包含 "openteam" key');
    if (config.openteam.type !== 'http') throw new Error(`type 应为 "http"，实际: "${config.openteam.type}"`);
    if (!config.openteam.url.includes('127.0.0.1:4096')) {
      throw new Error(`URL 应包含 server 地址: ${config.openteam.url}`);
    }
    if (!config.openteam.url.includes('agent=pm')) {
      throw new Error(`URL 应包含 agent 参数: ${config.openteam.url}`);
    }
  });

  check('P0: buildMcpConfig URL 中 agent 参数被编码', () => {
    const config = adapter.buildMcpConfig({
      serverUrl: 'http://localhost:4096',
      agent: 'my agent',
    });
    // 空格应被编码为 %20 或 +
    if (config.openteam.url.includes('agent=my agent')) {
      throw new Error(`agent 参数未编码: ${config.openteam.url}`);
    }
  });

  check('P0: getMcpConfigPath 返回临时文件路径', () => {
    const configPath = adapter.getMcpConfigPath('/home/user/project', 'pm');
    if (!configPath || typeof configPath !== 'string') {
      throw new Error(`应返回字符串路径: ${configPath}`);
    }
    // 不应在项目目录内（避免污染）
    if (configPath.startsWith('/home/user/project')) {
      throw new Error(`MCP 配置不应在项目目录内: ${configPath}`);
    }
  });

  check('P0: getMcpConfigPath 不同 agent 返回不同路径', () => {
    const pathPm = adapter.getMcpConfigPath('/home/user/project', 'pm');
    const pathDev = adapter.getMcpConfigPath('/home/user/project', 'developer');
    if (pathPm === pathDev) {
      throw new Error(`不同 agent 应生成不同路径，避免覆盖冲突: ${pathPm}`);
    }
  });

  check('P1: buildLaunchArgs 参数可选 — 无 systemPrompt 不崩溃', () => {
    const args = adapter.buildLaunchArgs({ agent: 'pm' });
    if (!Array.isArray(args)) throw new Error('应返回数组');
    if (args.includes('--append-system-prompt')) {
      throw new Error('无 systemPrompt 时不应包含 --append-system-prompt');
    }
  });

  check('P1: buildLaunchArgs 参数可选 — 无 mcpConfigPath 不崩溃', () => {
    const args = adapter.buildLaunchArgs({ agent: 'pm' });
    if (args.includes('--mcp-config')) {
      throw new Error('无 mcpConfigPath 时不应包含 --mcp-config');
    }
  });
}

// ============================================================
// 3. OpenCodeAdapter (P0)
// ============================================================
console.log(`\n${YELLOW}--- 3. OpenCodeAdapter ---${NC}`);

let openCodeModule = null;
await checkAsync('P0: opencode.js 可导入', async () => {
  openCodeModule = await import('../src/adapters/opencode.js');
});

if (openCodeModule) {
  const { OpenCodeAdapter } = openCodeModule;

  check('P0: OpenCodeAdapter 类已导出', () => {
    if (typeof OpenCodeAdapter !== 'function') {
      throw new Error(`OpenCodeAdapter 不是构造函数: ${typeof OpenCodeAdapter}`);
    }
  });

  const adapter = new OpenCodeAdapter();

  check('P0: binary 返回 "opencode"', () => {
    if (adapter.binary !== 'opencode') {
      throw new Error(`binary 应为 "opencode"，实际: "${adapter.binary}"`);
    }
  });

  check('P0: buildLaunchArgs 返回数组', () => {
    const args = adapter.buildLaunchArgs({ agent: 'pm' });
    if (!Array.isArray(args)) throw new Error(`应返回数组，实际: ${typeof args}`);
  });

  check('P0: buildLaunchArgs 包含 opencode 二进制', () => {
    const args = adapter.buildLaunchArgs({ agent: 'pm' });
    if (!args.includes('opencode')) throw new Error(`参数应包含 "opencode": ${args.join(' ')}`);
  });

  check('P0: buildMcpConfig 返回 MCP 配置对象', () => {
    const config = adapter.buildMcpConfig({
      serverUrl: 'http://127.0.0.1:4096',
      agent: 'developer',
    });
    if (typeof config !== 'object' || config === null) {
      throw new Error(`应返回配置对象: ${typeof config}`);
    }
    // 应包含 server URL 信息
    const configStr = JSON.stringify(config);
    if (!configStr.includes('127.0.0.1:4096')) {
      throw new Error(`配置应包含 server URL: ${configStr}`);
    }
  });

  check('P0: getMcpConfigPath 返回路径字符串', () => {
    const configPath = adapter.getMcpConfigPath('/home/user/project', 'developer');
    if (!configPath || typeof configPath !== 'string') {
      throw new Error(`应返回字符串路径: ${configPath}`);
    }
  });

  check('P0: getMcpConfigPath 不同 agent 返回不同路径', () => {
    const pathPm = adapter.getMcpConfigPath('/home/user/project', 'pm');
    const pathDev = adapter.getMcpConfigPath('/home/user/project', 'developer');
    if (pathPm === pathDev) {
      throw new Error(`不同 agent 应生成不同路径: ${pathPm}`);
    }
  });
}

// ============================================================
// 4. createAdapter 工厂函数 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 4. createAdapter 工厂 ---${NC}`);

if (baseModule?.createAdapter) {
  const { createAdapter } = baseModule;

  await checkAsync('P0: createAdapter("claude-code") 返回 ClaudeCodeAdapter', async () => {
    const adapter = await createAdapter('claude-code');
    if (adapter.binary !== 'claude') {
      throw new Error(`binary 应为 "claude"，实际: "${adapter.binary}"`);
    }
  });

  await checkAsync('P0: createAdapter("opencode") 返回 OpenCodeAdapter', async () => {
    const adapter = await createAdapter('opencode');
    if (adapter.binary !== 'opencode') {
      throw new Error(`binary 应为 "opencode"，实际: "${adapter.binary}"`);
    }
  });

  await checkAsync('P0: createAdapter 未知类型 → 抛错', async () => {
    let threw = false;
    try {
      await createAdapter('unknown-cli');
    } catch (err) {
      threw = true;
      if (!err.message.includes('Unknown') && !err.message.includes('unknown')) {
        throw new Error(`错误消息应包含 "unknown": ${err.message}`);
      }
    }
    if (!threw) throw new Error('未知 CLI 类型应抛出错误');
  });

  await checkAsync('P1: createAdapter 返回不同实例', async () => {
    const a1 = await createAdapter('claude-code');
    const a2 = await createAdapter('claude-code');
    if (a1 === a2) throw new Error('工厂应返回不同实例');
  });
}

// ============================================================
// 5. Wrapper 模块 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 5. Wrapper ---${NC}`);

// wrapper/index.js 是独立脚本（自动执行 main()），不能直接 import。
// 策略：(a) 子进程运行验证缺环境变量时的行为 (b) 源码验证结构

const wrapperPath = path.resolve(import.meta.dirname, '../src/wrapper/index.js');
const wrapperSrc = fs.readFileSync(wrapperPath, 'utf8');

check('P0: wrapper 缺环境变量时优雅退出', () => {
  // 不设置环境变量运行 wrapper → 应输出错误并 exit(1)
  try {
    execSync(`node ${wrapperPath}`, {
      encoding: 'utf8',
      env: { ...process.env, OPENTEAM_SERVER_URL: '', OPENTEAM_AGENT: '', OPENTEAM_CLI: '', OPENTEAM_PROJECT_DIR: '' },
      timeout: 5000,
    });
    throw new Error('wrapper 应以非零退出码退出');
  } catch (err) {
    // execSync 对非零退出码会抛错 — 这是预期的
    const stderr = err.stderr || '';
    const stdout = err.stdout || '';
    const output = stderr + stdout;
    if (!output.includes('Missing') && !output.includes('missing') && !output.includes('env')) {
      throw new Error(`wrapper 错误消息应提示缺环境变量: ${output.slice(0, 200)}`);
    }
  }
});

check('P0: wrapper 使用 OPENTEAM_AGENT 环境变量', () => {
  if (!wrapperSrc.includes('OPENTEAM_AGENT')) {
    throw new Error('wrapper 未引用 OPENTEAM_AGENT 环境变量');
  }
});

check('P0: wrapper 使用 OPENTEAM_SERVER 环境变量', () => {
  if (!wrapperSrc.includes('OPENTEAM_SERVER')) {
    throw new Error('wrapper 未引用 OPENTEAM_SERVER 环境变量');
  }
});

check('P0: wrapper 使用 OPENTEAM_TEAM 环境变量', () => {
  if (!wrapperSrc.includes('OPENTEAM_TEAM')) {
    throw new Error('wrapper 未引用 OPENTEAM_TEAM 环境变量');
  }
});

check('P0: wrapper 使用 OPENTEAM_CLI 环境变量', () => {
  if (!wrapperSrc.includes('OPENTEAM_CLI')) {
    throw new Error('wrapper 未引用 OPENTEAM_CLI 环境变量');
  }
});

check('P0: wrapper 使用 OPENTEAM_PROJECT_DIR 环境变量', () => {
  if (!wrapperSrc.includes('OPENTEAM_PROJECT_DIR')) {
    throw new Error('wrapper 未引用 OPENTEAM_PROJECT_DIR 环境变量');
  }
});

check('P0: wrapper 使用 OPENTEAM_AGENTS 环境变量（团队成员列表）', () => {
  if (!wrapperSrc.includes('OPENTEAM_AGENTS')) {
    throw new Error('wrapper 未引用 OPENTEAM_AGENTS 环境变量');
  }
});

check('P0: wrapper 向 server 注册 agent', () => {
  if (!wrapperSrc.includes('/api/register') && !wrapperSrc.includes('register')) {
    throw new Error('wrapper 未调用 server 注册');
  }
});

check('P0: wrapper 向 server 注销 agent（清理）', () => {
  if (!wrapperSrc.includes('/api/unregister') && !wrapperSrc.includes('unregister')) {
    throw new Error('wrapper 未调用 server 注销');
  }
});

check('P0: wrapper 使用 adapter 构建 CLI 命令', () => {
  if (!wrapperSrc.includes('createAdapter') && !wrapperSrc.includes('adapter')) {
    throw new Error('wrapper 未使用适配器');
  }
});

check('P0: wrapper 构建 MCP 配置文件', () => {
  if (!wrapperSrc.includes('buildMcpConfig') && !wrapperSrc.includes('mcpConfig') && !wrapperSrc.includes('MCP')) {
    throw new Error('wrapper 未构建 MCP 配置');
  }
});

check('P0: wrapper 通过 adapter.buildLaunchArgs 构建 CLI 启动命令', () => {
  if (!wrapperSrc.includes('buildLaunchArgs')) {
    throw new Error('wrapper 未调用 adapter.buildLaunchArgs');
  }
});

check('P0: wrapper 启动 CLI 子进程', () => {
  if (!wrapperSrc.includes('spawn') && !wrapperSrc.includes('exec') && !wrapperSrc.includes('fork')) {
    throw new Error('wrapper 未启动子进程');
  }
});

check('P1: wrapper 消息轮询 — 拉取 server 消息', () => {
  const hasPoll = wrapperSrc.includes('poll') || wrapperSrc.includes('pull') ||
                  wrapperSrc.includes('/api/messages') || wrapperSrc.includes('setInterval');
  if (!hasPoll) {
    throw new Error('wrapper 未实现消息轮询');
  }
});

check('P1: wrapper 消息注入 — 通过 mux 注入到 pane', () => {
  const hasInject = wrapperSrc.includes('pasteText') || wrapperSrc.includes('sendKeys') ||
                    wrapperSrc.includes('send-keys') || wrapperSrc.includes('write-chars');
  if (!hasInject) {
    throw new Error('wrapper 未实现消息注入（pasteText/sendKeys）');
  }
});

check('P1: wrapper 处理 SIGTERM 信号', () => {
  if (!wrapperSrc.includes('SIGTERM')) {
    throw new Error('wrapper 未处理 SIGTERM 信号');
  }
});

check('P1: wrapper 处理 SIGINT 信号', () => {
  if (!wrapperSrc.includes('SIGINT')) {
    throw new Error('wrapper 未处理 SIGINT 信号');
  }
});

check('P1: wrapper CLI 退出时清理资源', () => {
  // CLI 退出后应清理：停止轮询 + 注销 + 删除 MCP 配置
  const hasCleanup = wrapperSrc.includes('clearInterval') || wrapperSrc.includes('cleanup');
  const hasUnregister = wrapperSrc.includes('unregister');
  if (!hasCleanup || !hasUnregister) {
    throw new Error('wrapper 退出时未完整清理（clearInterval + unregister）');
  }
});

check('P1: wrapper 构建系统提示词', () => {
  if (!wrapperSrc.includes('systemPrompt') && !wrapperSrc.includes('system_prompt') && !wrapperSrc.includes('append-system-prompt')) {
    throw new Error('wrapper 未构建系统提示词');
  }
});

check('P1: wrapper 系统提示词包含团队成员列表', () => {
  // system prompt 应包含 team members / teammates 信息
  const hasTeamInfo = wrapperSrc.includes('team members') || wrapperSrc.includes('Team members') ||
                      wrapperSrc.includes('teammates') || wrapperSrc.includes('Teammates');
  if (!hasTeamInfo) {
    throw new Error('wrapper 系统提示词未包含团队成员列表');
  }
});

// ============================================================
// 6. 架构约束 (P1)
// ============================================================
console.log(`\n${YELLOW}--- 6. 架构约束 ---${NC}`);

check('P1: adapters/ 不导入 capabilities 层（基础层无业务逻辑）', () => {
  const adapterFiles = ['base.js', 'claude-code.js', 'opencode.js'];
  for (const file of adapterFiles) {
    const filePath = path.resolve(import.meta.dirname, '../src/adapters', file);
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, 'utf8');
    if (src.includes('capabilities/')) {
      throw new Error(`${file} 不应导入 capabilities 层`);
    }
  }
});

check('P1: adapters/ 不导入 interfaces 层', () => {
  const adapterFiles = ['base.js', 'claude-code.js', 'opencode.js'];
  for (const file of adapterFiles) {
    const filePath = path.resolve(import.meta.dirname, '../src/adapters', file);
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, 'utf8');
    if (src.includes('interfaces/')) {
      throw new Error(`${file} 不应导入 interfaces 层`);
    }
  }
});

check('P1: ClaudeCodeAdapter 继承 BaseAdapter', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/adapters/claude-code.js'), 'utf8'
  );
  if (!src.includes('extends BaseAdapter') && !src.includes('extends base')) {
    throw new Error('ClaudeCodeAdapter 应继承 BaseAdapter');
  }
});

check('P1: OpenCodeAdapter 继承 BaseAdapter', () => {
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/adapters/opencode.js'), 'utf8'
  );
  if (!src.includes('extends BaseAdapter') && !src.includes('extends base')) {
    throw new Error('OpenCodeAdapter 应继承 BaseAdapter');
  }
});

// ============================================================
// 7. 无回归 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 7. 无回归 ---${NC}`);

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

check('P0: Phase 2 server 测试通过', () => {
  execSync('node test/server-phase2.js', {
    encoding: 'utf8',
    cwd: path.resolve(import.meta.dirname, '..'),
    timeout: 120000,
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
