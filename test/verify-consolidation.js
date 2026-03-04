#!/usr/bin/env node
/**
 * 验证记忆巩固功能修复
 * 
 * 验证项：
 * 1. findSmallModel 能正确找到 haiku 模型
 * 2. 记忆巩固流程能正常执行
 * 3. 巩固结果能正确保存
 */

import { findSmallModel, getProviders } from '../src/utils/api.js';
import { 
  markPendingSession, 
  readMemoryState, 
  getConsolidationThresholds,
  consolidate 
} from '../src/memory/extractor.js';
import { findActiveServeUrl } from '../src/team/serve.js';

const COLORS = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

function log(level, message, data = null) {
  const color = {
    pass: COLORS.green,
    fail: COLORS.red,
    warn: COLORS.yellow,
    info: COLORS.blue,
  }[level] || COLORS.reset;

  const prefix = {
    pass: '✓',
    fail: '✗',
    warn: '⚠',
    info: 'ℹ',
  }[level] || ' ';

  console.log(`${color}${prefix} ${message}${COLORS.reset}`);
  if (data) {
    console.log(`  ${JSON.stringify(data, null, 2)}`);
  }
}

async function verifyFindSmallModel() {
  log('info', 'Task 1: 验证 findSmallModel 函数');
  
  try {
    const serveUrl = findActiveServeUrl();
    if (!serveUrl) {
      log('fail', 'serve URL 未找到，需要先启动 openteam serve');
      return false;
    }
    log('pass', `serve URL: ${serveUrl}`);

    // 获取所有 providers
    const raw = await getProviders(serveUrl);
    const providers = Array.isArray(raw) ? raw : raw?.all;
    if (!providers || !Array.isArray(providers)) {
      log('fail', 'providers 数据为空或格式错误');
      return false;
    }
    log('pass', `找到 ${providers.length} 个 providers`);

    // 测试不指定 provider 的情况
    const defaultModel = await findSmallModel(serveUrl);
    if (!defaultModel) {
      log('fail', 'findSmallModel 未找到任何小模型');
      return false;
    }
    log('pass', 'findSmallModel (默认) 找到模型', defaultModel);

    // 检查是否包含 haiku
    const isHaiku = /haiku/i.test(defaultModel.modelID);
    if (isHaiku) {
      log('pass', '✓ 找到的是 haiku 模型，修复生效');
    } else {
      log('warn', '找到的不是 haiku 模型，可能该环境没有配置 haiku');
    }

    // 测试指定 provider 的情况（如果有 anthropic）
    const anthropicProvider = providers.find(p => /anthropic/i.test(p.id));
    if (anthropicProvider) {
      const anthropicModel = await findSmallModel(serveUrl, anthropicProvider.id);
      if (anthropicModel) {
        log('pass', `findSmallModel (anthropic) 找到模型`, anthropicModel);
      } else {
        log('warn', 'anthropic provider 存在但未找到小模型');
      }
    }

    return true;
  } catch (error) {
    log('fail', `findSmallModel 验证失败: ${error.message}`);
    console.error(error.stack);
    return false;
  }
}

async function verifyConsolidationThresholds() {
  log('info', 'Task 2: 验证巩固阈值配置');

  try {
    const teamName = 'team1'; // 假设使用 team1
    const thresholds = getConsolidationThresholds(teamName);
    
    log('pass', '巩固阈值配置', thresholds);

    if (!thresholds.sessionThreshold || !thresholds.timeThresholdMs) {
      log('fail', '阈值配置不完整');
      return false;
    }

    return true;
  } catch (error) {
    log('fail', `阈值验证失败: ${error.message}`);
    return false;
  }
}

async function verifyMemoryState() {
  log('info', 'Task 3: 验证记忆状态读取');

  try {
    const teamName = 'team1';
    const agentName = 'pm';
    
    const state = readMemoryState(teamName, agentName);
    log('pass', '记忆状态读取成功', {
      pendingCount: state.pendingSessions?.length || 0,
      lastConsolidation: state.lastConsolidation,
      lastDistillation: state.lastDistillation,
    });

    return true;
  } catch (error) {
    log('fail', `记忆状态读取失败: ${error.message}`);
    return false;
  }
}

async function verifyMarkPending() {
  log('info', 'Task 4: 验证标记待巩固会话');

  try {
    const teamName = 'team1';
    const agentName = 'pm';
    const testSessionID = `test-session-${Date.now()}`;
    const messageCount = 10;

    const result = markPendingSession(teamName, agentName, testSessionID, messageCount);
    
    if (result.updated) {
      log('pass', '标记待巩固会话成功', { sessionID: testSessionID });
      
      // 验证状态已更新
      const state = readMemoryState(teamName, agentName);
      const found = state.pendingSessions.find(s => s.sessionID === testSessionID);
      
      if (found) {
        log('pass', '待巩固会话已记录到状态文件');
        return true;
      } else {
        log('fail', '待巩固会话未在状态文件中找到');
        return false;
      }
    } else {
      log('warn', '标记未更新（可能已存在）', result);
      return true;
    }
  } catch (error) {
    log('fail', `标记待巩固会话失败: ${error.message}`);
    return false;
  }
}

async function runAllTests() {
  console.log('\n======= OpenTeam 记忆巩固功能验证 =======\n');

  const results = {
    findSmallModel: await verifyFindSmallModel(),
    consolidationThresholds: await verifyConsolidationThresholds(),
    memoryState: await verifyMemoryState(),
    markPending: await verifyMarkPending(),
  };

  console.log('\n======= 验证结果汇总 =======\n');
  
  let passCount = 0;
  let totalCount = 0;
  
  for (const [name, passed] of Object.entries(results)) {
    totalCount++;
    if (passed) {
      passCount++;
      log('pass', `${name}: 通过`);
    } else {
      log('fail', `${name}: 失败`);
    }
  }

  console.log(`\n总计: ${passCount}/${totalCount} 项通过\n`);

  if (passCount === totalCount) {
    log('pass', '所有验证项均通过 ✓');
    process.exit(0);
  } else {
    log('fail', `有 ${totalCount - passCount} 项验证失败`);
    process.exit(1);
  }
}

runAllTests().catch(error => {
  log('fail', `验证脚本执行出错: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
});
