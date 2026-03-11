/**
 * 消息中枢 — 纯内存，无文件 IO
 *
 * 管理 agent 注册/注销、消息投递/广播/拉取。
 * server 崩溃后消息丢失可接受 — daemon 会重启 server，agent 重新连接。
 */

import { createLogger } from '../foundation/logger.js';

const log = createLogger('hub');

const MAX_LOG_SIZE = 200;

export class MessageHub {
  constructor() {
    this.agents = new Map();   // agentName → { registeredAt, pid?, ... }
    this.queues = new Map();   // agentName → [{ from, message, timestamp }]
    this.messageLog = [];      // 消息日志 ring buffer（最近 200 条）
  }

  /**
   * wrapper 启动时注册 agent
   */
  register(agentName, meta = {}) {
    this.agents.set(agentName, { registeredAt: Date.now(), ...meta });
    if (!this.queues.has(agentName)) {
      this.queues.set(agentName, []);
    }
    log.info('agent.register', { agent: agentName });
  }

  /**
   * wrapper 退出时注销 agent
   * 不清空队列 — 重连后可以收到积压消息
   */
  unregister(agentName) {
    this.agents.delete(agentName);
    log.info('agent.unregister', { agent: agentName });
  }

  /**
   * agent 是否在线（已注册）
   */
  isOnline(agentName) {
    return this.agents.has(agentName);
  }

  /**
   * 更新 agent 活动状态
   */
  updateActivity(agentName, active) {
    const meta = this.agents.get(agentName);
    if (meta) {
      meta.active = active;
    }
  }

  /**
   * 投递单条消息到目标 agent 队列
   * @returns {{ delivered: true, online: boolean }}
   */
  deliver({ from, to, message }) {
    if (!this.queues.has(to)) {
      this.queues.set(to, []);
    }
    const entry = { from, message, timestamp: Date.now() };
    this.queues.get(to).push(entry);
    this.messageLog.push({ from, to, message, timestamp: entry.timestamp });
    if (this.messageLog.length > MAX_LOG_SIZE) {
      this.messageLog.splice(0, this.messageLog.length - MAX_LOG_SIZE);
    }
    log.info('msg.deliver', { from, to, preview: message.slice(0, 50) });
    return { delivered: true, online: this.isOnline(to) };
  }

  /**
   * 广播消息给指定 agents（排除发送者）
   * @param {object} params
   * @param {string} params.from - 发送者
   * @param {string} params.message - 消息内容
   * @param {string[]} params.agents - 目标 agent 列表
   * @returns {Array<{ to, delivered, online }>}
   */
  broadcast({ from, message, agents }) {
    const results = [];
    for (const to of agents) {
      if (to === from) continue;
      results.push({ to, ...this.deliver({ from, to, message }) });
    }
    return results;
  }

  /**
   * wrapper 拉取待接收消息（取走后清空）
   * @returns {Array<{ from, message, timestamp }>}
   */
  pull(agentName) {
    const queue = this.queues.get(agentName);
    if (!queue || queue.length === 0) return [];
    const messages = [...queue];
    queue.length = 0;
    return messages;
  }

  /**
   * 获取消息日志（最近 N 条）
   * @param {number} [limit=50] - 返回条数上限
   * @returns {Array<{ from, to, message, timestamp }>}
   */
  getMessageLog(limit = 50) {
    const start = Math.max(0, this.messageLog.length - limit);
    return this.messageLog.slice(start);
  }

  /**
   * 所有 agent 状态概览
   * @returns {Object} agentName → { online, registeredAt, pending, ... }
   */
  status() {
    const result = {};
    // 已注册的 agent
    for (const [name, meta] of this.agents) {
      result[name] = { online: true, ...meta, pending: this.queues.get(name)?.length || 0 };
    }
    // 离线但有积压消息的 agent
    for (const [name, queue] of this.queues) {
      if (!result[name] && queue.length > 0) {
        result[name] = { online: false, pending: queue.length };
      }
    }
    return result;
  }
}
