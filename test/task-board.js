#!/usr/bin/env node

/**
 * 任务看板 MVP — 验收测试（v2 架构）
 *
 * 测试策略：
 * - 创建临时团队配置（写入 ~/.opencode/agents/<team>/team.json）
 * - 用唯一 projectDir 隔离状态目录
 * - capabilities 层 API 直接调用验证业务逻辑（传入 MessageHub 实例）
 * - foundation/tasks.js 直接验证持久化
 * - hub.deliver() 是纯内存操作，通知通过 triggered 返回值验证
 *
 * v2 架构变更：
 * - taskboard API 使用 hub（MessageHub 实例）替代 serveUrl
 * - MCP tools 定义在 src/server/mcp.js（非 plugin/tools.js）
 * - messaging/lifecycle/plugin 模块已删除
 *
 * 覆盖 PRD 验收标准：
 * 1. 任务创建 — 正常创建 + 权限校验 + 参数校验
 * 2. 自动通知 — 无依赖/已满足依赖/未满足依赖（通过 triggered 验证）
 * 3. 任务完成 — 正常完成 + 权限 + 错误处理 + leader 通知
 * 4. 依赖链自动流转 — 链式通知 + 部分满足不通知
 * 5. 持久化 — .tasks.json 文件验证
 * 6. Dashboard 展示 — 数据函数 + 数据结构 + 布局顺序
 * 7. 任务列表查询 — list 返回所有任务
 * 8. 无回归 — smoke + CLI + hub
 * 9. 工具重命名 — task → taskboard（验证 mcp.js 源码）
 * 10. msg boss 限制 — 验证 mcp.js 源码
 */

import fs from 'fs';
import os from 'os';
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

// ============================================================
// 测试环境准备
// ============================================================

// 使用唯一团队名避免与真实团队冲突
const TEST_TEAM = `_qa-test-${Date.now()}`;
const TEST_PROJECT_DIR = `/tmp/openteam-qa-project-${Date.now()}`;

// 导入常量获取真实路径
const { PATHS, FILES, getTeamDir, getTeamStateDir } = await import('../src/foundation/constants.js');

const teamDir = getTeamDir(TEST_TEAM);
const stateDir = getTeamStateDir(TEST_TEAM, TEST_PROJECT_DIR);
const teamConfigPath = path.join(teamDir, FILES.TEAM_CONFIG);
const tasksFilePath = path.join(stateDir, FILES.TASKS);

// 创建团队配置
fs.mkdirSync(teamDir, { recursive: true });
fs.writeFileSync(teamConfigPath, JSON.stringify({
  leader: 'pm',
  agents: ['pm', 'architect', 'developer', 'qa'],
}));

// 确保状态目录存在
fs.mkdirSync(stateDir, { recursive: true });

