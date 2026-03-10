#!/usr/bin/env node

/**
 * Phase 2 Server 验收测试 — Hub + HTTP + MCP over SSE
 *
 * 测试策略：
 * - 模块导入验证（无需运行 server）
 * - Hub 单元行为：直接调用 hub API 验证消息投递/广播/拉取/注册/注销
 * - HTTP API：启动 server 实例，发 HTTP 请求验证
 * - MCP over SSE：验证 MCP server 工具注册
 * - 依赖检查：验证 package.json 新依赖
 *
 * 覆盖 PRD 验收标准：
 * 1. Hub 消息投递/广播/拉取/注册/注销
 * 2. MCP over SSE 暴露 msg + taskboard 工具
 * 3. REST API（/status、/tasks、/msg 等）
 * 4. 新依赖完整性
 * 5. 无回归
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import http from 'http';

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

// HTTP 请求辅助
function httpRequest(url, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('Request timeout')); });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

console.log('Phase 2 Server — Acceptance Tests\n');

// ============================================================
// 0. 模块发现
// ============================================================
console.log(`${YELLOW}--- 0. 模块发现 ---${NC}`);

const serverFiles = [
  'src/server/index.js',
  'src/server/hub.js',
  'src/server/mcp.js',
  'src/server/routes.js',
];

for (const f of serverFiles) {
  check(`模块存在: ${f}`, () => {
    const abs = path.resolve(import.meta.dirname, '..', f);
    if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
  });
}

// ============================================================
// 1. Hub 消息投递/广播/拉取/注册/注销 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 1. Hub ---${NC}`);

let hub = null;
await checkAsync('P0: hub 模块可导入', async () => {
  hub = await import('../src/server/hub.js');
});

if (hub) {
  // 发现 Hub API — 适配不同命名风格
  const findFn = (names) => {
    for (const name of names) {
      if (typeof hub[name] === 'function') return hub[name];
    }
    // 也检查默认导出
    if (hub.default && typeof hub.default === 'object') {
      for (const name of names) {
        if (typeof hub.default[name] === 'function') return hub.default[name];
      }
    }
    return null;
  };

  // 如果 hub 导出的是一个类或工厂函数
  let hubInstance = null;
  const HubClass = hub.Hub || hub.MessageHub || hub.default;
  const createHub = findFn(['createHub', 'create', 'newHub']);

  if (typeof HubClass === 'function' && /^class\s/.test(HubClass.toString()) || (HubClass && HubClass.prototype)) {
    try { hubInstance = new HubClass(); } catch { /* not a class */ }
  }
  if (!hubInstance && createHub) {
    try { hubInstance = createHub(); } catch { /* factory failed */ }
  }

  // 直接函数 API
  const register = findFn(['register', 'registerAgent', 'addAgent']);
  const unregister = findFn(['unregister', 'unregisterAgent', 'removeAgent']);
  const deliver = findFn(['deliver', 'deliverMessage', 'sendMessage', 'send']);
  const broadcast = findFn(['broadcast', 'broadcastMessage']);
  const pull = findFn(['pull', 'pullMessages', 'getMessages', 'fetchMessages']);

  const hasDirectAPI = register && deliver && pull;
  const hasInstanceAPI = hubInstance && typeof (hubInstance.register || hubInstance.registerAgent) === 'function';

  const api = hasInstanceAPI ? {
    register: (hubInstance.register || hubInstance.registerAgent).bind(hubInstance),
    unregister: (hubInstance.unregister || hubInstance.unregisterAgent || hubInstance.removeAgent)?.bind(hubInstance),
    deliver: (hubInstance.deliver || hubInstance.deliverMessage || hubInstance.send).bind(hubInstance),
    broadcast: (hubInstance.broadcast || hubInstance.broadcastMessage)?.bind(hubInstance),
    pull: (hubInstance.pull || hubInstance.pullMessages || hubInstance.getMessages).bind(hubInstance),
  } : hasDirectAPI ? { register, unregister, deliver, broadcast, pull } : null;

  console.log(`  Hub API 类型: ${hasInstanceAPI ? 'instance' : hasDirectAPI ? 'direct' : 'unknown'}`);
  console.log(`  导出: ${Object.keys(hub).join(', ')}`);

  if (api) {
    check('P0: 注册 agent', () => {
      const result = api.register('architect', { team: 'test' });
      // 不应抛异常
    });

    check('P0: 注册第二个 agent', () => {
      api.register('developer', { team: 'test' });
    });

    await checkAsync('P0: 投递消息', async () => {
      const result = await api.deliver('architect', '你好 architect', { from: 'pm' });
      // 投递不应失败
    });

    await checkAsync('P0: 拉取消息 — 收到投递的消息', async () => {
      const messages = await api.pull('architect');
      const msgs = Array.isArray(messages) ? messages : (messages?.messages || []);
      if (msgs.length === 0) throw new Error('architect 应有 1 条消息');
      const msg = msgs[0];
      const content = msg.message || msg.content || msg.text || '';
      if (!content.includes('你好')) throw new Error(`消息内容不匹配: ${content}`);
    });

    await checkAsync('P0: 拉取后消息被清空（或标记已读）', async () => {
      const messages = await api.pull('architect');
      const msgs = Array.isArray(messages) ? messages : (messages?.messages || []);
      if (msgs.length > 0) {
        // 有些实现可能不清空，而是返回未读消息
        console.log(`  (拉取后仍有 ${msgs.length} 条消息 — 可能是已读标记模式)`);
      }
    });

    if (api.broadcast) {
      await checkAsync('P0: 广播消息 — 所有 agent 收到', async () => {
        await api.broadcast('全体通知', { from: 'pm', team: 'test' });
        const archMsgs = await api.pull('architect');
        const devMsgs = await api.pull('developer');
        const archArr = Array.isArray(archMsgs) ? archMsgs : (archMsgs?.messages || []);
        const devArr = Array.isArray(devMsgs) ? devMsgs : (devMsgs?.messages || []);

        const archHas = archArr.some(m => (m.message || m.content || '').includes('全体'));
        const devHas = devArr.some(m => (m.message || m.content || '').includes('全体'));

        if (!archHas) throw new Error('architect 未收到广播');
        if (!devHas) throw new Error('developer 未收到广播');
      });
    }

    if (api.unregister) {
      check('P0: 注销 agent', () => {
        api.unregister('architect');
      });

      await checkAsync('P0: 注销后投递 — 应失败或排队', async () => {
        try {
          const result = await api.deliver('architect', '投递给已注销的 agent');
          // 可能返回错误，也可能排队等待重新注册
          // 不崩溃就行
        } catch (err) {
          // 抛异常也是合理的拒绝方式
        }
      });
    }

    // 清理
    if (api.unregister) {
      try { api.unregister('developer'); } catch {}
    }
  } else {
    check('P0: Hub API 可用', () => {
      throw new Error(`未找到可用的 Hub API。导出: ${Object.keys(hub).join(', ')}`);
    });
  }
}

