/**
 * OpenCode Serve API wrapper
 *
 * 所有 fetch 调用统一带 timeout（默认 10s），防止挂起。
 */

const DEFAULT_TIMEOUT = 10000;

/**
 * 带 timeout 的 fetch 封装
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
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
export async function fetchMessages(serveUrl, sessionID) {
  const res = await fetchWithTimeout(`${serveUrl}/session/${sessionID}/message`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * List all sessions (no directory filter)
 */
export async function listAllSessions(serveUrl) {
  const res = await fetchWithTimeout(`${serveUrl}/session`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return [];
  return res.json();
}

/**
 * Create a new session
 */
export async function createSession(serveUrl, directory, title, metadata = null) {
  const body = { title };
  if (metadata) {
    body.metadata = metadata;
  }
  const res = await fetchWithTimeout(`${serveUrl}/session?directory=${encodeURIComponent(directory)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
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
  const { timeout = 120000, pollInterval = 500, model, system, wait = true } = options;

  // Get current message count (only if waiting for response)
  let beforeCount = 0;
  if (wait) {
    const beforeMessages = await fetchMessages(serveUrl, sessionID);
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
    30000, // POST 给更长的 timeout
  );

  if (!res.ok) return null;

  // If not waiting, return immediately after sending
  if (!wait) return { sent: true };

  // Poll for assistant response
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const messages = await fetchMessages(serveUrl, sessionID);
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
  const finalMessages = await fetchMessages(serveUrl, sessionID);
  if (finalMessages && finalMessages.length > beforeCount) {
    return finalMessages[finalMessages.length - 1];
  }

  return null;
}

/**
 * Get available providers and models
 */
export async function getProviders(serveUrl) {
  try {
    const res = await fetchWithTimeout(`${serveUrl}/provider`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Find a small/fast model from available providers
 * Matches opencode's getSmallModel logic:
 * - claude-haiku-4-5, claude-3-5-haiku
 * - gemini-2.5-flash, gemini-flash
 * - gpt-4o-mini, gpt-5-nano
 *
 * @param {string} serveUrl - OpenCode serve URL
 * @param {string} preferredProviderID - Preferred provider to search first (like opencode)
 */
// provider.models 可能是数组或对象（key-value map），统一转为数组
function getModelList(models) {
  if (Array.isArray(models)) return models;
  if (models && typeof models === 'object') return Object.values(models);
  return [];
}

export async function findSmallModel(serveUrl, preferredProviderID = null) {
  const raw = await getProviders(serveUrl);
  const providers = Array.isArray(raw) ? raw : raw?.all;
  if (!providers || !Array.isArray(providers)) return null;

  const smallModelPatterns = [
    /claude.*haiku/i,
    /gemini.*flash/i,
    /gpt-4o-mini/i,
    /gpt.*mini/i,
    /gpt.*nano/i,
    /mini/i,
    /flash/i,
  ];

  const sortedProviders = [...providers].sort((a, b) => {
    if (a.id === preferredProviderID) return -1;
    if (b.id === preferredProviderID) return 1;
    return 0;
  });

  if (preferredProviderID) {
    const preferredProvider = sortedProviders.find((p) => p.id === preferredProviderID);
    const models = getModelList(preferredProvider?.models);
    if (models.length > 0) {
      for (const pattern of smallModelPatterns) {
        for (const model of models) {
          if (pattern.test(model.id) || pattern.test(model.name || '')) {
            return { providerID: preferredProvider.id, modelID: model.id };
          }
        }
      }
    }
  }

  for (const pattern of smallModelPatterns) {
    for (const provider of sortedProviders) {
      const models = getModelList(provider.models);
      for (const model of models) {
        if (pattern.test(model.id) || pattern.test(model.name || '')) {
          return { providerID: provider.id, modelID: model.id };
        }
      }
    }
  }

  return null;
}

/**
 * Check if a session exists
 */
export async function sessionExists(serveUrl, sessionID) {
  try {
    const res = await fetchWithTimeout(`${serveUrl}/session/${sessionID}`, {
      headers: { Accept: 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}
