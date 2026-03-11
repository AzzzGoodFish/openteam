/**
 * REST API 路由 — wrapper 通信 + dashboard 数据
 *
 * 路由：
 *   POST /api/register          - wrapper 注册 agent
 *   POST /api/unregister        - wrapper 注销 agent
 *   GET  /api/messages/:agent   - wrapper 拉取待接收消息
 *   GET  /api/status            - dashboard 获取 agent 状态
 *   GET  /api/tasks             - dashboard 获取任务列表
 *
 * 用 Node.js 原生 http，不引入 Express。
 */

import { createLogger } from '../foundation/logger.js';

const log = createLogger('routes');

/**
 * 读取请求 body（JSON）
 * @returns {Promise<object|null>}
 */
function readJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

/**
 * 发送 JSON 响应
 */
function json(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * 处理 REST API 请求
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {URL} url - 已解析的 URL 对象
 * @param {MessageHub} hub
 * @param {{ teamName: string, projectDir: string }} context
 * @returns {boolean} 是否匹配到路由（true = 已处理）
 */
export function handleApiRequest(req, res, url, hub, context) {
  const { teamName, projectDir } = context;
  const pathname = url.pathname;
  const method = req.method;

  // POST /api/register
  if (method === 'POST' && pathname === '/api/register') {
    readJsonBody(req).then(body => {
      if (!body || !body.agent) {
        json(res, 400, { error: 'missing "agent" field' });
        return;
      }
      hub.register(body.agent, body.meta || {});
      json(res, 200, { ok: true, agent: body.agent });
    });
    return true;
  }

  // POST /api/unregister
  if (method === 'POST' && pathname === '/api/unregister') {
    readJsonBody(req).then(body => {
      if (!body || !body.agent) {
        json(res, 400, { error: 'missing "agent" field' });
        return;
      }
      hub.unregister(body.agent);
      json(res, 200, { ok: true, agent: body.agent });
    });
    return true;
  }

  // POST /api/heartbeat — wrapper 上报活动状态
  if (method === 'POST' && pathname === '/api/heartbeat') {
    readJsonBody(req).then(body => {
      if (!body || !body.agent) {
        json(res, 400, { error: 'missing "agent" field' });
        return;
      }
      hub.updateActivity(body.agent, !!body.active);
      json(res, 200, { ok: true });
    });
    return true;
  }

  // GET /api/messages/log — 消息日志（dashboard 用）
  // 必须在 /api/messages/:agent 之前，否则 "log" 会被当作 agent 名
  if (method === 'GET' && pathname === '/api/messages/log') {
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const messages = hub.getMessageLog(limit);
    json(res, 200, { messages });
    return true;
  }

  // GET /api/messages/:agent
  const messagesMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (method === 'GET' && messagesMatch) {
    const agent = decodeURIComponent(messagesMatch[1]);
    const messages = hub.pull(agent);
    json(res, 200, { messages });
    return true;
  }

  // GET /api/status
  if (method === 'GET' && pathname === '/api/status') {
    const status = hub.status();
    json(res, 200, { status });
    return true;
  }

  // GET /api/tasks
  if (method === 'GET' && pathname === '/api/tasks') {
    // 动态 import 避免循环依赖
    import('../capabilities/taskboard.js').then(({ listTasks }) => {
      const tasks = listTasks(teamName, projectDir);
      json(res, 200, { tasks });
    }).catch(err => {
      log.error('tasks.list.failed', { error: err.message });
      json(res, 500, { error: 'failed to list tasks' });
    });
    return true;
  }

  // 未匹配
  return false;
}
