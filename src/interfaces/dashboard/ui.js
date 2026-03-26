/**
 * Dashboard UI components (using blessed)
 */

import blessed from 'blessed';

// 模块级变量：保存当前列表原始数据，供展开详情用
let _currentMessages = [];
let _currentTasks = [];
let _lastFocused = null;

/**
 * 计算字符串的终端显示宽度（CJK 字符占 2 列）
 */
function displayWidth(str) {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    // CJK Unified Ideographs + CJK 标点等常见双宽字符范围
    if (
      (code >= 0x2E80 && code <= 0x9FFF) ||   // CJK 基本 + 扩展
      (code >= 0xF900 && code <= 0xFAFF) ||   // CJK 兼容
      (code >= 0xFE30 && code <= 0xFE4F) ||   // CJK 兼容形式
      (code >= 0xFF01 && code <= 0xFF60) ||   // 全角 ASCII
      (code >= 0xFFE0 && code <= 0xFFE6) ||   // 全角符号
      (code >= 0x20000 && code <= 0x2FA1F)    // CJK 扩展 B-F
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/**
 * 按终端显示宽度截断字符串
 */
function truncateToWidth(str, maxWidth) {
  let w = 0;
  let i = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    const charW = (
      (code >= 0x2E80 && code <= 0x9FFF) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE30 && code <= 0xFE4F) ||
      (code >= 0xFF01 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6) ||
      (code >= 0x20000 && code <= 0x2FA1F)
    ) ? 2 : 1;
    if (w + charW > maxWidth) break;
    w += charW;
    i += ch.length;
  }
  return str.slice(0, i);
}

// Agent 颜色映射（按首次出现顺序轮转）
const AGENT_COLORS = ['green', 'cyan', 'magenta', 'blue', 'yellow', 'red'];
const _colorCache = new Map();

function getAgentColor(name) {
  if (name === 'boss') return 'black-fg}{yellow-bg';  // boss 保持醒目的黄底黑字
  if (_colorCache.has(name)) return _colorCache.get(name);
  const idx = _colorCache.size % AGENT_COLORS.length;
  const color = `${AGENT_COLORS[idx]}-fg`;
  _colorCache.set(name, color);
  return color;
}

/**
 * 创建 Dashboard 界面
 */
