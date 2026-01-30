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
 */
export async function postMessage(serveUrl, sessionID, directory, agent, message, options = {}) {
  const { timeout = 120000, pollInterval = 500 } = options;

  // Get current message count
  const beforeMessages = await fetchMessages(serveUrl, sessionID);
  const beforeCount = beforeMessages?.length || 0;

  // POST the message
  const res = await fetch(
    `${serveUrl}/session/${sessionID}/message?directory=${encodeURIComponent(directory)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        agent,
        parts: [{ type: 'text', text: message }],
      }),
    }
  );

  if (!res.ok) return null;

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
