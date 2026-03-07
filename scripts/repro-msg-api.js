import { spawn } from 'child_process';
import { once } from 'events';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate port'));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      data,
      text,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      error: error.message,
      name: error.name,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForServe(baseUrl, serveProcess, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (serveProcess.exitCode !== null) {
      throw new Error(`serve exited early with code ${serveProcess.exitCode}`);
    }
    const result = await fetchWithTimeout(`${baseUrl}/session`, {
      headers: { Accept: 'application/json' },
    }, 1000);
    if (result.ok) return;
    await sleep(250);
  }
  throw new Error(`serve did not become ready within ${timeoutMs}ms`);
}

async function createSession(baseUrl, directory, title) {
  const result = await fetchWithTimeout(
    `${baseUrl}/session?directory=${encodeURIComponent(directory)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ title }),
    },
    10000,
  );

  if (!result.ok) {
    throw new Error(`createSession failed: ${JSON.stringify(result)}`);
  }

  return result.data;
}

async function printStatus(baseUrl, label) {
  const result = await fetchWithTimeout(`${baseUrl}/session/status`, {
    headers: { Accept: 'application/json' },
  }, 3000);
  console.log(`\n[status] ${label}`);
  console.log(JSON.stringify(result.data ?? result, null, 2));
}

async function printMessageCount(baseUrl, sessionID, label) {
  const result = await fetchWithTimeout(`${baseUrl}/session/${sessionID}/message`, {
    headers: { Accept: 'application/json' },
  }, 3000);
  const count = Array.isArray(result.data) ? result.data.length : null;
  console.log(`[messages] ${label}: count=${count}`);
}

async function runCase(baseUrl, label, sessionID, directory, endpoint, body, timeoutMs = 10000) {
  console.log(`\n=== ${label} ===`);
  const result = await fetchWithTimeout(
    `${baseUrl}/session/${sessionID}/${endpoint}?directory=${encodeURIComponent(directory)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function stopServe(serveProcess) {
  if (!serveProcess || serveProcess.exitCode !== null) return;
  serveProcess.kill('SIGTERM');
  const settled = await Promise.race([
    once(serveProcess, 'exit').then(() => true),
    sleep(3000).then(() => false),
  ]);
  if (!settled) {
    serveProcess.kill('SIGKILL');
    await once(serveProcess, 'exit');
  }
}

function getReproTeamDir(teamName) {
  return path.join(os.homedir(), '.opencode', 'agents', teamName);
}

function setupReproTeam(teamName, port, pid) {
  const teamDir = getReproTeamDir(teamName);
  if (fs.existsSync(teamDir)) {
    throw new Error(`Refusing to reuse existing team dir: ${teamDir}`);
  }

  fs.mkdirSync(teamDir, { recursive: true });
  fs.writeFileSync(path.join(teamDir, 'team.json'), JSON.stringify({
    name: teamName,
    leader: 'pm',
    host: '127.0.0.1',
    port: 0,
    agents: ['pm', 'architect', 'developer', 'qa'],
  }, null, 2));
  fs.writeFileSync(path.join(teamDir, '.active-sessions.json'), '{}\n');
  fs.writeFileSync(path.join(teamDir, '.runtime.json'), JSON.stringify({
    daemon: { pid },
    serve: { pid, host: '127.0.0.1', port },
  }, null, 2));

  return teamDir;
}

function cleanupReproTeam(teamName) {
  const teamDir = getReproTeamDir(teamName);
  if (fs.existsSync(teamDir)) {
    fs.rmSync(teamDir, { recursive: true, force: true });
  }
}

async function main() {
  const port = await getFreePort();
  const directory = process.cwd();
  const baseUrl = `http://127.0.0.1:${port}`;
  const enablePlugin = process.env.REPRO_OPENTEAM_PLUGIN === '1';
  const reproTeam = enablePlugin ? `repro-msg-api-${process.pid}` : null;
  const serveProcess = spawn('opencode', ['serve', '--port', String(port)], {
    cwd: directory,
    env: {
      ...process.env,
      ...(reproTeam ? { OPENTEAM_TEAM: reproTeam } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let stdout = '';
  serveProcess.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  serveProcess.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    console.log(`Starting isolated opencode serve at ${baseUrl}`);
    await waitForServe(baseUrl, serveProcess);
    console.log('serve is ready');
    if (reproTeam) {
      const teamDir = setupReproTeam(reproTeam, port, serveProcess.pid);
      console.log(`openteam plugin mode enabled via ${teamDir}`);
    }

    const sessionA = await createSession(baseUrl, directory, 'repro-a');
    const sessionB = await createSession(baseUrl, directory, 'repro-b');
    console.log(`sessionA=${sessionA.id}`);
    console.log(`sessionB=${sessionB.id}`);

    await printStatus(baseUrl, 'initial');
    await printMessageCount(baseUrl, sessionA.id, 'sessionA initial');
    await printMessageCount(baseUrl, sessionB.id, 'sessionB initial');

    await runCase(baseUrl, 'A prompt_async #1', sessionA.id, directory, 'prompt_async', {
      parts: [{ type: 'text', text: 'First async prompt from repro script.' }],
    });
    await sleep(1000);
    await printStatus(baseUrl, 'after A prompt_async #1');
    await printMessageCount(baseUrl, sessionA.id, 'sessionA after #1');

    await runCase(baseUrl, 'A prompt_async #2', sessionA.id, directory, 'prompt_async', {
      parts: [{ type: 'text', text: 'Second async prompt from repro script.' }],
    });
    await sleep(1000);
    await printStatus(baseUrl, 'after A prompt_async #2');
    await printMessageCount(baseUrl, sessionA.id, 'sessionA after #2');

    await runCase(baseUrl, 'B prompt_async while A may still be active', sessionB.id, directory, 'prompt_async', {
      parts: [{ type: 'text', text: 'Prompt on another session while A may be active.' }],
    });
    await sleep(1000);
    await printStatus(baseUrl, 'after B prompt_async');
    await printMessageCount(baseUrl, sessionB.id, 'sessionB after prompt_async');

    await runCase(baseUrl, 'B message noReply=true', sessionB.id, directory, 'message', {
      noReply: true,
      parts: [{ type: 'text', text: 'No-reply message on session B.' }],
    });
    await sleep(500);
    await printStatus(baseUrl, 'after B message noReply');
    await printMessageCount(baseUrl, sessionB.id, 'sessionB after message noReply');

    await runCase(baseUrl, 'A prompt_async noReply=true', sessionA.id, directory, 'prompt_async', {
      noReply: true,
      parts: [{ type: 'text', text: 'Async no-reply prompt on session A.' }],
    });
    await sleep(500);
    await printStatus(baseUrl, 'after A prompt_async noReply');
    await printMessageCount(baseUrl, sessionA.id, 'sessionA after prompt_async noReply');

    await runCase(baseUrl, 'Abort session A', sessionA.id, directory, 'abort', {}, 3000);
    await runCase(baseUrl, 'Abort session B', sessionB.id, directory, 'abort', {}, 3000);
    await printStatus(baseUrl, 'after aborts');
  } finally {
    await stopServe(serveProcess);
    if (reproTeam) {
      cleanupReproTeam(reproTeam);
    }
    if (stdout.trim()) {
      console.log('\n[serve stdout]');
      console.log(stdout.trim());
    }
    if (stderr.trim()) {
      console.log('\n[serve stderr]');
      console.log(stderr.trim());
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
