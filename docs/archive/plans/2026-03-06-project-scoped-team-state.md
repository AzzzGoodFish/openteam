# Implementation Plan: Project-Scoped Team State

**Status**: Draft
**Architect**: architect
**Date**: 2026-03-06

## Problem

Team state (runtime, sessions) is keyed by `teamName` only. This causes two critical issues:

1. **msg tool hangs** — When a team is stopped then restarted from a different directory, old sessions retain their previous `cwd`. `postMessage` uses `inst.cwd` as the HTTP `?directory=` parameter. When this differs from the serve's bootstrapped directory, `opencode serve` attempts `InstanceBootstrap()` for the new directory (loading plugins, starting LSP, file watchers...) and hangs indefinitely. All subsequent HTTP requests to that directory also hang because the bootstrap promise is cached.

2. **One team per machine** — The same `team.json` config (e.g., `dev` with pm/architect/developer/qa) cannot run independently on two different projects simultaneously. State paths (`~/.opencode/agents/<teamName>/`) and mux session names (`openteam-<teamName>`) collide.

## Root Cause Chain

```
openteam stop dev               (in /projectA)
  → .runtime.json deleted
  → .active-sessions.json SURVIVES (sessions with cwd=/projectA)

openteam start dev               (in /projectB)
  → serve bootstraps /projectB
  → recoverSessions() finds old sessions with cwd=/projectA → keeps them
  → ensureAgent() finds existing session → reuses without updating cwd
  → inst.cwd = /projectA, serve only bootstrapped /projectB

agent uses msg tool
  → postMessage(serveUrl, sessionId, inst.cwd=/projectA, ...)
  → serve receives ?directory=/projectA → new directory → InstanceBootstrap() → HANGS
```

## Design

**Principle**: Config (team.json) is shared — it defines WHO is on the team. State (runtime, sessions) is per-project — it tracks a running team instance.

### Directory Structure

```
~/.opencode/agents/<teamName>/
  team.json                              ← CONFIG (shared, unchanged)
  <hash(projectDir)>/                    ← STATE (per-project, NEW)
    .runtime.json
    .active-sessions.json
```

Hash: SHA-256 of `projectDir`, truncated to 8 hex chars. Deterministic, filesystem-safe, sufficient collision resistance for one machine.

### Mux Session Naming

```
Current:  openteam-<teamName>
New:      openteam-<teamName>-<hash8>
Example:  openteam-dev-a1b2c3d4
```

Stored in `.runtime.json` as `mux.session`. Commands that read from runtime don't need to reconstruct the name.

### Plugin Context

Daemon already sets `OPENTEAM_TEAM` env var on serve process. Add `OPENTEAM_PROJECT_DIR` alongside it. Plugin code reads both to locate its team's state.

### HTTP `directory` Parameter

**All HTTP calls to serve use `projectDir` as `?directory=`** — never `inst.cwd`. The `projectDir` is the serve's bootstrapped directory. Session identity is determined by `sessionId`, not by `directory`.

`inst.cwd` remains an OpenTeam-level concept for tracking which directory an agent works in, but it does NOT flow into HTTP requests.

### CLI Commands Without `--dir`

Commands that currently take only `teamName` (`stop`, `status`, `attach`) need a way to find the project-state without `--dir`:

1. Scan all `<hash>/` subdirs under `~/.opencode/agents/<teamName>/` for live runtimes
2. If exactly one is running → auto-select
3. If multiple are running → error with list, require `--dir`
4. If none running → existing error behavior

---

## Changes

Ordered by layer (Foundation → Capabilities → Interfaces) to respect dependency direction.

### 1. foundation/constants.js — Add project-scoped state path

**Action**: Add function, keep existing

```
+ import crypto from 'crypto'

+ projectDirHash(projectDir)
    Returns first 8 chars of SHA-256 hex digest of projectDir.

+ getTeamStateDir(teamName, projectDir)
    Returns path.join(PATHS.AGENTS_DIR, teamName, projectDirHash(projectDir))
    Creates directory if it doesn't exist (mkdir -p equivalent).

  getTeamDir(teamName)                   ← UNCHANGED, stays for config (team.json)
```

### 2. foundation/state.js — Thread projectDir through all state functions

**Action**: Modify signatures, change path computation

All private path helpers switch from `getTeamDir` to `getTeamStateDir`:

```
- getRuntimePath(teamName)
+ getRuntimePath(teamName, projectDir)
    Uses getTeamStateDir(teamName, projectDir) + FILES.RUNTIME

- getActiveSessionsPath(teamName)
+ getActiveSessionsPath(teamName, projectDir)
    Uses getTeamStateDir(teamName, projectDir) + FILES.ACTIVE_SESSIONS
```

All public state functions add `projectDir` parameter:

```
  getRuntime(teamName, meta)              → getRuntime(teamName, projectDir, meta)
  saveRuntime(teamName, runtime)          → saveRuntime(teamName, projectDir, runtime)
  clearRuntime(teamName)                  → clearRuntime(teamName, projectDir)
  isServeRunning(teamName)                → isServeRunning(teamName, projectDir)
  getServeUrl(teamName, meta)             → getServeUrl(teamName, projectDir, meta)
  loadActiveSessions(teamName)            → loadActiveSessions(teamName, projectDir)
  saveActiveSessions(teamName, sessions)  → saveActiveSessions(teamName, projectDir, sessions)
  getAgentInstances(teamName, agentName)  → getAgentInstances(teamName, projectDir, agentName)
  findInstance(teamName, agentName, opts) → findInstance(teamName, projectDir, agentName, opts)
  addInstance(teamName, agentName, data)  → addInstance(teamName, projectDir, agentName, data)
  removeInstance(teamName, agentName, o)  → removeInstance(teamName, projectDir, agentName, o)
```

Modify `findActiveServeUrl(meta)`:
- Change from single-level scan (`AGENTS_DIR/<team>/.runtime.json`)
- To nested scan (`AGENTS_DIR/<team>/<hash>/.runtime.json`)
- Same logic: find first runtime with live daemon PID, return its serve URL

Add new function:

```
+ listRunningInstances(teamName)
    Scans all <hash> subdirs under AGENTS_DIR/<teamName>/.
    For each, checks if .runtime.json exists with a live daemon PID.
    Returns array of { projectDir, runtime, hash }.
    Used by CLI commands that need to auto-select when --dir not provided.
```

Note: `runtime.projectDir` is already stored inside `.runtime.json` (set by daemon), so we can recover the full `projectDir` from the file content rather than reverse-hashing. This is critical for `listRunningInstances` — it reads the runtime, extracts `projectDir` from inside.

### 3. foundation/terminal.js — No changes

Session names are passed as arguments from CLI/daemon. `terminal.js` doesn't construct them.

### 4. interfaces/daemon/serve.js — Add OPENTEAM_PROJECT_DIR env var

**Action**: Modify

```javascript
// Line 19-23: add OPENTEAM_PROJECT_DIR to serve process env
env: {
  ...process.env,
  OPENTEAM_TEAM: teamName,
  OPENTEAM_PROJECT_DIR: projectDir,    // ← ADD
  OPENMEMORY: process.env.OPENMEMORY || '',
},
```

`startServe` needs `projectDir` parameter added to its signature. Caller (daemon/index.js) already has it.

### 5. interfaces/daemon/index.js — Use project-scoped state + session names

**Action**: Modify

Session name construction (line 39):
```
- const sessionName = `openteam-${teamName}`;
+ const sessionName = `openteam-${teamName}-${projectDirHash(projectDir)}`;
```

Import `projectDirHash` from constants.js.

All state function calls add `projectDir`:
- `saveRuntime(teamName, projectDir, buildRuntimeData())` (lines 68, ~100)
- `clearRuntime(teamName, projectDir)` (line 137)

Pass `projectDir` to `startServe` (line 56).

Pass `projectDir` to `checkAndRespawn` (line 117) — needs signature change there too.

Pass `projectDir` to `ensureAgent` — already has it (line 79, `projectDir` is the 4th arg).

Pass `projectDir` to `recoverSessions` (line 72) — needs signature change.

### 6. interfaces/daemon/panes.js — Thread projectDir for state access

**Action**: Modify

`checkAndRespawn(mux, sessionName, teamName, serveUrl)`:
```
+ checkAndRespawn(mux, sessionName, teamName, projectDir, serveUrl)
```

`getAgentInstances(teamName, agentName)` call (line 77):
```
+ getAgentInstances(teamName, projectDir, agentName)
```

### 7. capabilities/lifecycle.js — Thread projectDir through lifecycle functions

**Action**: Modify