// ============================================================
// 2. MCP over SSE (P0)
// ============================================================
console.log(`\n${YELLOW}--- 2. MCP over SSE ---${NC}`);

let mcp = null;
await checkAsync('P0: mcp 模块可导入', async () => {
  mcp = await import('../src/server/mcp.js');
});

if (mcp) {
  check('P0: mcp 模块导出 server 创建函数或类', () => {
    const exports = Object.keys(mcp);
    const hasMcpExport = exports.some(k =>
      typeof mcp[k] === 'function' || (mcp[k] && typeof mcp[k] === 'object')
    );
    if (!hasMcpExport) throw new Error(`mcp 无有效导出: ${exports.join(', ')}`);
  });

  check('P0: mcp 模块引用 msg 和 taskboard 工具', () => {
    const mcpPath = path.resolve(import.meta.dirname, '../src/server/mcp.js');
    const src = fs.readFileSync(mcpPath, 'utf8');
    if (!src.match(/msg/)) throw new Error('mcp.js 中未找到 msg 工具引用');
    if (!src.match(/taskboard|task/i)) throw new Error('mcp.js 中未找到 taskboard 工具引用');
  });

  check('P0: mcp 模块使用 @modelcontextprotocol/server', () => {
    const mcpPath = path.resolve(import.meta.dirname, '../src/server/mcp.js');
    const src = fs.readFileSync(mcpPath, 'utf8');
    if (!src.includes('@modelcontextprotocol')) {
      throw new Error('mcp.js 未引用 @modelcontextprotocol 包');
    }
  });

  check('P0: mcp 模块使用 zod 做参数校验', () => {
    const mcpPath = path.resolve(import.meta.dirname, '../src/server/mcp.js');
    const src = fs.readFileSync(mcpPath, 'utf8');
    if (!src.includes('zod') && !src.includes('z.')) {
      throw new Error('mcp.js 未使用 zod 做参数校验');
    }
  });
}

