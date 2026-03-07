/**
 * OpenCode Serve HTTP API 封装
 *
 * 所有 fetch 调用统一带 timeout（默认 10s），防止挂起。
 */

import { createLogger } from './logger.js';

const log = createLogger('opencode');
const DEFAULT_TIMEOUT = 10000;

/**
 * 带 timeout 的 fetch 封装
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT, meta = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const method = options.method || 'GET';

  if (meta?.trace) {
    log.info('http.start', {
      trace: meta.trace,
      method,
      url,
      timeoutMs,
      reason: meta.reason,
    });
  }

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    if (meta?.trace) {
      log.info('http.done', {
        trace: meta.trace,
        method,
        url,
        status: res.status,
        ok: res.ok,
        durationMs: Date.now() - startedAt,
        reason: meta.reason,
      });
    }
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    if (meta?.trace) {
      log.error('http.failed', {
        trace: meta.trace,
        method,
        url,
        durationMs: Date.now() - startedAt,
        error: err.message,
        name: err.name,
        reason: meta.reason,
      });
    }
    throw err;
  }
}

/**
 * Fetch session metadata
 */
export async function fetchSession(serveUrl, sessionID) {
  const res = await fetchWithTimeout(`${serveUrl}/session/${sessionID}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Fetch messages for a session
 */
export async function fetchMessages(serveUrl, sessionID, timeoutMs = DEFAULT_TIMEOUT, meta = null) {
  const res = await fetchWithTimeout(`${serveUrl}/session/${sessionID}/message`, {
    headers: { Accept: 'application/json' },
  }, timeoutMs, meta?.trace ? { ...meta, reason: meta.reason || 'fetchMessages' } : null);
  if (!res.ok) return null;
  return res.json();
}

/**
 * List all sessions (no directory filter)
 */
async function listAllSessions(serveUrl) {
  const res = await fetchWithTimeout(`${serveUrl}/session`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return [];
  return res.json();
}

/**
 * 检查 serve 是否可达（健康检查）
 * @returns {Promise<boolean>}
 */
export async function checkHealth(serveUrl) {
  try {
    await listAllSessions(serveUrl);
    return true;
  } catch (err) {
    log.error('checkHealth failed', { url: serveUrl, error: err.message });
    return false;
  }
}

/**
 * Create a new session
 */
export async function createSession(serveUrl, directory, title, metadata = null, meta = null) {
  const body = { title };
  if (metadata) {
    body.metadata = metadata;
  }
  const res = await fetchWithTimeout(`${serveUrl}/session?directory=${encodeURIComponent(directory)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  }, DEFAULT_TIMEOUT, meta?.trace ? { ...meta, reason: meta.reason || 'createSession' } : null);
  if (!res.ok) return null;
  return res.json();
}

/**
 * Send a message to a session and wait for response
 *
 * @param {string} serveUrl - OpenCode serve URL
 * @param {string} sessionID - Session ID
 * @param {string} directory - Working directory
 * @param {string} agent - Agent name (team/agent format)
 * @param {string} message - Message text
 * @param {object} options - Options
 * @param {number} options.timeout - Timeout in ms (default: 120000)
 * @param {number} options.pollInterval - Poll interval in ms (default: 500)
 * @param {object} options.model - Model to use { providerID, modelID }
 * @param {string} options.system - Custom system prompt
 */
export async function postMessage(serveUrl, sessionID, directory, agent, message, options = {}) {
  const { timeout = 120000, pollInterval = 500, model, system, wait = true, trace = null } = options;

  log.info('postMessage.start', {
    trace,
    serveUrl,
    sessionID,
    directory,
    agent,
    wait,
    messagePreview: message.slice(0, 80),
  });

  // Get current message count (only if waiting for response)
  let beforeCount = 0;
  if (wait) {
    const beforeMessages = await fetchMessages(serveUrl, sessionID, DEFAULT_TIMEOUT, { trace, reason: 'postMessage.beforeFetch' });
    beforeCount = beforeMessages?.length || 0;
  }

  // Build request body
  const body = {
    agent,
    parts: [{ type: 'text', text: message }],
  };
  if (model) body.model = model;
  if (system) body.system = system;

  // POST the message (use prompt_async to ensure TUI updates correctly)
  const res = await fetchWithTimeout(
    `${serveUrl}/session/${sessionID}/prompt_async?directory=${encodeURIComponent(directory)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    },
    30000,
    trace ? { trace, reason: 'postMessage.prompt_async' } : null,
  );

  if (!res.ok) {
    log.warn('postMessage.nonOk', { trace, sessionID, status: res.status });
    return null;
  }

  // If not waiting, return immediately after sending
  if (!wait) {
    log.info('postMessage.sent', { trace, sessionID, status: res.status });
    return { sent: true };
  }

  // Poll for assistant response
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const messages = await fetchMessages(serveUrl, sessionID, DEFAULT_TIMEOUT, { trace, reason: 'postMessage.poll' });
    if (!messages) continue;

    // Check if we have a new assistant message
    if (messages.length > beforeCount) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.info?.role === 'assistant') {
        // Check if message is complete (has finish status)
        if (lastMsg.info.finish) {
          return lastMsg;
        }
      }
    }
  }

  // Timeout - return last message anyway
  const finalMessages = await fetchMessages(serveUrl, sessionID, DEFAULT_TIMEOUT, { trace, reason: 'postMessage.finalFetch' });
  if (finalMessages && finalMessages.length > beforeCount) {
    return finalMessages[finalMessages.length - 1];
  }

  return null;
}

/**
 * Check if a session exists
 */
export async function sessionExists(serveUrl, sessionID, meta = null) {
  try {
    const res = await fetchWithTimeout(`${serveUrl}/session/${sessionID}`, {
      headers: { Accept: 'application/json' },
    }, DEFAULT_TIMEOUT, meta?.trace ? { ...meta, reason: meta.reason || 'sessionExists' } : null);
    return res.ok;
  } catch (err) {
    log.error('sessionExists failed', { trace: meta?.trace, sessionID, url: serveUrl, error: err.message, reason: meta?.reason });
    return false;
  }
}
