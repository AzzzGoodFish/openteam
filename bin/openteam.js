#!/usr/bin/env node

/**
 * OpenTeam CLI — 纯路由入口
 */

import { createRequire } from 'module';
import { program } from 'commander';
import {
  cmdSetup, cmdStart, cmdList, cmdStop,
  cmdInspect, cmdDashboard,
} from '../src/interfaces/cli.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

program.name('openteam').description('Agent team collaboration framework').version(version);

program
  .command('setup')
  .description('安装内置团队模板')
  .option('--template <name>', '模板名称')
  .option('--name <team>', '团队名称')
  .option('--cli <type>', '默认 CLI 类型')
  .option('--bypass', '启用 yolo 模式')
  .action(cmdSetup);

program
  .command('start [team]')
  .description('启动团队（创建 tmux/zellij session）')
  .option('-d, --detach', '后台运行')
  .option('--dir <directory>', '项目目录')
  .option('--cli <type>', 'CLI 类型（claude-code / opencode）', 'claude-code')
  .option('--tmux', '强制使用 tmux')
  .option('--zellij', '强制使用 zellij')
  .action(cmdStart);

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
  .description('查看团队详细状态与 agent 在线情况')
  .option('--dir <directory>', '项目目录')
  .action(cmdInspect);

program
  .command('dashboard <team>', { hidden: true })
  .description('独立显示团队状态仪表盘')
  .option('--dir <directory>', '项目目录')
  .action(cmdDashboard);

// 内部命令（不在帮助中显示）
program
  .command('daemon <team>', { hidden: true })
  .option('--port <port>', 'server 端口', parseInt)
  .option('--dir <directory>', '项目目录')
  .option('--mux <type>', '复用器类型', 'tmux')
  .option('--cli <type>', 'CLI 类型', 'claude-code')
  .action(async (teamName, options) => {
    const { runDaemon } = await import('../src/interfaces/daemon/index.js');
    await runDaemon(teamName, options.dir || process.cwd(), options);
  });

program
  .command('wrapper', { hidden: true })
  .description('Wrapper 进程（由 daemon pane 自动调用）')
  .action(async () => {
    await import('../src/wrapper/index.js');
  });

program.parse();
