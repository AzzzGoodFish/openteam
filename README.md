# OpenTeam

Agent team collaboration framework. Pluggable CLI backend (Claude Code / OpenCode).

## What it does

- Multi-agent teams with async messaging (MCP-based)
- Built-in task board with dependency tracking and auto-notification
- Daemon manages the full lifecycle: server, agent panes, health checks, respawn
- Real-time dashboard (embedded TUI)
- Works with tmux or zellij

## Requirements

| Dependency | Version |
|---|---|
| Node.js | 18+ |
| tmux or zellij | any |

## Install

```bash
npm install -g openteam
```

## Quick Start

```bash
# 1. Install a built-in team template
openteam setup

# 2. Start the team
openteam start dev
```

`openteam setup` walks you through:

```
Available team templates:

  1) dev-team
     A four-role agent team for software development.
     agents: pm, architect, developer, qa

Install "dev-team"? (Y/n): Y
Team name (team1): dev
Default CLI (claude-code):
Enable yolo mode? (y/N): y

✓ Team "dev" installed

  Template:   dev-team
  Config:     ~/.openteam/teams/dev/team.json
  Leader:     pm
  Agents:     pm, architect, developer, qa
  CLI:        claude-code
  Agent defs: 4 → ~/.openteam/agents
  Skills:     12 → ~/.openteam/skills
```

## CLI Commands

| Command | Description |
|---|---|
| `openteam setup` | Install a built-in team template (interactive) |
| `openteam start [team]` | Start team (creates tmux/zellij session + daemon) |
| `openteam start [team] -d` | Start in background |
| `openteam list` / `openteam ls` | List running team instances |
| `openteam list -a` | List all teams (including stopped) |
| `openteam stop <target>` | Stop team (by name or instance ID) |
| `openteam inspect <team>` | Show runtime status and agent online state |

The same team can run in multiple project directories simultaneously. Use `--dir` to target a specific instance when ambiguous.

## Team Tools (MCP)

Agents communicate through two MCP tools exposed by the openteam server:

| Tool | Access | Description |
|---|---|---|
| `msg` | All agents (leader can broadcast) | Async messaging between agents |
| `taskboard` | `create`: leader only; `done`/`list`: all | Task management with dependency tracking |

Messages are delivered to agent queues and injected into the CLI via PTY. Offline agents receive messages when they reconnect.

## Example: Dev Team

`examples/dev-team/` provides a complete four-role development team, ready to use.

### Roles

| Agent | Role | Responsibilities |
|---|---|---|
| **pm** (leader) | Product Manager | Clarify requirements, write PRDs, coordinate |
| **architect** | Architect | Read codebase, design implementation plans, review |
| **developer** | Developer | Implement per plan, write unit tests |
| **qa** | QA Engineer | Design test plans, run acceptance tests, report bugs |

### Workflow

```
User request → PM clarifies requirements & writes PRD
                  ↓                        ↓
            Architect designs         QA designs test plan
            implementation plan       (in parallel)
                  ↓
            Developer implements + unit tests
                  ↓
            QA runs acceptance tests
                  ↓
            PM reports results to user
```

### Built-in Skills

- **PM**: `requirement-clarification`, `prd-generation`, `system-discovery`
- **Architect**: `codebase-mapping`, `implementation-planning`, `architecture-review`
- **QA**: `test-plan-design`, `acceptance-testing`, `bug-reporting`

## Configuration

### Team config (`~/.openteam/teams/<team>/team.json`)

```json
{
  "name": "dev",
  "leader": "pm",
  "agents": ["pm", "architect", "developer", "qa"],
  "default_cli": "claude-code",
  "cli_config": {
    "claude-code": {
      "args": ["--permission-mode", "bypassPermissions"]
    }
  }
}
```

- `leader` must be in `agents`.
- `cli_config` passes extra arguments to the underlying CLI.
- `port` (optional): fixed port; default `0` auto-selects from 4096-4200.

### Directory layout

```
~/.openteam/
├── settings.json                 # Global settings
├── agents/                       # Agent definitions (shared across teams)
│   ├── pm.md
│   ├── architect.md
│   └── ...
├── skills/                       # Skill definitions
│   ├── requirement-clarification/
│   └── ...
└── teams/
    └── <team>/
        ├── team.json             # Team config
        └── <hash>/               # Project-scoped runtime state
            ├── .state.json       # daemon/server/mux state
            └── .tasks.json       # Task board data
```

Project isolation: `<hash>` = first 8 hex chars of SHA-256(projectDir).

## Architecture

```
bin/openteam.js              CLI entry (Commander routing)

src/
├── interfaces/              Who's calling
│   ├── cli.js               Commands: setup, start, stop, list, inspect
│   ├── daemon/              Daemon lifecycle (server + panes + health)
│   └── dashboard/           Embedded TUI (blessed)
├── server/                  Communication layer
│   ├── hub.js               In-memory message queue
│   ├── mcp.js               MCP tools (msg + taskboard)
│   └── routes.js            REST API (register/messages/status/tasks)
├── adapters/                CLI abstraction (claude-code / opencode)
├── wrapper/                 PTY bridge (register → MCP config → spawn CLI → poll)
├── capabilities/            Business logic (taskboard)
└── foundation/              Infrastructure (config, state, terminal, logger)
```

Dependency rule: `Interfaces → Capabilities → Foundation`. No reverse dependencies.

## Debugging

```bash
# Enable logging
OPENTEAM_LOG=1 openteam start myteam

# Set log level (debug/info/warn/error)
OPENTEAM_LOG=1 OPENTEAM_LOG_LEVEL=debug openteam start myteam
```

Log file: `~/.openteam/openteam.log`

## License

MIT