export function createDashboard(teamName) {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    mouse: true,
    title: `OpenTeam Dashboard - ${teamName}`,
  });

  // Header box
  const header = blessed.box({
    top: 0,
    left: 0,
    width: '100%',
    height: 3,
    content: '',
    tags: true,
    border: { type: 'line' },
    style: {
      fg: 'white',
      border: { fg: 'cyan' },
    },
  });

  // Team status box
  const teamStatus = blessed.box({
    top: 3,
    left: 0,
    width: '100%',
    height: 8,
    content: '',
    tags: true,
    border: { type: 'line' },
    label: ' 团队状态 ',
    style: {
      fg: 'white',
      border: { fg: 'green' },
    },
  });

  // Agent status box
  const agentStatus = blessed.box({
    top: 11,
    left: 0,
    width: '100%',
    height: 10,
    content: '',
    tags: true,
    border: { type: 'line' },
    label: ' Agent 状态 ',
    scrollable: true,
    keys: true,
    vi: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: 'blue' } },
    style: {
      fg: 'white',
      border: { fg: 'yellow' },
    },
  });

  // 消息流列表（可选中）
  const messageStream = blessed.list({
    top: 21,
    left: 0,
    width: '100%',
    height: '100%-33',
    tags: true,
    border: { type: 'line' },
    label: ' 消息流 (点击/Enter展开 Tab切换 q退出) ',
    scrollable: true,
    keys: true,
    vi: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: 'blue' } },
    style: {
      fg: 'white',
      border: { fg: 'magenta' },
      selected: { bg: 'blue', fg: 'white' },
      item: { fg: 'white' },
    },
    items: [],
  });

  // 任务看板（钉在底部，可选中）
  const taskBoard = blessed.list({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 12,
    tags: true,
    border: { type: 'line' },
    label: ' 任务看板 (点击/Enter详情 Tab切换) ',
    scrollable: true,
    keys: true,
    vi: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: 'blue' } },
    style: {
      fg: 'white',
      border: { fg: 'blue' },
      selected: { bg: 'blue', fg: 'white' },
      item: { fg: 'white' },
    },
    items: [],
  });

  // 消息详情弹窗（默认隐藏）
  const detailBox = blessed.box({
    top: 'center',
    left: 'center',
    width: '80%',
    height: '70%',
    content: '',
    tags: true,
    border: { type: 'line' },
    label: ' 消息详情 (Esc/q 关闭) ',
    scrollable: true,
    keys: true,
    vi: true,
    alwaysScroll: true,
    scrollbar: { ch: ' ', style: { bg: 'blue' } },
    style: {
      fg: 'white',
      bg: 'black',
      border: { fg: 'cyan' },
    },
    hidden: true,
  });

  screen.append(header);
  screen.append(teamStatus);
  screen.append(agentStatus);
  screen.append(messageStream);
  screen.append(taskBoard);
  screen.append(detailBox);

  // Tab 焦点切换（消息流 ↔ 任务看板）
  const focusable = [messageStream, taskBoard];
  let focusIndex = 0;

  screen.key(['tab'], () => {
    if (!detailBox.hidden) return; // 弹窗打开时不切换
    focusIndex = (focusIndex + 1) % focusable.length;
    focusable[focusIndex].focus();
    screen.render();
  });

  screen.key(['S-tab'], () => {
    if (!detailBox.hidden) return;
    focusIndex = (focusIndex - 1 + focusable.length) % focusable.length;
    focusable[focusIndex].focus();
    screen.render();
  });

  // 全局退出
  screen.key(['q', 'C-c'], () => {
    if (!detailBox.hidden) {
      // 如果详情弹窗打开，先关闭弹窗
      detailBox.hide();
      (_lastFocused || messageStream).focus();
      screen.render();
      return;
    }
    return process.exit(0);
  });

  // Enter 展开消息详情
  messageStream.on('select', (item, index) => {
    _lastFocused = messageStream;
    const msg = _currentMessages[index];
    if (!msg) return;

    const time = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
    const detail = [
      `{bold}时间:{/bold}    ${time}`,
      `{bold}发送方:{/bold}  {cyan-fg}${msg.from}{/cyan-fg}`,
      `{bold}接收方:{/bold}  {cyan-fg}${msg.to}{/cyan-fg}`,
      '',
      '{bold}内容:{/bold}',
      '─'.repeat(60),
      msg.fullContent || msg.content,
    ].join('\n');

    detailBox.setLabel(' 消息详情 (Esc/q 关闭) ');
    detailBox.setContent(detail);
    detailBox.setScrollPerc(0);
    detailBox.show();
    detailBox.focus();
    screen.render();
  });

  // Enter 展开任务详情
  taskBoard.on('select', (item, index) => {
    _lastFocused = taskBoard;
    const task = _currentTasks[index];
    if (!task) return;

    const created = new Date(task.createdAt).toLocaleString('zh-CN', { hour12: false });
    const doneAt = task.doneAt ? new Date(task.doneAt).toLocaleString('zh-CN', { hour12: false }) : '—';
    const status = task.status === 'done' ? '{green-fg}已完成{/green-fg}' : '{yellow-fg}待处理{/yellow-fg}';
    const deps = task.dependsOn.length > 0
      ? task.dependsOn.map(id => '#' + id).join(', ')
      : '无';

    const detail = [
      `{bold}任务 #${task.id}{/bold}`,
      '',
      `{bold}标题:{/bold}    ${task.title}`,
      `{bold}分配人:{/bold}  {cyan-fg}${task.assignee}{/cyan-fg}`,
      `{bold}状态:{/bold}    ${status}`,
      `{bold}依赖:{/bold}    ${deps}`,
      `{bold}创建时间:{/bold} ${created}`,
      `{bold}完成时间:{/bold} ${doneAt}`,
      '',
      '{bold}描述:{/bold}',
      '─'.repeat(60),
      task.description || '{gray-fg}(无描述){/gray-fg}',
    ].join('\n');

    detailBox.setLabel(' 任务详情 (Esc/q 关闭) ');
    detailBox.setContent(detail);
    detailBox.setScrollPerc(0);
    detailBox.show();
    detailBox.focus();
    screen.render();
  });

  // Esc 关闭详情弹窗
  detailBox.key(['escape', 'q'], () => {
    detailBox.hide();
    (_lastFocused || messageStream).focus();
    screen.render();
  });

  // 点击弹窗外区域关闭详情
  screen.on('click', (mouse) => {
    if (detailBox.hidden) return;
    // 检查点击是否在 detailBox 范围外
    const top = detailBox.atop;
    const left = detailBox.aleft;
    const bottom = top + detailBox.height;
    const right = left + detailBox.width;
    if (mouse.x < left || mouse.x >= right || mouse.y < top || mouse.y >= bottom) {
      detailBox.hide();
      (_lastFocused || messageStream).focus();
      screen.render();
    }
  });

  // 默认焦点在消息流
  messageStream.focus();
  screen.render();

  return {
    screen,
    header,
    teamStatus,
    agentStatus,
    taskBoard,
    messageStream,
    detailBox,
  };
}

/**
 * 更新 Header 内容
 */
export function updateHeader(headerBox, teamName, refreshTime) {
  const content = `{center}{bold}OpenTeam Dashboard - ${teamName}{/bold}\nLast refresh: ${refreshTime}  |  Press 'q' to quit{/center}`;
  headerBox.setContent(content);
}

/**
 * 更新团队状态
 */
