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
  .description('启动团队 serve')
  .option('-d, --detach', '后台运行')
  .option('--dir <directory>', '项目目录')
  .action(cmdStart);

program
  .command('attach [team] [agent]')
  .description('附加到 agent 会话')
  .option('-w, --watch', '监视模式，自动跟随会话状态')
  .option('--cwd <directory>', '指定实例的工作目录')
  .action(cmdAttach);

program
  .command('list')
  .alias('ls')
  .description('列出运行中的团队')
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
  .description('分屏监控所有 agent')
  .option('--tmux', '强制使用 tmux')
  .option('--zellij', '强制使用 zellij')
  .option('--dir <directory>', '项目目录')
  .action(cmdMonitor);

program
  .command('dashboard <team>')
  .description('实时显示团队状态仪表盘')
  .action(cmdDashboard);

program.parse();
