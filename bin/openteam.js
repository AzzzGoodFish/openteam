#!/usr/bin/env node

/**
 * OpenTeam CLI — 纯路由入口
 */

import { createRequire } from 'module';
import { program } from 'commander';
import {
  cmdStart, cmdAttach, cmdList, cmdStop,
  cmdStatus, cmdMonitor, cmdDashboard,
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
  .command('attach [team] [agent]')
  .description('附加到 agent 会话')
  .action(cmdAttach);

program
  .command('list')
  .alias('ls')
  .description('列出所有团队')
  .action(cmdList);

program
  .command('stop <team>')
  .description('停止团队')
  .action(cmdStop);

program
  .command('status <team>')
  .description('查看团队状态')
  .action(cmdStatus);

program
  .command('monitor [team]')
  .description('启动团队（start 的别名）')
  .option('-d, --detach', '后台运行')
  .option('--dir <directory>', '项目目录')
  .option('--tmux', '强制使用 tmux')
  .option('--zellij', '强制使用 zellij')
  .action(cmdMonitor);

program
  .command('dashboard <team>')
  .description('独立显示团队状态仪表盘')
  .action(cmdDashboard);

// 内部命令（不在帮助中显示）
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