**resolveAgentFromSessionMap(sessionID)** (line 44):
- Read `OPENTEAM_PROJECT_DIR` from env
- If available: `loadActiveSessions(preferredTeam, projectDir)` — direct lookup, no scan
- If not available (shouldn't happen in normal flow): scan all hash subdirs for the team

**getCurrentAgent(sessionID, timeoutMs, meta)** (line 72):
- No signature change needed — it reads env vars internally
- `findActiveServeUrl` already works (just needs nested scan, done in state.js)

**ensureAgent(teamName, agentName, serveUrl, projectDir)** (line 129):
- Signature unchanged (already has projectDir)
- `findAgentSession` call: pass projectDir
- `addInstance(teamName, projectDir, agentName, ...)` — add projectDir
- `postMessage` call (line 148): already uses `projectDir` as directory — this is correct

**findAgentSession(teamName, agentName, serveUrl, options)** (line 162):
- Add `projectDir` from caller context
- `findInstance(teamName, projectDir, agentName, { cwd })` — add projectDir
- `getAgentInstances(teamName, projectDir, agentName)` — add projectDir

**wakeAgent(teamName, agentName, cwd, serveUrl, meta)** (line 199):
- Critical change: `createSession(serveUrl, projectDir, ...)` — use `projectDir` for HTTP directory, not `cwd`
- `addInstance(teamName, projectDir, agentName, { sessionId, cwd })` — add projectDir
- Where does `projectDir` come from? Read `process.env.OPENTEAM_PROJECT_DIR` (plugin context) or pass through from caller
- Recommended: add `projectDir` to signature: `wakeAgent(teamName, agentName, cwd, serveUrl, projectDir, meta)`

**recoverSessions(teamName, serveUrl)** (line 217):
- Add `projectDir`: `recoverSessions(teamName, projectDir, serveUrl)`
- `loadActiveSessions(teamName, projectDir)`, `saveActiveSessions(teamName, projectDir, ...)`

**freeAgent(teamName, agentName, options)** (line 254):
- Add `projectDir`: `freeAgent(teamName, projectDir, agentName, options)`
- `getAgentInstances(teamName, projectDir, agentName)`, `removeInstance(teamName, projectDir, ...)`

**redirectAgent(teamName, agentName, newCwd, serveUrl, options)** (line 277):
- Add `projectDir`: `redirectAgent(teamName, projectDir, agentName, newCwd, serveUrl, options)`
- `createSession(serveUrl, projectDir, ...)` — use projectDir for HTTP directory, not newCwd
- `addInstance(teamName, projectDir, agentName, { sessionId, cwd: newCwd, alias })`

**getStatus(teamName, serveUrl, who)** (line 301):
- Add `projectDir`: `getStatus(teamName, projectDir, serveUrl, who)`
- `getAgentInstances(teamName, projectDir, agentName)`

### 8. capabilities/messaging.js — Use projectDir for HTTP calls

**Action**: Modify

**sendMessage({ from, to, message, teamName, serveUrl, trace })** (line 26):
- Add `projectDir` to params: `sendMessage({ from, to, message, teamName, projectDir, serveUrl, trace })`
- Line 27: `getAgentInstances(teamName, projectDir, from.name)`
- Line 28: `getAgentInstances(teamName, projectDir, to)`
- Line 43: `wakeAgent(teamName, to, defaultCwd, serveUrl, projectDir, { trace, reason: 'sendMessage' })`
- **Line 80**: `postMessage(serveUrl, inst.sessionId, projectDir, to, ...)` — **THE FIX**: use `projectDir` not `inst.cwd`

**broadcast({ from, message, teamName, serveUrl, trace })** (line 105):
- Add `projectDir`: `broadcast({ from, message, teamName, projectDir, serveUrl, trace })`
- Pass through to `sendMessage`

**injectTeamContext(sessionID, output)** (line 150):
- Reads `OPENTEAM_PROJECT_DIR` from env for `loadActiveSessions` if needed
- Currently only calls `getCurrentAgent` and `loadTeamConfig` — no direct state access that needs projectDir
- No change needed if `getCurrentAgent` handles projectDir internally

### 9. interfaces/plugin/tools.js — Pass projectDir from env

**Action**: Modify

**msg tool execute** (line 31):
- Read `const projectDir = process.env.OPENTEAM_PROJECT_DIR`
- `getServeUrl(currentAgent.team, projectDir, ...)` — add projectDir
- Pass `projectDir` to `sendMessage` and `broadcast`

**command tool execute** (line 89):
- Same: read `projectDir` from env
- `getServeUrl(currentAgent.team, projectDir)` — add projectDir
- Pass `projectDir` to `getStatus`, `freeAgent`, `redirectAgent`

### 10. interfaces/cli.js — Project-scoped commands + auto-selection

**Action**: Modify

**cmdStart(teamName, options)** (line 46):
- `projectDir = options.dir || process.cwd()` — unchanged
- Session name: `openteam-${teamName}-${projectDirHash(projectDir)}`
- State calls: add projectDir to `getRuntime`, `clearRuntime`
- `hasSession` check: use new session name
- Daemon command: already passes `--dir "${projectDir}"` (line 96) — unchanged

**cmdStop(teamName)** (line 187):
- Cannot require `--dir` (breaking change). Instead:
  ```
  const instances = listRunningInstances(teamName)
  if (instances.length === 0) error('未运行')
  if (instances.length > 1) {
    error(`团队 ${teamName} 有多个运行实例，请指定 --dir:\n${instances.map(i => '  ' + i.projectDir).join('\n')}`)
  }
  const { projectDir, runtime } = instances[0]
  ```
- Add optional `--dir` option to `cmdStop` for explicit selection
- Remaining logic uses `runtime` (from the found instance) and its stored `mux.session`

**cmdAttach(teamName, agentName)** (line 118):
- Same auto-selection pattern as cmdStop
- `isServeRunning(teamName, projectDir)`, `getRuntime(teamName, projectDir)`, `getServeUrl(teamName, projectDir)`
- `ensureAgent(teamName, agentName, serveUrl, runtime.projectDir)`

**cmdStatus(teamName)** (line 236):
- Same auto-selection pattern
- `loadActiveSessions(teamName, projectDir)`, `getServeUrl(teamName, projectDir)`

**cmdList()** (line 151):
- For each team, call `listRunningInstances(teamName)` to show per-project status
- Display: team name, project dir, status (running/stopped)

**cmdDashboard(teamName)** (line 291):
- Same auto-selection pattern, pass projectDir to dashboard

**cmdMonitor** — delegates to cmdStart, unchanged.

### 11. interfaces/dashboard/ — Receive projectDir from caller

**Action**: Modify

**dashboard/index.js**:
- `dashboard(teamName)` → `dashboard(teamName, projectDir)` (projectDir from CLI auto-selection)
- Standalone: `isServeRunning(teamName, projectDir)`, `getServeUrl(teamName, projectDir)`
- `createEmbeddedDashboard(teamName, serveUrl)` — unchanged (embedded mode gets serveUrl directly)
- `refreshDashboard(ui, teamName, serveUrl)` — passes to data functions, which need projectDir
- Add projectDir as parameter to `refreshDashboard`

**dashboard/data.js**:
- `fetchTeamStatus(teamName)` → `fetchTeamStatus(teamName, projectDir)`
  - `getRuntime(teamName, projectDir)`, `getServeUrl(teamName, projectDir)`
- `fetchAgentStatus(teamName, serveUrl)` → `fetchAgentStatus(teamName, projectDir, serveUrl)`
  - `loadActiveSessions(teamName, projectDir)`
- `fetchMessageStream(teamName, serveUrl, limit)` → `fetchMessageStream(teamName, projectDir, serveUrl, limit)`
  - `loadActiveSessions(teamName, projectDir)`

For embedded mode (daemon), projectDir is available from daemon context and passed through `createEmbeddedDashboard`.

### 12. bin/openteam.js — Add --dir option to stop/status/attach/dashboard

**Action**: Modify

Add `.option('--dir <path>', '项目目录')` to:
- `stop` command
- `status` command
- `attach` command
- `dashboard` command

`start` command already has `--dir`.

---

## Data Flow (msg tool, after fix)

```
Agent uses msg tool
  → tools.js reads OPENTEAM_PROJECT_DIR from env
  → getServeUrl(team, projectDir) → reads state-<hash>/.runtime.json → serve URL
  → sendMessage({ ..., projectDir, serveUrl })
    → getAgentInstances(team, projectDir, target) → reads state-<hash>/.active-sessions.json
    → postMessage(serveUrl, sessionId, projectDir, ...)
                                       ^^^^^^^^^
                                       ALWAYS the serve's bootstrapped directory
    → HTTP POST /session/:id/prompt_async?directory=<projectDir>
    → serve: Instance.provide({ directory: projectDir }) → cache HIT → instant
    → SessionPrompt.prompt() → message delivered
```

## Trade-off Decisions

### Decision: Hash vs. URL-safe encoding of projectDir

**Option A**: SHA-256 truncated to 8 hex chars
- Pro: Fixed length, filesystem-safe, short
- Con: Not human-readable from dirname alone
- Mitigation: `runtime.projectDir` inside the file stores the full path

**Option B**: URL-safe base64 of full path
- Pro: Reversible, somewhat readable
- Con: Can be very long (paths > 100 chars), filesystem limits

**Choice**: Option A. The hash is only a directory name — `runtime.projectDir` provides the human-readable mapping. `listRunningInstances` displays the full path.

### Decision: How CLI commands find project without --dir

**Option A**: Always require `--dir`
- Pro: Explicit, no ambiguity
- Con: Breaking change, annoying for the common case (one project running)

**Option B**: Auto-select when unambiguous, require `--dir` when multiple
- Pro: Backwards-compatible for single-instance use
- Con: Slightly more complex logic

**Choice**: Option B. Add `listRunningInstances` scan helper. Most users run one instance per team — the auto-select makes the common case smooth.

### Decision: What HTTP `directory` parameter to use for postMessage

**Option A**: Always use `projectDir` (serve's bootstrapped directory)
- Pro: Guaranteed no bootstrap hang. Simple. Correct for message delivery.
- Con: `redirectAgent` sessions technically operate in projectDir context, not their actual cwd

**Option B**: Use `inst.cwd` (agent's actual working directory)
- Pro: Correct Instance context for each agent
- Con: Triggers InstanceBootstrap for new directories → hangs (current bug)

**Choice**: Option A. Message delivery just needs to reach the session — the receiving agent's TUI provides the correct runtime context. `redirectAgent` is a separate concern to address when `opencode serve` supports multiple bootstrapped directories.

## Risks & Technical Debt

1. **`redirectAgent` limitation** — Sessions created via redirect use `projectDir` as HTTP directory, not the agent's actual `newCwd`. The agent's tools in the LLM loop will operate in `projectDir` context. This is acceptable because: (a) the current behavior hangs entirely, (b) the TUI attached to the session can provide proper context, (c) fixing this properly requires upstream opencode to support multiple Instance bootstraps.

2. **Migration** — Existing state at `~/.opencode/agents/<teamName>/.runtime.json` (old format without hash subdir) won't be found by new code. First `start` after upgrade creates fresh state in the new location. Old files are orphaned. `cmdStop` already has `hasSessionAny` fallback to clean orphaned mux sessions. Consider adding a one-time migration or cleanup note in release documentation.

3. **Hash collision** — 8 hex chars = 4 billion possibilities. Collision on the same machine is astronomically unlikely. If it ever happens, the user would see confusing state from a different project. Mitigation: `listRunningInstances` shows full projectDir — mismatch would be visible.

4. **Performance of nested scan** — `findActiveServeUrl` and `listRunningInstances` do two-level directory scans. Given the expected number of teams (< 10) and projects per team (< 10), this is negligible.

## Task Order

Implementation sequence, respecting layer dependencies:

```
Phase 1: Foundation (no callers broken yet — add new functions, keep old signatures)
  1. constants.js — add projectDirHash() and getTeamStateDir()
  2. state.js — add projectDir param to all functions (can keep old signatures as
     deprecated wrappers temporarily to avoid breaking everything at once)

Phase 2: Daemon (first consumer of new state paths)
  3. daemon/serve.js — add OPENTEAM_PROJECT_DIR env
  4. daemon/index.js — use new session name, pass projectDir to state functions
  5. daemon/panes.js — thread projectDir

Phase 3: Capabilities (business logic)
  6. lifecycle.js — thread projectDir, use OPENTEAM_PROJECT_DIR in plugin context
  7. messaging.js — use projectDir for HTTP calls (THE core fix)

Phase 4: Interfaces (callers)
  8. plugin/tools.js — read OPENTEAM_PROJECT_DIR, pass through
  9. cli.js — project-scoped session names, auto-selection logic, --dir options
  10. bin/openteam.js — add --dir option to commands
  11. dashboard/ — thread projectDir

Phase 5: Cleanup
  12. Remove deprecated wrapper functions from state.js if added in Phase 1
```

Tasks 1-2 are sequential (foundation first). Tasks 3-5 can be done together. Task 6 depends on 2. Task 7 depends on 6. Tasks 8-11 depend on 7. Task 12 is final cleanup.