export function updateTeamStatus(box, teamStatus) {
  if (!teamStatus.running) {
    box.setContent(`{red-fg}${teamStatus.error}{/red-fg}\n\n请运行: openteam start ${teamStatus.teamName || '<team>'}`);
    return;
  }

  const content = [
    `{green-fg}● 运行中{/green-fg}`,
    `Server:     ${teamStatus.url}`,
    `Daemon PID: ${teamStatus.daemonPid}`,
    `Leader:     ${teamStatus.leader}`,
    `项目目录:   ${teamStatus.projectDir}`,
    `启动时间:   ${teamStatus.started}`,
  ].join('\n');

  box.setContent(content);
}

/**
 * 更新 Agent 状态
 *
 * v2 数据格式：{ name, online, pending, activity }
 * 活动指示器：
 *   ● 待机   (green)  — 在线，无待处理消息
 *   ● 思考中 (yellow) — 在线，有待处理消息
 *   ○ 离线   (red)    — 未注册
 */
export function updateAgentStatus(box, agentStatuses) {
  if (agentStatuses.length === 0) {
    box.setContent('{yellow-fg}暂无活跃 Agent{/yellow-fg}');
    return;
  }

  const lines = agentStatuses.map((agent) => {
    const indicator = formatActivity(agent);
    const name = agent.name.padEnd(12);
    const pending = agent.pending > 0 ? `{yellow-fg}(${agent.pending} pending){/yellow-fg}` : '';

    return `${indicator} ${name} ${pending}`;
  });

  box.setContent(lines.join('\n'));
}

/**
 * 格式化 agent 活动状态指示器
 *
 * 对齐到 8 个可见列宽（CJK 字符占 2 列）：
 *   "● 运行中" = 8 列 = 8
 *   "● 在线"   = 6 列 + 2 空格 = 8
 *   "○ 离线"   = 6 列 + 2 空格 = 8
 */
function formatActivity(agent) {
  if (!agent.online) return '{red-fg}○ 离线{/red-fg}  ';
  if (agent.active) return '{cyan-fg}● 运行中{/cyan-fg}';
  return '{green-fg}● 在线{/green-fg}  ';
}

/**
 * 更新任务看板
 */
export function updateTaskBoard(listBox, tasks) {
  _currentTasks = tasks || [];

  if (_currentTasks.length === 0) {
    listBox.setItems(['{yellow-fg}暂无任务{/yellow-fg}']);
    return;
  }

  // 计算标题最大显示宽度，动态对齐
  const TITLE_COL = 32;

  const items = _currentTasks.map(t => {
    const status = t.status === 'done'
      ? '{green-fg}✓{/green-fg}'
      : '{yellow-fg}⏳{/yellow-fg}';
    const id = `#${t.id}`.padEnd(4);

    // 按终端显示宽度截断和填充标题
    let title = t.title;
    let titleWidth = displayWidth(title);
    if (titleWidth > TITLE_COL) {
      // 按显示宽度截断，保留 '...'
      title = truncateToWidth(title, TITLE_COL - 3) + '...';
      titleWidth = displayWidth(title);
    }
    const titlePad = ' '.repeat(Math.max(0, TITLE_COL - titleWidth));

    const assignee = `→ ${t.assignee}`;

    let deps = '';
    if (t.status === 'pending' && t.dependsOn.length > 0) {
      const pendingDeps = t.dependsOn.filter(depId => {
        const dep = _currentTasks.find(d => d.id === depId);
        return dep && dep.status !== 'done';
      });
      if (pendingDeps.length > 0) {
        deps = `  {gray-fg}等 ${pendingDeps.map(id => '#' + id).join(',')}{/gray-fg}`;
      }
    }

    return `${id} ${status} ${title}${titlePad} ${assignee}${deps}`;
  });

  listBox.setItems(items);
}

/**
 * 更新消息流
 */
export function updateMessageStream(listBox, messages) {
  // 保存原始数据供展开用
  _currentMessages = messages;

  if (messages.length === 0) {
    listBox.setItems(['{yellow-fg}暂无消息{/yellow-fg}']);
    return;
  }

  // 记住当前选中位置
  const prevSelected = listBox.selected;
  const wasAtBottom = prevSelected >= listBox.items.length - 2;

  const items = messages.map((msg) => {
    const time = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
    const fromColor = getAgentColor(msg.from);
    const fromTag = msg.from === 'boss'
      ? '{black-fg}{yellow-bg} boss {/}'
      : `{${fromColor}}${msg.from}{/}`;
    const toTag = `{cyan-fg}→ ${msg.to}{/cyan-fg}`;
    const content = msg.content.replace(/^\[from \S+\]\s*/, '').replace(/\n/g, ' ').slice(0, 80);

    return `{gray-fg}${time}{/gray-fg} ${fromTag} ${toTag} ${content}`;
  });

  listBox.setItems(items);

  // 如果之前在底部，跟随滚到底
  if (wasAtBottom || prevSelected === 0) {
    listBox.select(items.length - 1);
    listBox.setScrollPerc(100);
  } else {
    listBox.select(Math.min(prevSelected, items.length - 1));
  }
}
