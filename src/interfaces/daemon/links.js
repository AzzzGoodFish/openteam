/**
 * Agent/Skill 软链接管理
 * daemon 启动时确保项目目录的 CLI 配置目录中存在正确的 symlink。
 */

import fs from 'fs';
import path from 'path';
import { PATHS } from '../../foundation/constants.js';
import { createLogger } from '../../foundation/logger.js';

const log = createLogger('daemon:links');

/**
 * CLI 类型 → 全局配置目录的映射
 * claude-code 的 --agent 从 ~/.claude/agents/ 加载 agent 定义
 * 导出供测试 mock
 */
import os from 'os';
const homeDir = os.homedir();

export const CLI_DIRS = {
  'claude-code': {
    agents: path.join(homeDir, '.claude', 'agents'),
    skills: path.join(homeDir, '.claude', 'skills'),
  },
  // opencode 的目录待确认，先留占位
};

/**
 * 确保 agent/skill 软链接正确
 *
 * 规则：
 * - 遍历 team agents 列表 → 为每个 agent 创建链接
 * - 遍历 ~/.openteam/skills/ 下所有目录 → 全部链接
 * - 如果目标路径已是正确的 symlink → 跳过
 * - 如果目标路径是非 symlink 的文件/目录 → 报错，中止启动
 * - 如果源文件不存在 → 警告但不中止（agent 可能还没写定义文件）
 *
 * @param {object} params
 * @param {string} params.teamName
 * @param {string} params.projectDir
 * @param {string} params.cliType - 'claude-code' | 'opencode'
 * @param {string[]} params.agents - 团队 agent 列表
 * @returns {{ ok: true, linked: string[], skipped: string[], warned: string[] } | { ok: false, error: string }}
 */
export function ensureLinks({ teamName, projectDir, cliType, agents }) {
  const dirs = CLI_DIRS[cliType];
  if (!dirs) {
    log.warn(`unsupported CLI type for symlinks: ${cliType}`);
    // 不支持的 CLI 类型不阻塞启动，只是没有链接
    return { ok: true, linked: [], skipped: [], warned: [`CLI type "${cliType}" 不支持 symlink`] };
  }

  const linked = [];
  const skipped = [];
  const warned = [];

  // ── Agent 链接 ──
  const agentTargetDir = dirs.agents;
  ensureDir(agentTargetDir);

  for (const agent of agents) {
    const source = path.join(PATHS.AGENTS_DEFS_DIR, `${agent}.md`);
    const target = path.join(agentTargetDir, `${agent}.md`);

    const result = ensureSymlink(source, target, `agent ${agent}`);
    if (!result.ok) return result; // 冲突 → 中止
    if (result.action === 'created') linked.push(target);
    else if (result.action === 'exists') skipped.push(target);
    else if (result.action === 'no-source') warned.push(`${agent}: 源文件不存在 (${source})`);
  }

  // ── Skill 链接 ──
  const skillTargetDir = dirs.skills;
  ensureDir(skillTargetDir);

  if (fs.existsSync(PATHS.SKILLS_DIR)) {
    let entries;
    try {
      entries = fs.readdirSync(PATHS.SKILLS_DIR, { withFileTypes: true });
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillName = entry.name;
      const source = path.join(PATHS.SKILLS_DIR, skillName);
      const target = path.join(skillTargetDir, skillName);

      const result = ensureSymlink(source, target, `skill ${skillName}`);
      if (!result.ok) return result; // 冲突 → 中止
      if (result.action === 'created') linked.push(target);
      else if (result.action === 'exists') skipped.push(target);
    }
  }

  if (linked.length > 0) {
    log.info('links.created', { count: linked.length });
  }
  if (warned.length > 0) {
    log.warn('links.warnings', { warnings: warned });
  }

  return { ok: true, linked, skipped, warned };
}

// ── 内部函数 ──

/**
 * 确保单个 symlink 正确
 * @returns {{ ok: true, action: 'created'|'exists'|'no-source' } | { ok: false, error: string }}
 */
function ensureSymlink(source, target, label) {
  // 源不存在 → 警告但不阻塞
  if (!fs.existsSync(source)) {
    log.warn(`${label}: 源不存在`, { source });
    return { ok: true, action: 'no-source' };
  }

  // 目标已存在
  if (fs.existsSync(target) || isSymlink(target)) {
    if (isSymlink(target)) {
      const existing = fs.readlinkSync(target);
      if (existing === source) {
        // 正确的 symlink，跳过
        return { ok: true, action: 'exists' };
      }
      // 指向别处的 symlink → 更新（删除旧的，创建新的）
      log.info(`${label}: 更新 symlink`, { from: existing, to: source });
      fs.unlinkSync(target);
      fs.symlinkSync(source, target);
      return { ok: true, action: 'created' };
    }

    // 非 symlink 的文件/目录 → 冲突，中止启动
    return {
      ok: false,
      error: `冲突: ${target} 已存在且不是 symlink。请手动处理后重试。`,
    };
  }

  // 目标不存在 → 创建
  fs.symlinkSync(source, target);
  log.info(`${label}: symlink 已创建`, { source, target });
  return { ok: true, action: 'created' };
}

/**
 * 检查路径是否是 symlink（即使目标不存在也能检测到 broken symlink）
 */
function isSymlink(p) {
  try {
    const stat = fs.lstatSync(p);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 确保目录存在
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
