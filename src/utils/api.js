/**
 * OpenCode Serve API wrapper
 */

/**
 * Fetch session metadata
 */
export async function fetchSession(serveUrl, sessionID) {
  const res = await fetch(`${serveUrl}/session/${sessionID}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Fetch messages for a session
 */
export async function fetchMessages(serveUrl, sessionID) {
  const res = await fetch(`${serveUrl}/session/${sessionID}/message`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * List all sessions (no directory filter)
 */
export async function listAllSessions(serveUrl) {
  const res = await fetch(`${serveUrl}/session`, {
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
  const res = await fetch(`${serveUrl}/session?directory=${encodeURIComponent(directory)}`, {
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
  const res = await fetch(
    `${serveUrl}/session/${sessionID}/prompt_async?directory=${encodeURIComponent(directory)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    }
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
    const res = await fetch(`${serveUrl}/provider`, {
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
export async function findSmallModel(serveUrl, preferredProviderID = null) {
  const providers = await getProviders(serveUrl);
  if (!providers || !Array.isArray(providers)) return null;

  // Priority patterns matching opencode's logic (order matters)
  const smallModelPatterns = [
    /claude.*haiku/i,      // claude-haiku-4-5, claude-3-5-haiku, claude-3-haiku
    /gemini.*flash/i,      // gemini-2.5-flash, gemini-flash
    /gpt-4o-mini/i,        // gpt-4o-mini
    /gpt.*mini/i,          // gpt-5-mini, etc
    /gpt.*nano/i,          // gpt-5-nano
    /mini/i,               // fallback: any mini model
    /flash/i,              // fallback: any flash model
  ];

  // Sort providers: preferred provider first (matching opencode behavior)
  const sortedProviders = [...providers].sort((a, b) => {
    if (a.id === preferredProviderID) return -1;
    if (b.id === preferredProviderID) return 1;
    return 0;
  });

  // If preferred provider is specified, first try to find small model within it only
  if (preferredProviderID) {
    const preferredProvider = sortedProviders.find((p) => p.id === preferredProviderID);
    if (preferredProvider?.models) {
      for (const pattern of smallModelPatterns) {
        for (const model of preferredProvider.models) {
          if (pattern.test(model.id) || pattern.test(model.name || '')) {
            return {
              providerID: preferredProvider.id,
              modelID: model.id,
            };
          }
        }
      }
    }
  }

  // Fallback: search all providers
  for (const pattern of smallModelPatterns) {
    for (const provider of sortedProviders) {
      if (!provider.models) continue;
      for (const model of provider.models) {
        if (pattern.test(model.id) || pattern.test(model.name || '')) {
          return {
            providerID: provider.id,
            modelID: model.id,
          };
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
    const res = await fetch(`${serveUrl}/session/${sessionID}`, {
      headers: { Accept: 'application/json' },
    });
    return res.ok;
  } catch {
    return false;
  }
}