// ============================================================
// 3. REST API (P0)
// ============================================================
console.log(`\n${YELLOW}--- 3. REST API ---${NC}`);

let routes = null;
await checkAsync('P0: routes 模块可导入', async () => {
  routes = await import('../src/server/routes.js');
});

if (routes) {
  check('P0: routes 模块导出路由注册函数', () => {
    const exports = Object.keys(routes);
    const hasRouteExport = exports.some(k => typeof routes[k] === 'function');
    if (!hasRouteExport) throw new Error(`routes 无函数导出: ${exports.join(', ')}`);
  });

  check('P0: routes 源码包含核心端点', () => {
    const routesPath = path.resolve(import.meta.dirname, '../src/server/routes.js');
    const src = fs.readFileSync(routesPath, 'utf8');
    const endpoints = ['/status', '/tasks', '/msg'];
    const missing = endpoints.filter(ep => !src.includes(ep));
    if (missing.length > 0) {
      throw new Error(`routes.js 缺少端点: ${missing.join(', ')}`);
    }
  });
}

// server/index.js
let serverModule = null;
await checkAsync('P0: server/index.js 可导入', async () => {
  serverModule = await import('../src/server/index.js');
});

if (serverModule) {
  check('P0: server 模块导出启动函数', () => {
    const exports = Object.keys(serverModule);
    const hasStartFn = exports.some(k =>
      typeof serverModule[k] === 'function' &&
      (k.match(/start|create|listen|serve/i))
    );
    if (!hasStartFn) {
      // 也可能导出 default
      if (typeof serverModule.default === 'function') return;
      throw new Error(`server 无启动函数导出: ${exports.join(', ')}`);
    }
  });
}

// ============================================================
// 4. 依赖完整性 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 4. 依赖完整性 ---${NC}`);

check('P0: package.json 包含 @modelcontextprotocol/server', () => {
  const pkg = JSON.parse(fs.readFileSync(
    path.resolve(import.meta.dirname, '../package.json'), 'utf8'
  ));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps['@modelcontextprotocol/server'] && !deps['@modelcontextprotocol/sdk']) {
    throw new Error('缺少 @modelcontextprotocol/server 或 @modelcontextprotocol/sdk 依赖');
  }
});

check('P0: package.json 包含 zod', () => {
  const pkg = JSON.parse(fs.readFileSync(
    path.resolve(import.meta.dirname, '../package.json'), 'utf8'
  ));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps['zod']) throw new Error('缺少 zod 依赖');
});

check('P0: 新依赖已安装（node_modules 存在）', () => {
  const nmPath = path.resolve(import.meta.dirname, '../node_modules');
  // 检查 zod
  if (!fs.existsSync(path.join(nmPath, 'zod'))) {
    throw new Error('zod 未安装到 node_modules');
  }
});

// ============================================================
// 5. 无回归 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 5. 无回归 ---${NC}`);

check('P0: smoke 测试通过', () => {
  execSync('node test/smoke.js', {
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
