#!/usr/bin/env node

/**
 * Migration script: move data from old structure to new structure
 *
 * Old:
 *   ~/.opencode/memory/<team>/<agent>/
 *     - agent.json
 *     - sessions.json
 *     - blocks/*.md
 *   ~/.opencode/memory/<team>/
 *     - .runtime.json
 *     - .active-sessions.json
 *
 * New:
 *   ~/.opencode/agents/<team>/<agent>/
 *     - agent.json
 *     - sessions.json
 *     - blocks/*.mem
 *   ~/.opencode/agents/<team>/
 *     - .runtime.json
 *     - .active-sessions.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const homeDir = os.homedir();
const OLD_MEMORY_DIR = path.join(homeDir, '.opencode/memory');
const NEW_AGENTS_DIR = path.join(homeDir, '.opencode/agents');

function migrate() {
  console.log('OpenTeam 数据迁移');
  console.log('==================');
  console.log(`源目录: ${OLD_MEMORY_DIR}`);
  console.log(`目标目录: ${NEW_AGENTS_DIR}`);
  console.log('');

  if (!fs.existsSync(OLD_MEMORY_DIR)) {
    console.log('源目录不存在，无需迁移');
    return;
  }

  const teams = fs.readdirSync(OLD_MEMORY_DIR, { withFileTypes: true });

  for (const teamEntry of teams) {
    if (!teamEntry.isDirectory()) continue;
    if (teamEntry.name.startsWith('.')) continue;

    const teamName = teamEntry.name;
    const oldTeamDir = path.join(OLD_MEMORY_DIR, teamName);
    const newTeamDir = path.join(NEW_AGENTS_DIR, teamName);

    console.log(`\n迁移团队: ${teamName}`);

    // Migrate team-level files
    const teamFiles = ['.runtime.json', '.active-sessions.json', 'tasks.md'];
    for (const file of teamFiles) {
      const oldPath = path.join(oldTeamDir, file);
      const newPath = path.join(newTeamDir, file);

      if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        fs.copyFileSync(oldPath, newPath);
        console.log(`  复制: ${file}`);
      }
    }

    // Migrate agent directories
    const agentDirs = fs.readdirSync(oldTeamDir, { withFileTypes: true });

    for (const agentEntry of agentDirs) {
      if (!agentEntry.isDirectory()) continue;

      const agentName = agentEntry.name;
      const oldAgentDir = path.join(oldTeamDir, agentName);
      const newAgentDir = path.join(newTeamDir, agentName);

      console.log(`  迁移 agent: ${agentName}`);

      // Ensure new directory exists
      if (!fs.existsSync(newAgentDir)) {
        fs.mkdirSync(newAgentDir, { recursive: true });
      }

      // Copy agent.json and sessions.json
      for (const file of ['agent.json', 'sessions.json']) {
        const oldPath = path.join(oldAgentDir, file);
        const newPath = path.join(newAgentDir, file);

        if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
          fs.copyFileSync(oldPath, newPath);
          console.log(`    复制: ${file}`);
        }
      }

      // Migrate blocks directory
      const oldBlocksDir = path.join(oldAgentDir, 'blocks');
      const newBlocksDir = path.join(newAgentDir, 'blocks');

      if (fs.existsSync(oldBlocksDir)) {
        if (!fs.existsSync(newBlocksDir)) {
          fs.mkdirSync(newBlocksDir, { recursive: true });
        }

        const blockFiles = fs.readdirSync(oldBlocksDir);

        for (const blockFile of blockFiles) {
          const oldPath = path.join(oldBlocksDir, blockFile);

          // Change .md to .mem
          let newFileName = blockFile;
          if (blockFile.endsWith('.md')) {
            newFileName = blockFile.replace(/\.md$/, '.mem');
          }

          const newPath = path.join(newBlocksDir, newFileName);

          if (!fs.existsSync(newPath)) {
            fs.copyFileSync(oldPath, newPath);
            console.log(`    复制: blocks/${blockFile} -> blocks/${newFileName}`);
          }
        }

        // Update agent.json to use .mem extension
        const agentConfigPath = path.join(newAgentDir, 'agent.json');
        if (fs.existsSync(agentConfigPath)) {
          try {
            const config = JSON.parse(fs.readFileSync(agentConfigPath, 'utf8'));
            let updated = false;

            if (config.blocks) {
              for (const block of config.blocks) {
                if (block.file && block.file.endsWith('.md')) {
                  block.file = block.file.replace(/\.md$/, '.mem');
                  updated = true;
                }
              }
            }

            if (updated) {
              fs.writeFileSync(agentConfigPath, JSON.stringify(config, null, 2));
              console.log(`    更新: agent.json (文件扩展名 .md -> .mem)`);
            }
          } catch (e) {
            console.log(`    警告: 无法更新 agent.json - ${e.message}`);
          }
        }
      }
    }
  }

  console.log('\n迁移完成！');
  console.log('');
  console.log('注意: 旧数据保留在原位置，确认新版本工作正常后可手动删除');
  console.log(`  rm -rf ${OLD_MEMORY_DIR}`);
}

migrate();