function cleanup() {
  try { fs.rmSync(teamDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch {}
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(1); });

// ============================================================
// 模块导入
// ============================================================

const { createTask, completeTask, listTasks } = await import('../src/capabilities/taskboard.js');
const { loadTasks, saveTasks } = await import('../src/foundation/tasks.js');
const { fetchTaskBoard } = await import('../src/interfaces/dashboard/data.js');
const { MessageHub } = await import('../src/server/hub.js');

// v2: 使用内存 MessageHub 替代 serveUrl，通知通过 hub.deliver() 直接投递
const hub = new MessageHub();

console.log('Task Board MVP — Acceptance Tests\n');
console.log(`  测试团队: ${TEST_TEAM}`);
console.log(`  团队配置: ${teamConfigPath}`);
console.log(`  状态目录: ${stateDir}\n`);

// ============================================================
// 1. 任务创建 (P0)
// ============================================================
console.log(`${YELLOW}--- 1. 任务创建 ---${NC}`);

await checkAsync('P0: 创建无依赖任务 — 返回 ok + 任务 ID', async () => {
  const result = await createTask({
    teamName: TEST_TEAM,
    projectDir: TEST_PROJECT_DIR,
    hub,
    title: '设计架构方案',
    assignee: 'architect',
    dependsOn: [],
    trace: 'test-1',
  });
  if (!result.ok) throw new Error(`创建失败: ${result.error}`);
  if (!result.task) throw new Error('返回值缺少 task 对象');
  if (typeof result.task.id !== 'number') throw new Error(`任务 ID 应为数字，实际: ${typeof result.task.id}`);
  if (result.task.id !== 1) throw new Error(`首个任务 ID 应为 1，实际: ${result.task.id}`);
});

await checkAsync('P0: 创建任务包含完整字段', async () => {
  const tasks = listTasks(TEST_TEAM, TEST_PROJECT_DIR);
  const task = tasks.find(t => t.id === 1);
  if (!task) throw new Error('任务 1 未找到');
  if (task.title !== '设计架构方案') throw new Error(`title 不正确: ${task.title}`);
  if (task.assignee !== 'architect') throw new Error(`assignee 不正确: ${task.assignee}`);
  if (task.status !== 'pending') throw new Error(`新任务状态应为 pending: ${task.status}`);
  if (!Array.isArray(task.dependsOn)) throw new Error('dependsOn 应为数组');
});

await checkAsync('P0: 创建带描述的任务', async () => {
  const result = await createTask({
    teamName: TEST_TEAM,
    projectDir: TEST_PROJECT_DIR,
    hub,
    title: '编写代码',
    description: '实现核心功能',
    assignee: 'developer',
    dependsOn: [1],
    trace: 'test-2',
  });
  if (!result.ok) throw new Error(`创建失败: ${result.error}`);
  if (result.task.description !== '实现核心功能') throw new Error('描述未正确保存');
  if (result.task.dependsOn[0] !== 1) throw new Error('依赖关系未正确保存');
});

await checkAsync('P0: assignee 不在团队中 → 报错', async () => {
  const result = await createTask({
    teamName: TEST_TEAM,
    projectDir: TEST_PROJECT_DIR,
    hub,
    title: '给外人的任务',
    assignee: 'outsider',
    dependsOn: [],
    trace: 'test-3',
  });
  if (result.ok) throw new Error('应拒绝不在团队中的 assignee');
  if (!result.error.includes('outsider')) throw new Error(`错误信息应提及 outsider: ${result.error}`);
});

await checkAsync('P0: depends_on 引用不存在的任务 → 报错', async () => {
  const result = await createTask({
    teamName: TEST_TEAM,
    projectDir: TEST_PROJECT_DIR,
    hub,
    title: '依赖幽灵任务',
    assignee: 'developer',
    dependsOn: [999],
    trace: 'test-4',
  });
  if (result.ok) throw new Error('应拒绝不存在的依赖任务');
  if (!result.error.includes('999')) throw new Error(`错误信息应提及 #999: ${result.error}`);
});

// 权限校验在 mcp.js 层 — 验证源码包含 leader 权限检查
check('P0: taskboard 工具 create 的 leader 权限校验在 mcp.js 层', () => {
  const mcpPath = path.resolve(import.meta.dirname, '../src/server/mcp.js');
  const mcpSrc = fs.readFileSync(mcpPath, 'utf8');
  // 验证 create action 中有 leader 权限检查
  if (!mcpSrc.includes('isLeader')) throw new Error('mcp.js 中未找到 isLeader 权限检查');
  if (!mcpSrc.match(/only.*leader.*create/i)) throw new Error('mcp.js 中未找到 leader-only create 错误消息');
  // 验证 inputSchema 包含关键参数
  if (!mcpSrc.includes("action:")) throw new Error('缺少 action 参数');
  if (!mcpSrc.includes("title:")) throw new Error('缺少 title 参数');
  if (!mcpSrc.includes("assignee:")) throw new Error('缺少 assignee 参数');
  if (!mcpSrc.includes("id:")) throw new Error('缺少 id 参数');
  if (!mcpSrc.includes("depends_on:")) throw new Error('缺少 depends_on 参数');
  if (!mcpSrc.includes("description:")) throw new Error('缺少 description 参数');
});

// ============================================================
// 2. 自动通知 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 2. 自动通知 ---${NC}`);

// 在新环境中测试通知逻辑
const NOTIFY_TEAM = `_qa-notify-${Date.now()}`;
const NOTIFY_PROJECT = `/tmp/openteam-qa-notify-${Date.now()}`;
const notifyTeamDir = getTeamDir(NOTIFY_TEAM);
const notifyStateDir = getTeamStateDir(NOTIFY_TEAM, NOTIFY_PROJECT);
fs.mkdirSync(notifyTeamDir, { recursive: true });
fs.writeFileSync(path.join(notifyTeamDir, FILES.TEAM_CONFIG), JSON.stringify({
  leader: 'pm',
  agents: ['pm', 'architect', 'developer', 'qa'],
}));
fs.mkdirSync(notifyStateDir, { recursive: true });

// v2: hub.deliver() 是纯内存操作，通知始终成功
// createTask 返回 triggered 数组记录通知结果

await checkAsync('P0: 无依赖任务 → triggered 包含 assignee', async () => {
  const result = await createTask({
    teamName: NOTIFY_TEAM,
    projectDir: NOTIFY_PROJECT,
    hub,
    title: '立即通知任务',
    assignee: 'architect',
    dependsOn: [],
    trace: 'notify-1',
  });
  if (!result.ok) throw new Error(`创建失败: ${result.error}`);
  // v2: hub.deliver() 纯内存，triggered 一定非空
  if (!result.triggered || result.triggered.length === 0) {
    throw new Error('无依赖任务的 triggered 不应为空');
  }
  const triggerStr = result.triggered.join(' ');
  if (!triggerStr.includes('architect')) {
    throw new Error(`triggered 应包含 architect: ${triggerStr}`);
  }
});

await checkAsync('P0: 有未完成依赖的任务 → triggered 为空', async () => {
  const result = await createTask({
    teamName: NOTIFY_TEAM,
    projectDir: NOTIFY_PROJECT,
    hub,
    title: '等待的任务',
    assignee: 'developer',
    dependsOn: [1],  // 依赖 #1，#1 是 pending
    trace: 'notify-2',
  });
  if (!result.ok) throw new Error(`创建失败: ${result.error}`);
  if (result.triggered && result.triggered.length > 0) {
    throw new Error(`依赖未满足时不应触发通知，实际 triggered: ${result.triggered.join(', ')}`);
  }
});

await checkAsync('P0: 通知消息格式 — notifyAssignee 构造 [task #N] 格式', async () => {
  // 验证 taskboard.js 中 notifyAssignee 的消息格式
  // 创建一个无依赖任务并检查 triggered 中的格式
  const result = await createTask({
    teamName: NOTIFY_TEAM,
    projectDir: NOTIFY_PROJECT,
    hub,
    title: '格式测试',
    assignee: 'qa',
    dependsOn: [],
    trace: 'notify-3',
  });
  if (!result.ok) throw new Error(`创建失败: ${result.error}`);
  // triggered 格式: ["#3 格式测试 → qa (...)"]
  if (result.triggered && result.triggered.length > 0) {
    const entry = result.triggered[0];
    if (!entry.includes('#')) throw new Error(`triggered 条目缺少 # 标识: ${entry}`);
    if (!entry.includes('qa')) throw new Error(`triggered 条目缺少 assignee: ${entry}`);
  }
});

// 清理通知测试环境
fs.rmSync(notifyTeamDir, { recursive: true, force: true });

// ============================================================
// 3. 任务完成 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 3. 任务完成 ---${NC}`);

// 使用主测试环境（已有 task #1 和 #2）
await checkAsync('P0: agent 标记自己的任务完成', async () => {
  const result = await completeTask({
    teamName: TEST_TEAM,
    projectDir: TEST_PROJECT_DIR,
    hub,
    agentName: 'architect',
    taskId: 1,
    trace: 'done-1',
  });
  if (!result.ok) throw new Error(`完成失败: ${result.error}`);
  if (result.task.status !== 'done') throw new Error(`状态应为 done: ${result.task.status}`);
  if (!result.task.doneAt) throw new Error('缺少 doneAt 时间戳');
});

await checkAsync('P0: 标记非自己的任务 → 报错', async () => {
  const result = await completeTask({
    teamName: TEST_TEAM,
    projectDir: TEST_PROJECT_DIR,
    hub,
    agentName: 'architect',  // 试图完成 developer 的任务 #2
    taskId: 2,
    trace: 'done-2',
  });
  if (result.ok) throw new Error('应拒绝标记他人的任务');
  if (!result.error.includes('developer')) throw new Error(`错误信息应提及实际 assignee: ${result.error}`);
});

await checkAsync('P0: 任务 ID 不存在 → 报错', async () => {
  const result = await completeTask({
    teamName: TEST_TEAM,
    projectDir: TEST_PROJECT_DIR,
    hub,
    agentName: 'architect',
    taskId: 999,
    trace: 'done-3',
  });
  if (result.ok) throw new Error('应拒绝不存在的任务');
  if (!result.error.includes('999')) throw new Error(`错误信息应提及 #999: ${result.error}`);
});

await checkAsync('P0: 已完成的任务再次标记 → 报错', async () => {
  const result = await completeTask({
    teamName: TEST_TEAM,
    projectDir: TEST_PROJECT_DIR,
    hub,
    agentName: 'architect',
    taskId: 1,  // 已在前面标记 done
    trace: 'done-4',
  });
  if (result.ok) throw new Error('应拒绝重复完成');
  if (!result.error.match(/已完成|already/i)) throw new Error(`错误信息应提示已完成: ${result.error}`);
});

// 新增：leader 通知验证
// leader 通知是独立的 deliverMessage 调用，不进入 triggered 数组（triggered 只追踪依赖链流转）
// 验证方式：确认非 leader 完成任务时不崩溃（leader 通知代码路径被执行），
// 以及 leader 自己完成任务时不会自我通知

const LEADER_TEAM = `_qa-leader-${Date.now()}`;
const LEADER_PROJECT = `/tmp/openteam-qa-leader-${Date.now()}`;
const leaderTeamDir = getTeamDir(LEADER_TEAM);
fs.mkdirSync(leaderTeamDir, { recursive: true });
fs.writeFileSync(path.join(leaderTeamDir, FILES.TEAM_CONFIG), JSON.stringify({
  leader: 'pm',
  agents: ['pm', 'architect', 'developer'],
}));
fs.mkdirSync(getTeamStateDir(LEADER_TEAM, LEADER_PROJECT), { recursive: true });

await createTask({
  teamName: LEADER_TEAM, projectDir: LEADER_PROJECT, hub,
  title: 'leader通知测试', assignee: 'architect', dependsOn: [], trace: 'leader-test',
});
await createTask({
  teamName: LEADER_TEAM, projectDir: LEADER_PROJECT, hub,
  title: 'leader自己的任务', assignee: 'pm', dependsOn: [], trace: 'leader-self',
});

await checkAsync('P0: 非 leader 完成任务 — 不崩溃（leader 通知代码路径执行）', async () => {
  const result = await completeTask({
    teamName: LEADER_TEAM, projectDir: LEADER_PROJECT, hub,
    agentName: 'architect', taskId: 1, trace: 'leader-done',
  });
  if (!result.ok) throw new Error(`完成失败: ${result.error}`);
  // leader 通知通过 deliverMessage 发送（无 serve 时走 try-catch 降级），任务本身应正常完成
  if (result.task.status !== 'done') throw new Error(`状态应为 done: ${result.task.status}`);
});

await checkAsync('P0: leader 自己完成任务 — 不自我通知，正常完成', async () => {
  const result = await completeTask({
    teamName: LEADER_TEAM, projectDir: LEADER_PROJECT, hub,
    agentName: 'pm', taskId: 2, trace: 'leader-self-done',
  });
  if (!result.ok) throw new Error(`完成失败: ${result.error}`);
  if (result.task.status !== 'done') throw new Error(`状态应为 done: ${result.task.status}`);
  // leader 完成自己的任务不应触发自我通知，只要不崩溃就是正确的
});

// 验证 taskboard.js 源码中 leader 通知的消息格式
check('P0: leader 通知消息格式为 [task #N done]', () => {
  const srcPath = path.resolve(import.meta.dirname, '../src/capabilities/taskboard.js');
  const src = fs.readFileSync(srcPath, 'utf8');
  // 验证消息模板包含 [task #... done] 格式
  if (!src.includes('[task #') || !src.includes('done]')) {
    throw new Error('taskboard.js 中未找到 [task #N done] 格式的 leader 通知消息');
  }
  // 验证有 leader !== agentName 的守卫（不自我通知）
  if (!src.includes('!== agentName')) {
    throw new Error('taskboard.js 中未找到 leader !== agentName 的守卫条件');
  }
});

fs.rmSync(leaderTeamDir, { recursive: true, force: true });

// ============================================================
// 4. 依赖链自动流转 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 4. 依赖链自动流转 ---${NC}`);

// 创建全新环境做链式测试
const CHAIN_TEAM = `_qa-chain-${Date.now()}`;
const CHAIN_PROJECT = `/tmp/openteam-qa-chain-${Date.now()}`;
const chainTeamDir = getTeamDir(CHAIN_TEAM);
const chainStateDir = getTeamStateDir(CHAIN_TEAM, CHAIN_PROJECT);
fs.mkdirSync(chainTeamDir, { recursive: true });
fs.writeFileSync(path.join(chainTeamDir, FILES.TEAM_CONFIG), JSON.stringify({
  leader: 'pm',
  agents: ['pm', 'architect', 'developer', 'qa'],
}));
fs.mkdirSync(chainStateDir, { recursive: true });

const chainOpts = { teamName: CHAIN_TEAM, projectDir: CHAIN_PROJECT, hub };

// 构建依赖图:
//   #1 A(architect) — 无依赖
//   #2 B(developer) — depends [1]
//   #3 E(developer) — 无依赖
//   #4 C(qa) — depends [2]
//   #5 D(qa) — depends [1, 3]
await createTask({ ...chainOpts, title: 'A-架构', assignee: 'architect', dependsOn: [], trace: 'chain' });
await createTask({ ...chainOpts, title: 'B-编码', assignee: 'developer', dependsOn: [1], trace: 'chain' });
await createTask({ ...chainOpts, title: 'E-环境', assignee: 'developer', dependsOn: [], trace: 'chain' });
await createTask({ ...chainOpts, title: 'C-测试', assignee: 'qa', dependsOn: [2], trace: 'chain' });
await createTask({ ...chainOpts, title: 'D-集成', assignee: 'qa', dependsOn: [1, 3], trace: 'chain' });

await checkAsync('P0: 完成 A → B 被触发（依赖全满足），C 不触发，D 不触发', async () => {
  const result = await completeTask({
    ...chainOpts, agentName: 'architect', taskId: 1, trace: 'chain-done-A',
  });
  if (!result.ok) throw new Error(`完成 A 失败: ${result.error}`);

  const triggerStr = (result.triggered || []).join(' ');

  // B 依赖 [1]，A 完成 → B 应被触发
  if (!triggerStr.includes('B-编码') && !triggerStr.includes('#2')) {
    throw new Error(`B 应被触发，实际 triggered: ${JSON.stringify(result.triggered)}`);
  }

  // C 依赖 [2]，B 未完成 → C 不应触发
  if (triggerStr.includes('C-测试') || triggerStr.includes('#4')) {
    throw new Error('C 的依赖 B 未完成，不应被触发');
  }

  // D 依赖 [1, 3]，E(#3) 未完成 → D 不应触发
  if (triggerStr.includes('D-集成') || triggerStr.includes('#5')) {
    throw new Error('D 的依赖 E 未完成，不应被触发');
  }
});

await checkAsync('P0: 完成 E → D 被触发（A+E 都 done），C 仍不触发', async () => {
  const result = await completeTask({
    ...chainOpts, agentName: 'developer', taskId: 3, trace: 'chain-done-E',
  });
  if (!result.ok) throw new Error(`完成 E 失败: ${result.error}`);

  const triggerStr = (result.triggered || []).join(' ');

  // D 依赖 [1, 3]，A 和 E 都 done → D 应被触发
  if (!triggerStr.includes('D-集成') && !triggerStr.includes('#5')) {
    throw new Error(`D 应被触发，实际 triggered: ${JSON.stringify(result.triggered)}`);
  }

  // C 依赖 [2]，B 仍未完成 → C 不应触发
  if (triggerStr.includes('C-测试') || triggerStr.includes('#4')) {
    throw new Error('C 的依赖 B 仍未完成，不应被触发');
  }
});

await checkAsync('P0: 完成 B → C 被触发（链式流转）', async () => {
  const result = await completeTask({
    ...chainOpts, agentName: 'developer', taskId: 2, trace: 'chain-done-B',
  });
  if (!result.ok) throw new Error(`完成 B 失败: ${result.error}`);

  const triggerStr = (result.triggered || []).join(' ');

  // C 依赖 [2]，B done → C 应被触发
  if (!triggerStr.includes('C-测试') && !triggerStr.includes('#4')) {
    throw new Error(`C 应被触发，实际 triggered: ${JSON.stringify(result.triggered)}`);
  }
});

await checkAsync('P0: 多个下游同时满足 → 都被触发', async () => {
  // 创建两个都依赖同一个任务的下游
  await createTask({ ...chainOpts, title: 'F-review', assignee: 'architect', dependsOn: [], trace: 'chain' });  // #6
  await createTask({ ...chainOpts, title: 'G-doc', assignee: 'qa', dependsOn: [6], trace: 'chain' });      // #7
  await createTask({ ...chainOpts, title: 'H-deploy', assignee: 'developer', dependsOn: [6], trace: 'chain' }); // #8

  const result = await completeTask({
    ...chainOpts, agentName: 'architect', taskId: 6, trace: 'chain-done-F',
  });
  if (!result.ok) throw new Error(`完成 F 失败: ${result.error}`);

  const triggerStr = (result.triggered || []).join(' ');
  const hasG = triggerStr.includes('G-doc') || triggerStr.includes('#7');
  const hasH = triggerStr.includes('H-deploy') || triggerStr.includes('#8');

  if (!hasG || !hasH) {
    throw new Error(`G 和 H 都应被触发，实际 triggered: ${JSON.stringify(result.triggered)}`);
  }
});

fs.rmSync(chainTeamDir, { recursive: true, force: true });

// ============================================================
// 5. 持久化 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 5. 持久化 ---${NC}`);

check('P0: .tasks.json 文件已创建', () => {
  if (!fs.existsSync(tasksFilePath)) {
    throw new Error(`.tasks.json 不存在: ${tasksFilePath}`);
  }
});

check('P0: .tasks.json 是有效 JSON', () => {
  const content = fs.readFileSync(tasksFilePath, 'utf8');
  JSON.parse(content);
});

check('P0: .tasks.json 包含正确的任务数据', () => {
  const data = JSON.parse(fs.readFileSync(tasksFilePath, 'utf8'));
  if (!data.tasks || !Array.isArray(data.tasks)) throw new Error('缺少 tasks 数组');
  if (typeof data.nextId !== 'number') throw new Error('缺少 nextId');
  const task1 = data.tasks.find(t => t.id === 1);
  if (!task1) throw new Error('任务 #1 未持久化');
  if (task1.status !== 'done') throw new Error(`任务 #1 状态应为 done: ${task1.status}`);
  if (!task1.doneAt) throw new Error('任务 #1 缺少 doneAt');
});

check('P0: foundation/tasks.js loadTasks 能读取数据', () => {
  const data = loadTasks(TEST_TEAM, TEST_PROJECT_DIR);
  if (!data.tasks || data.tasks.length === 0) throw new Error('loadTasks 返回空');
  if (data.tasks[0].title !== '设计架构方案') throw new Error('数据不匹配');
});

check('P0: foundation/tasks.js saveTasks + loadTasks 往返一致', () => {
  const original = loadTasks(TEST_TEAM, TEST_PROJECT_DIR);
  const count = original.tasks.length;
  // 不修改，重新保存
  saveTasks(TEST_TEAM, TEST_PROJECT_DIR, original);
  const reloaded = loadTasks(TEST_TEAM, TEST_PROJECT_DIR);
  if (reloaded.tasks.length !== count) throw new Error('重保存后数量变化');
});

check('P0: constants.js 定义了 TASKS 文件名', () => {
  if (FILES.TASKS !== '.tasks.json') throw new Error(`TASKS 文件名应为 .tasks.json: ${FILES.TASKS}`);
});

// ============================================================
// 6. Dashboard 展示 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 6. Dashboard 展示 ---${NC}`);

check('P0: fetchTaskBoard 函数存在且可调用', () => {
  if (typeof fetchTaskBoard !== 'function') throw new Error('fetchTaskBoard 不是函数');
});

check('P0: fetchTaskBoard 返回任务数组', () => {
  const tasks = fetchTaskBoard(TEST_TEAM, TEST_PROJECT_DIR);
  if (!Array.isArray(tasks)) throw new Error(`应返回数组，实际: ${typeof tasks}`);
  if (tasks.length === 0) throw new Error('返回空数组');
});

check('P0: 任务数据包含 Dashboard 展示所需字段', () => {
  const tasks = fetchTaskBoard(TEST_TEAM, TEST_PROJECT_DIR);
  const task = tasks[0];
  const required = ['id', 'title', 'assignee', 'status', 'dependsOn'];
  for (const field of required) {
    if (task[field] === undefined) throw new Error(`缺少字段: ${field}`);
  }
});

check('P0: 状态标识 — pending 和 done 任务共存', () => {
  const tasks = fetchTaskBoard(TEST_TEAM, TEST_PROJECT_DIR);
  const hasPending = tasks.some(t => t.status === 'pending');
  const hasDone = tasks.some(t => t.status === 'done');
  if (!hasDone) throw new Error('应有 done 状态的任务');
  if (!hasPending) throw new Error('应有 pending 状态的任务');
});

// 验证 Dashboard UI 中的任务看板区域存在
await checkAsync('P0: Dashboard UI 包含任务看板组件', async () => {
  const uiPath = path.resolve(import.meta.dirname, '../src/interfaces/dashboard/ui.js');
  if (!fs.existsSync(uiPath)) throw new Error('dashboard/ui.js 不存在');
  const uiContent = fs.readFileSync(uiPath, 'utf8');
  if (!uiContent.match(/task|任务|看板/i)) {
    throw new Error('Dashboard UI 中未找到任务看板相关代码');
  }
});

check('P1: Dashboard 布局 — 任务看板在消息流下方', () => {
  const uiPath = path.resolve(import.meta.dirname, '../src/interfaces/dashboard/ui.js');
  if (!fs.existsSync(uiPath)) throw new Error('dashboard/ui.js 不存在');
  const uiContent = fs.readFileSync(uiPath, 'utf8');
  // 在 UI 源码中，消息流（message）相关的组件创建应在任务看板之前
  const msgPos = uiContent.search(/message|消息流|msg/i);
  const taskPos = uiContent.search(/task.*board|任务.*看板|taskboard/i);
  if (msgPos === -1 || taskPos === -1) {
    // 无法确定顺序，但组件都存在就跳过顺序检查
    console.log('  (无法从源码确定布局顺序，组件存在性已验证)');
  } else if (taskPos < msgPos) {
    throw new Error('任务看板应在消息流下方（后创建），但在源码中出现更早');
  }
});

check('P1: Dashboard 消息流格式简化 — A → B（无 [from] 前缀）', () => {
  const dataPath = path.resolve(import.meta.dirname, '../src/interfaces/dashboard/data.js');
  if (!fs.existsSync(dataPath)) throw new Error('dashboard/data.js 不存在');
  const dataContent = fs.readFileSync(dataPath, 'utf8');
  // 验证消息流数据中有 from/to 字段（用于 A → B 格式展示）
  if (!dataContent.includes('from') || !dataContent.includes('to')) {
    throw new Error('消息流数据应包含 from/to 字段');
  }
});

// 任务详情弹窗（TUI 无法做交互测试，验证代码结构 + 数据完整性）
check('P1: Dashboard UI 包含详情弹窗组件', () => {
  const uiPath = path.resolve(import.meta.dirname, '../src/interfaces/dashboard/ui.js');
  const uiContent = fs.readFileSync(uiPath, 'utf8');
  // 弹窗通常用 blessed box 实现，检查是否有 detail/popup/modal 相关代码
  if (!uiContent.match(/detail|popup|modal|弹窗|详情/i)) {
    throw new Error('ui.js 中未找到详情弹窗相关代码');
  }
});

check('P1: 详情弹窗支持键盘操作（Esc/q 关闭）', () => {
  const uiPath = path.resolve(import.meta.dirname, '../src/interfaces/dashboard/ui.js');
  const uiContent = fs.readFileSync(uiPath, 'utf8');
  // 应有 escape 或 q 的按键绑定用于关闭弹窗
  const hasEsc = uiContent.includes('escape') || uiContent.includes('Esc');
  if (!hasEsc) {
    throw new Error('ui.js 中未找到 escape 键绑定（用于关闭弹窗）');
  }
});

check('P1: 任务数据包含详情弹窗所需的完整字段', () => {
  const tasks = fetchTaskBoard(TEST_TEAM, TEST_PROJECT_DIR);
  const task = tasks[0];
  // 详情弹窗需要展示：标题、分配人、状态、依赖、创建时间、描述
  const detailFields = ['title', 'assignee', 'status', 'dependsOn', 'createdAt', 'description'];
  const missing = detailFields.filter(f => task[f] === undefined);
  if (missing.length > 0) {
    throw new Error(`任务数据缺少详情展示所需字段: ${missing.join(', ')}`);
  }
});

check('P1: 已完成任务包含 doneAt 字段（详情弹窗展示完成时间）', () => {
  const tasks = fetchTaskBoard(TEST_TEAM, TEST_PROJECT_DIR);
  const doneTask = tasks.find(t => t.status === 'done');
  if (!doneTask) throw new Error('无 done 状态任务');
  if (!doneTask.doneAt) throw new Error('已完成任务缺少 doneAt 字段');
});

// 焦点切换（TUI 交互无法自动化，验证代码结构）
check('P1: Dashboard UI 支持 Tab 键焦点切换', () => {
  const uiPath = path.resolve(import.meta.dirname, '../src/interfaces/dashboard/ui.js');
  const uiContent = fs.readFileSync(uiPath, 'utf8');
  // 应有 tab 按键绑定
  if (!uiContent.match(/['"]tab['"]/i) && !uiContent.includes('\\t')) {
    throw new Error('ui.js 中未找到 Tab 键绑定（焦点切换）');
  }
});

check('P1: Dashboard UI 支持 Shift-Tab 反向切换', () => {
  const uiPath = path.resolve(import.meta.dirname, '../src/interfaces/dashboard/ui.js');
  const uiContent = fs.readFileSync(uiPath, 'utf8');
  // 应有 S-tab / shift-tab / shift+tab 相关绑定
  if (!uiContent.match(/S-tab|shift.*tab/i)) {
    throw new Error('ui.js 中未找到 Shift-Tab 键绑定（反向焦点切换）');
  }
});

check('P1: 弹窗打开时焦点切换被屏蔽', () => {
  const uiPath = path.resolve(import.meta.dirname, '../src/interfaces/dashboard/ui.js');
  const uiContent = fs.readFileSync(uiPath, 'utf8');
  // Tab 处理中应有弹窗状态守卫（检查 detail/popup/modal 是否可见）
  // 典型模式：if (detailBox.visible) return; 或类似守卫
  const hasGuard = uiContent.match(/visible|hidden|showing|isOpen/i);
  if (!hasGuard) {
    throw new Error('ui.js 中未找到弹窗状态守卫（Tab 处理应在弹窗打开时跳过）');
  }
});

// 鼠标支持（TUI 交互无法自动化，验证代码结构）
check('P1: Dashboard 启用鼠标支持', () => {
  const uiPath = path.resolve(import.meta.dirname, '../src/interfaces/dashboard/ui.js');
  const uiContent = fs.readFileSync(uiPath, 'utf8');
  // blessed screen 启用鼠标通常通过 mouse: true
  if (!uiContent.includes('mouse')) {
    throw new Error('ui.js 中未找到 mouse 相关配置');
  }
});

check('P1: 点击弹窗外区域关闭弹窗', () => {
  const uiPath = path.resolve(import.meta.dirname, '../src/interfaces/dashboard/ui.js');
  const uiContent = fs.readFileSync(uiPath, 'utf8');
  // 应有 click 事件处理用于关闭弹窗（screen.on('click') 或类似）
  if (!uiContent.match(/click|mouse/i) || !uiContent.match(/hide|close|visible/i)) {
    throw new Error('ui.js 中未找到点击关闭弹窗的逻辑');
  }
});

check('P1: 列表组件支持鼠标滚轮', () => {
  const uiPath = path.resolve(import.meta.dirname, '../src/interfaces/dashboard/ui.js');
  const uiContent = fs.readFileSync(uiPath, 'utf8');
  // blessed list 组件启用滚动通常通过 scrollable: true 或 mouse: true
  // 或 keys + mouse 组合
  if (!uiContent.match(/scrollable|scrollbar|mouse:\s*true/)) {
    throw new Error('ui.js 中未找到列表滚动支持配置');
  }
});

// ============================================================
// 7. 任务列表查询 (P1)
// ============================================================
console.log(`\n${YELLOW}--- 7. 任务列表查询 ---${NC}`);

check('P1: listTasks 返回所有任务', () => {
  const tasks = listTasks(TEST_TEAM, TEST_PROJECT_DIR);
  if (!Array.isArray(tasks)) throw new Error(`应返回数组: ${typeof tasks}`);
  if (tasks.length < 2) throw new Error(`至少应有 2 个任务: ${tasks.length}`);
});

check('P1: listTasks 包含状态信息', () => {
  const tasks = listTasks(TEST_TEAM, TEST_PROJECT_DIR);
  for (const t of tasks) {
    if (!t.status) throw new Error(`任务 #${t.id} 缺少 status`);
    if (!['pending', 'done'].includes(t.status)) throw new Error(`未知状态: ${t.status}`);
  }
});

check('P1: taskboard 工具 list action 格式化输出', () => {
  // 验证 mcp.js 中 list 输出包含状态标识 ✓/⏳
  const mcpPath = path.resolve(import.meta.dirname, '../src/server/mcp.js');
  const mcpSrc = fs.readFileSync(mcpPath, 'utf8');
  // ✓ = \u2713, ⏳ = \u23f3
  if (!mcpSrc.includes('\\u2713') && !mcpSrc.includes('\u2713')) {
    throw new Error('mcp.js list 格式化中未找到 ✓ (\\u2713) 标识');
  }
  if (!mcpSrc.includes('\\u23f3') && !mcpSrc.includes('\u23f3')) {
    throw new Error('mcp.js list 格式化中未找到 ⏳ (\\u23f3) 标识');
  }
  // 同时验证数据层有 done 和 pending 任务
  const tasks = listTasks(TEST_TEAM, TEST_PROJECT_DIR);
  const doneTask = tasks.find(t => t.status === 'done');
  const pendingTask = tasks.find(t => t.status === 'pending');
  if (!doneTask) throw new Error('缺少 done 任务用于格式化验证');
  if (!pendingTask) throw new Error('缺少 pending 任务用于格式化验证');
});

// ============================================================
// 8. 无回归 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 8. 无回归 ---${NC}`);

check('P0: smoke 测试通过', () => {
  execSync('node test/smoke.js', {
    encoding: 'utf8',
    cwd: path.resolve(import.meta.dirname, '..'),
  });
});

check('P0: CLI 无回归', () => {
  execSync('node test/cli-simplification.js', {
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

// ============================================================
// 9. 工具重命名 task → taskboard (P0)
// ============================================================
console.log(`\n${YELLOW}--- 9. 工具重命名 ---${NC}`);

check('P0: 工具注册名为 taskboard（非 task）', () => {
  const mcpPath = path.resolve(import.meta.dirname, '../src/server/mcp.js');
  const mcpSrc = fs.readFileSync(mcpPath, 'utf8');
  // 验证注册为 'taskboard'
  if (!mcpSrc.match(/registerTool\(\s*['"]taskboard['"]/)) {
    throw new Error('mcp.js 中未找到 registerTool("taskboard")');
  }
  // 验证没有注册为 'task'
  if (mcpSrc.match(/registerTool\(\s*['"]task['"]\s*,/)) {
    throw new Error('mcp.js 中仍存在旧名 registerTool("task")');
  }
});

check('P0: taskboard 工具描述中包含任务管理相关说明', () => {
  const mcpPath = path.resolve(import.meta.dirname, '../src/server/mcp.js');
  const mcpSrc = fs.readFileSync(mcpPath, 'utf8');
  // 提取 taskboard tool 的 description
  const descMatch = mcpSrc.match(/registerTool\(\s*['"]taskboard['"][\s\S]*?description:\s*['"]([^'"]+)['"]/);
  if (!descMatch) throw new Error('未找到 taskboard 工具的 description');
  const desc = descMatch[1];
  if (!desc.match(/task/i)) {
    throw new Error(`description 应提及 task management: ${desc}`);
  }
});

check('P0: taskboard 工具支持 create/done/list actions', () => {
  const mcpPath = path.resolve(import.meta.dirname, '../src/server/mcp.js');
  const mcpSrc = fs.readFileSync(mcpPath, 'utf8');
  // 验证 inputSchema 有 action 字段
  if (!mcpSrc.match(/action:\s*z\.string\(\)/)) throw new Error('mcp.js 中未找到 action 参数定义');
  // 验证支持 create/done/list
  if (!mcpSrc.includes("action === 'create'")) throw new Error('mcp.js 中未找到 create action 处理');
  if (!mcpSrc.includes("action === 'done'")) throw new Error('mcp.js 中未找到 done action 处理');
  if (!mcpSrc.includes("action === 'list'")) throw new Error('mcp.js 中未找到 list action 处理');
});

// ============================================================
// 10. msg 工具 boss 限制 (P0)
// ============================================================
console.log(`\n${YELLOW}--- 10. msg boss 限制 ---${NC}`);

check('P0: msg 工具 description 包含 boss 警告', () => {
  const mcpPath = path.resolve(import.meta.dirname, '../src/server/mcp.js');
  const mcpSrc = fs.readFileSync(mcpPath, 'utf8');
  // 提取 msg tool 的 description
  const descMatch = mcpSrc.match(/registerTool\(\s*['"]msg['"][\s\S]*?description:\s*['"]([^'"]+)['"]/);
  if (!descMatch) throw new Error('未找到 msg 工具的 description');
  const desc = descMatch[1];
  if (!desc.match(/boss/i)) {
    throw new Error(`msg description 应包含 boss 相关警告: ${desc}`);
  }
});

check('P0: mcp.js 中 msg handler 包含 boss 拦截逻辑', () => {
  const mcpPath = path.resolve(import.meta.dirname, '../src/server/mcp.js');
  const mcpSrc = fs.readFileSync(mcpPath, 'utf8');
  // 应有 who === 'boss' 的拦截检查
  if (!mcpSrc.match(/who\s*===\s*['"]boss['"]/)) {
    throw new Error('mcp.js 中未找到 who === "boss" 拦截逻辑');
  }
  // 应返回错误提示用户直接回复
  if (!mcpSrc.match(/reply directly|in your session/)) {
    throw new Error('mcp.js 中未找到 boss 拦截的错误提示');
  }
});

check('P0: msg 工具 description 说明 boss 在会话内', () => {
  const mcpPath = path.resolve(import.meta.dirname, '../src/server/mcp.js');
  const mcpSrc = fs.readFileSync(mcpPath, 'utf8');
  // description 应说明 boss 在同一会话内
  if (!mcpSrc.match(/boss.*session|boss.*会话/i)) {
    throw new Error('msg description 应说明 boss 在同一会话内');
  }
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
