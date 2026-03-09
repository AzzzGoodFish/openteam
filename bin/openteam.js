#!/usr/bin/env node

/**
 * OpenTeam CLI — 纯路由入口
 */

import { createRequire } from 'module';
import { program } from 'commander';
import {
  cmdStart, cmdAttach, cmdList, cmdStop,
  cmdInspect, cmdDashboard, cmdAgentAttach,
} from '../src/interfaces/cli.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

program.name('openteam').description('Team management for OpenCode').version(version);

program
  .command('start [team]')
  .description('启动团队（创建 tmux/zellij session）')
  .option('-d, --detach', '后台运行')
  .option('--dir <directory>', '项目目录')
  .option('--tmux', '强制使用 tmux')
  .option('--zellij', '强制使用 zellij')
  .action(cmdStart);

program
  .command('attach [team] [agent]', { hidden: true })
  .description('附加到 agent 会话')
  .option('--dir <directory>', '项目目录')
  .action(cmdAttach);

program
  .command('list')
  .alias('ls')
  .description('列出运行中的团队实例')
  .option('-a, --all', '显示所有团队（含已停止）')
  .action(cmdList);

program
  .command('stop <target>')
  .description('停止团队实例（ID 或团队名称）')
  .action(cmdStop);

program
  .command('inspect <team>')
  .description('查看团队详细状态与会话有效性')
  .option('--dir <directory>', '项目目录')
  .action(cmdInspect);

program
  .command('dashboard <team>', { hidden: true })
  .description('独立显示团队状态仪表盘')
  .option('--dir <directory>', '项目目录')
  .action(cmdDashboard);

// 内部命令（不在帮助中显示，由 layout / daemon 自动调用）
program
  .command('agent-attach <team> <agent>', { hidden: true })
  .description('等待 agent 会话就绪后 attach')
  .option('--dir <directory>', '项目目录')
  .action(cmdAgentAttach);

program
  .command('daemon <team>', { hidden: true })
  .option('--port <port>', 'serve 端口', parseInt)
  .option('--dir <directory>', '项目目录')
  .option('--mux <type>', '复用器类型', 'tmux')
  .action(async (teamName, options) => {
    const { runDaemon } = await import('../src/interfaces/daemon/index.js');
    await runDaemon(teamName, options.dir || process.cwd(), options);
  });

program.parse();
