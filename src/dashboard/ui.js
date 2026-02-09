/**
 * Dashboard UI components (using blessed)
 */

import blessed from 'blessed';

// 模块级变量：保存当前消息列表原始数据，供展开详情用
let _currentMessages = [];

/**
 * 创建 Dashboard 界面
 */
export function createDashboard(teamName) {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
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
    height: 12,
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
    top: 23,
    left: 0,
    width: '100%',
    height: '100%-23',
    tags: true,
    border: { type: 'line' },
    label: ' 消息流 (↑↓选择 Enter展开 q退出) ',
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
  screen.append(detailBox);

  // 全局退出
  screen.key(['q', 'C-c'], () => {
    if (!detailBox.hidden) {
      // 如果详情弹窗打开，先关闭弹窗
      detailBox.hide();
      messageStream.focus();
      screen.render();
      return;
    }
    return process.exit(0);
  });

  // Enter 展开消息详情
  messageStream.on('select', (item, index) => {
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

    detailBox.setContent(detail);
    detailBox.setScrollPerc(0);
    detailBox.show();
    detailBox.focus();
    screen.render();
  });

  // Esc 关闭详情弹窗
  detailBox.key(['escape', 'q'], () => {
    detailBox.hide();
    messageStream.focus();
    screen.render();
  });

  // 默认焦点在消息流
  messageStream.focus();
  screen.render();

  return {
    screen,
    header,
    teamStatus,
    agentStatus,
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
    `Serve URL:  ${teamStatus.url}`,
    `PID:        ${teamStatus.pid}`,
    `Leader:     ${teamStatus.leader}`,
    `项目目录:   ${teamStatus.projectDir}`,
    `启动时间:   ${teamStatus.started}`,
  ].join('\n');

  box.setContent(content);
}

/**
 * 更新 Agent 状态
 */
export function updateAgentStatus(box, agentStatuses) {
  if (agentStatuses.length === 0) {
    box.setContent('{yellow-fg}暂无活跃 Agent{/yellow-fg}');
    return;
  }

  const lines = agentStatuses.map((agent) => {
    const status = agent.online ? '{green-fg}●{/green-fg}' : '{red-fg}○{/red-fg}';
    const name = agent.name.padEnd(15);
    const sessionId = agent.sessionId.slice(0, 12).padEnd(12);
    const cwd = agent.cwd.length > 40 ? '...' + agent.cwd.slice(-37) : agent.cwd;
    
    return `${status} ${name} ${sessionId} ${cwd}`;
  });

  const header = '{bold}状态  Agent          会话ID       工作目录{/bold}';
  box.setContent([header, ...lines].join('\n'));
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
    const fromTag = msg.from === 'boss'
      ? '{black-fg}{yellow-bg} [from boss] {/}'
      : `{black-fg}{green-bg} [from ${msg.from}] {/}`;
    const toTag = `{cyan-fg}→ ${msg.to}{/cyan-fg}`;
    const content = msg.content.replace(/\n/g, ' ').slice(0, 80);

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
