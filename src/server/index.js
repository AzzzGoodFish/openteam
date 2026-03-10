/**
 * openteam server — HTTP + MCP + REST API
 *
 * 路由分发：
 *   /mcp   → MCP Streamable HTTP transport（agent 工具调用）
 *   /api/* → REST API（wrapper 通信 + dashboard 数据）
 *   其他   → 404
 *
 * MCP 每个 session 对应一个独立的 McpServer 实例（SDK 限制：一个 McpServer 只能 connect 一个 transport）。
 * agent 身份通过 URL 参数 ?agent=xxx 在 session 初始化时捕获，存入 sessionAgentMap。
 */

import crypto from 'crypto';
import { createServer } from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { MessageHub } from './hub.js';
import { setupMcpTools } from './mcp.js';
import { handleApiRequest } from './routes.js';
import { createLogger } from '../foundation/logger.js';

const log = createLogger('server');

/**
 * 启动 openteam server
 *
 * @param {{ teamName: string, projectDir: string, teamConfig: object, host: string, port: number }} options
 * @returns {Promise<{ server: http.Server, hub: MessageHub, url: string, close: () => Promise<void> }>}
 */
export async function startServer(options) {
  const { teamName, projectDir, teamConfig, host, port } = options;

  const hub = new MessageHub();

  // MCP session → agent 映射
  const sessionAgentMap = new Map();  // mcpSessionId → agentName
  // MCP session → transport 映射
  const transports = new Map();       // mcpSessionId → transport
  // MCP session → McpServer 映射（每个 session 独立实例）
  const mcpServers = new Map();       // mcpSessionId → McpServer

  /**
   * 从 MCP tool handler 的 ctx 中获取调用者 agent 身份
   */
  function getAgentFromSession(ctx) {
    const sessionId = ctx.sessionId;
    if (!sessionId) {
      log.warn('getAgentFromSession: no sessionId in ctx');
      return null;
    }
    const agent = sessionAgentMap.get(sessionId);
    if (!agent) {
      log.warn('getAgentFromSession: unknown session', { sessionId });
      return null;
    }
    return agent;
  }

  const teamContext = { teamName, projectDir, teamConfig };

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);

    // ── MCP endpoint ──
    if (url.pathname === '/mcp') {
      try {
        await handleMcpRequest(req, res, url);
      } catch (err) {
        log.error('mcp.request.error', { error: err.message });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
        }
      }
      return;
    }

    // ── REST API ──
    if (url.pathname.startsWith('/api/')) {
      const handled = handleApiRequest(req, res, url, hub, { teamName, projectDir });
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      }
      return;
    }

    // ── 404 ──
    res.writeHead(404).end('Not found');
  });

  /**
   * 处理 MCP 请求（POST 和 GET）
   */
  async function handleMcpRequest(req, res, url) {
    const agentName = url.searchParams.get('agent');

    if (req.method === 'POST') {
      // 读取 body
      let body = '';
      for await (const chunk of req) body += chunk;
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }));
        return;
      }

      const sessionId = req.headers['mcp-session-id'];

      if (sessionId && transports.has(sessionId)) {
        // 已有 session — 转发给对应 transport
        await transports.get(sessionId).handleRequest(req, res, parsed);
        return;
      }

      if (isInitializeRequest(parsed)) {
        // 新 session — 创建独立的 McpServer + transport
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport);
            if (agentName) {
              sessionAgentMap.set(id, agentName);
              log.info('mcp.session.init', { sessionId: id, agent: agentName });
            }
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            transports.delete(sid);
            sessionAgentMap.delete(sid);
            mcpServers.delete(sid);
            log.info('mcp.session.close', { sessionId: sid });
          }
        };

        // 每个 session 独立的 McpServer（SDK 限制：一个 McpServer 只能 connect 一个 transport）
        const mcpServer = new McpServer({ name: 'openteam', version: '2.0.0' });
        setupMcpTools(mcpServer, hub, getAgentFromSession, teamContext);
        await mcpServer.connect(transport);

        // 存储 mcpServer 引用（用于清理）
        if (transport.sessionId) {
          mcpServers.set(transport.sessionId, mcpServer);
        }

        await transport.handleRequest(req, res, parsed);
        return;
      }

      // 既不是已有 session，也不是 initialize 请求
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Invalid session' }, id: null }));
      return;
    }

    if (req.method === 'GET') {
      // SSE streaming（MCP 通知推送）
      const sessionId = req.headers['mcp-session-id'];
      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId).handleRequest(req, res);
      } else {
        res.writeHead(400).end('Invalid session');
      }
      return;
    }

    if (req.method === 'DELETE') {
      // 关闭 MCP session
      const sessionId = req.headers['mcp-session-id'];
      if (sessionId && transports.has(sessionId)) {
        await transports.get(sessionId).handleRequest(req, res);
      } else {
        res.writeHead(400).end('Invalid session');
      }
      return;
    }

    res.writeHead(405).end('Method not allowed');
  }

  await new Promise(resolve => httpServer.listen(port, host, resolve));

  log.info('server.started', { host, port, team: teamName });

  return {
    server: httpServer,
    hub,
    url: `http://${host}:${port}`,
    close: () => new Promise((resolve, reject) => {
      // 关闭所有 MCP transport
      for (const [sid, transport] of transports) {
        try { transport.close?.(); } catch {}
      }
      transports.clear();
      sessionAgentMap.clear();
      mcpServers.clear();

      httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
      log.info('server.stopped');
    }),
  };
}
