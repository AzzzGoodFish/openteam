#!/usr/bin/env node

/**
 * MessageHub smoke test
 *
 * 纯内存测试，无文件 IO，无网络。
 * 覆盖：register/unregister、deliver/pull、broadcast、status、队列持久性
 */

import { MessageHub } from '../src/server/hub.js';

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

console.log('\n=== MessageHub Smoke Test ===\n');

// ── register / unregister ──

check('register makes agent online', () => {
  const hub = new MessageHub();
  hub.register('pm');
  assert(hub.isOnline('pm'), 'pm should be online');
});

check('unregister makes agent offline', () => {
  const hub = new MessageHub();
  hub.register('pm');
  hub.unregister('pm');
  assert(!hub.isOnline('pm'), 'pm should be offline');
});

check('unregistered agent is offline', () => {
  const hub = new MessageHub();
  assert(!hub.isOnline('nobody'), 'nobody should be offline');
});

// ── deliver / pull ──

check('deliver to registered agent returns online=true', () => {
  const hub = new MessageHub();
  hub.register('dev');
  const result = hub.deliver({ from: 'pm', to: 'dev', message: 'hello' });
  assert(result.delivered, 'should be delivered');
  assert(result.online, 'should be online');
});

check('deliver to unregistered agent returns online=false', () => {
  const hub = new MessageHub();
  const result = hub.deliver({ from: 'pm', to: 'dev', message: 'hello' });
  assert(result.delivered, 'should be delivered');
  assert(!result.online, 'should be offline');
});

check('pull returns delivered messages', () => {
  const hub = new MessageHub();
  hub.register('dev');
  hub.deliver({ from: 'pm', to: 'dev', message: 'msg1' });
  hub.deliver({ from: 'arch', to: 'dev', message: 'msg2' });
  const msgs = hub.pull('dev');
  assertEq(msgs.length, 2, 'should have 2 messages');
  assertEq(msgs[0].from, 'pm');
  assertEq(msgs[0].message, 'msg1');
  assertEq(msgs[1].from, 'arch');
  assertEq(msgs[1].message, 'msg2');
});

check('pull clears queue', () => {
  const hub = new MessageHub();
  hub.deliver({ from: 'pm', to: 'dev', message: 'msg' });
  hub.pull('dev');
  const msgs = hub.pull('dev');
  assertEq(msgs.length, 0, 'should be empty after pull');
});

check('pull on agent with no messages returns empty array', () => {
  const hub = new MessageHub();
  hub.register('dev');
  const msgs = hub.pull('dev');
  assertEq(msgs.length, 0);
});

check('pull on unknown agent returns empty array', () => {
  const hub = new MessageHub();
  const msgs = hub.pull('nobody');
  assertEq(msgs.length, 0);
});

check('messages have timestamp', () => {
  const hub = new MessageHub();
  const before = Date.now();
  hub.deliver({ from: 'pm', to: 'dev', message: 'hi' });
  const msgs = hub.pull('dev');
  assert(msgs[0].timestamp >= before, 'timestamp should be recent');
  assert(msgs[0].timestamp <= Date.now(), 'timestamp should not be in future');
});

// ── broadcast ──

check('broadcast delivers to all except sender', () => {
  const hub = new MessageHub();
  hub.register('pm');
  hub.register('dev');
  hub.register('qa');
  const results = hub.broadcast({ from: 'pm', message: 'update', agents: ['pm', 'dev', 'qa'] });
  assertEq(results.length, 2, 'should deliver to 2 agents');
  assert(results.every(r => r.delivered), 'all should be delivered');
  assert(!results.find(r => r.to === 'pm'), 'should not deliver to sender');
  assertEq(hub.pull('dev')[0].message, 'update');
  assertEq(hub.pull('qa')[0].message, 'update');
  assertEq(hub.pull('pm').length, 0, 'sender should have no messages');
});

check('broadcast with empty agents list returns empty', () => {
  const hub = new MessageHub();
  const results = hub.broadcast({ from: 'pm', message: 'hi', agents: [] });
  assertEq(results.length, 0);
});

// ── queue persistence across unregister ──

check('queue survives unregister (messages not lost)', () => {
  const hub = new MessageHub();
  hub.register('dev');
  hub.deliver({ from: 'pm', to: 'dev', message: 'important' });
  hub.unregister('dev');
  // 重新注册后消息仍在
  hub.register('dev');
  const msgs = hub.pull('dev');
  assertEq(msgs.length, 1, 'message should survive unregister');
  assertEq(msgs[0].message, 'important');
});

// ── status ──

check('status returns registered agents with pending count', () => {
  const hub = new MessageHub();
  hub.register('pm');
  hub.register('dev');
  hub.deliver({ from: 'pm', to: 'dev', message: 'm1' });
  hub.deliver({ from: 'pm', to: 'dev', message: 'm2' });
  const s = hub.status();
  assert(s.pm, 'pm should be in status');
  assert(s.dev, 'dev should be in status');
  assertEq(s.pm.online, true);
  assertEq(s.dev.online, true);
  assertEq(s.pm.pending, 0);
  assertEq(s.dev.pending, 2);
});

check('status does not include unregistered agents with empty queue', () => {
  const hub = new MessageHub();
  hub.register('pm');
  hub.unregister('pm');
  const s = hub.status();
  assert(!s.pm, 'pm should not be in status after unregister with no pending');
});

check('status includes offline agents with pending messages', () => {
  const hub = new MessageHub();
  hub.deliver({ from: 'pm', to: 'dev', message: 'hi' });
  const s = hub.status();
  assert(s.dev, 'dev should be in status');
  assertEq(s.dev.online, false);
  assertEq(s.dev.pending, 1);
});

check('register preserves meta fields', () => {
  const hub = new MessageHub();
  hub.register('dev', { pid: 1234 });
  const s = hub.status();
  assertEq(s.dev.pid, 1234);
});

// ── message log (ring buffer) ──

check('deliver appends to message log', () => {
  const hub = new MessageHub();
  hub.deliver({ from: 'pm', to: 'dev', message: 'hello' });
  hub.deliver({ from: 'dev', to: 'pm', message: 'hi back' });
  const log = hub.getMessageLog();
  assertEq(log.length, 2, 'should have 2 log entries');
  assertEq(log[0].from, 'pm');
  assertEq(log[0].to, 'dev');
  assertEq(log[0].message, 'hello');
  assertEq(log[1].from, 'dev');
  assertEq(log[1].to, 'pm');
});

check('getMessageLog respects limit', () => {
  const hub = new MessageHub();
  for (let i = 0; i < 10; i++) {
    hub.deliver({ from: 'pm', to: 'dev', message: `msg${i}` });
  }
  const log = hub.getMessageLog(3);
  assertEq(log.length, 3, 'should return only 3');
  assertEq(log[0].message, 'msg7', 'should return latest 3');
});

check('message log is independent of pull', () => {
  const hub = new MessageHub();
  hub.register('dev');
  hub.deliver({ from: 'pm', to: 'dev', message: 'test' });
  hub.pull('dev'); // 消费队列
  const log = hub.getMessageLog();
  assertEq(log.length, 1, 'log should survive pull');
});

check('message log caps at MAX_LOG_SIZE', () => {
  const hub = new MessageHub();
  for (let i = 0; i < 210; i++) {
    hub.deliver({ from: 'pm', to: 'dev', message: `msg${i}` });
  }
  const log = hub.getMessageLog(300);
  assertEq(log.length, 200, 'should cap at 200');
  assertEq(log[0].message, 'msg10', 'oldest should be msg10');
});

check('broadcast logs each delivery separately', () => {
  const hub = new MessageHub();
  hub.register('pm');
  hub.register('dev');
  hub.register('qa');
  hub.broadcast({ from: 'pm', message: 'update', agents: ['pm', 'dev', 'qa'] });
  const log = hub.getMessageLog();
  assertEq(log.length, 2, 'should log 2 deliveries (excluding sender)');
  assertEq(log[0].to, 'dev');
  assertEq(log[1].to, 'qa');
});

check('getMessageLog returns empty array when no messages', () => {
  const hub = new MessageHub();
  const log = hub.getMessageLog();
  assertEq(log.length, 0);
});

// ── summary ──

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
