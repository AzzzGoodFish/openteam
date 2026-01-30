# OpenTeam

Agent-centric team collaboration for OpenCode.

## Features

- **Team Collaboration**: PM can poke other agents, maintaining conversation context
- **Memory System**: Hierarchical memory with resident blocks and indexed notes
- **Session History**: Track and recall past conversations
- **Team Management**: Start, stop, and monitor team serve

## Installation

```bash
npm install -g openteam
```

## Configuration

### 1. Configure OpenCode Plugin

Add to `~/.opencode/opencode.json`:

```json
{
  "plugin": ["openteam"]
}
```

### 2. Create Team Configuration

Create `~/.opencode/agents/<team-name>/team.json`:

```json
{
  "name": "myteam",
  "leader": "pm",
  "host": "127.0.0.1",
  "port": 0,
  "agents": ["pm", "architect", "developer", "qa"]
}
```

### 3. Create Agent Prompts

Create agent prompt files in `~/.opencode/agents/<team-name>/`:

- `pm.md` - Product Manager
- `architect.md` - Architect
- `developer.md` - Developer
- `qa.md` - QA

### 4. Configure Agent Memory

Create `~/.opencode/agents/<team>/<agent>/agent.json`:

```json
{
  "name": "pm",
  "memories": [
    { "name": "persona", "type": "resident", "limit": 1000, "readonly": true },
    { "name": "human", "type": "resident", "limit": 800 },
    { "name": "projects", "type": "index", "limit": 1500 },
    { "name": "sessions", "type": "sessions", "limit": 2000 }
  ]
}
```

## CLI Usage

```bash
# Start team serve
openteam start myteam

# Start in background
openteam start myteam -d

# Attach to leader session
openteam attach myteam

# Attach to specific agent
openteam attach myteam architect

# Attach to specific instance by cwd
openteam attach myteam developer --cwd /path/to/project

# Monitor all agents in split screen (2x2 grid)
openteam monitor myteam           # Auto-detect zellij/tmux
openteam monitor myteam --zellij  # Force zellij
openteam monitor myteam --tmux    # Force tmux

# List all teams
openteam list

# Show team status
openteam status myteam

# Stop team
openteam stop myteam
```

## Memory System

### Memory Types

| Type | Description | Always in Context |
|------|-------------|-------------------|
| `resident` | Core memory, always visible | Yes |
| `index` | Index visible, details on demand | Index only |
| `sessions` | Session history index | Index only |

### Memory Tools

| Tool | Description |
|------|-------------|
| `remember` | Append to resident memory |
| `correct` | Replace part of memory content |
| `rethink` | Rewrite entire memory block |
| `note` | Save a note (auto-updates index) |
| `lookup` | Read a note's content |
| `erase` | Delete a note |
| `search` | Search notes |
| `review` | Search session history |
| `reread` | Read full session content |

### Team Tools

| Tool | Description |
|------|-------------|
| `tell` | Send async notification. Auto wakes up offline agents. Leader can broadcast to all |
| `command` | Leader only: status, assign, free, redirect |

### Message Format

All messages have `[from xxx]` prefix for source identification:

- `[from pm]` - from PM agent (via tell)
- `[from boss]` - from user direct input (auto-tagged by hook)

#### command actions

| Action | Description |
|--------|-------------|
| `status` | View team status |
| `assign` | Assign task (sync, wait for response). Use `cwd` param to create new instance |
| `free` | Let agent rest (disconnect attach) |
| `redirect` | Switch agent's working directory |

## Data Structure

```
~/.opencode/agents/<team>/
├── team.json                 # Team configuration
├── pm.md                     # Agent prompts
├── architect.md
├── .runtime.json             # Serve runtime state
├── .active-sessions.json     # Active session mapping
│
└── <agent>/                  # Agent data
    ├── agent.json            # Memory configuration
    ├── sessions.json         # Session history
    └── memories/             # Memory storage
        ├── persona.mem       # Resident memory
        ├── human.mem
        ├── projects.mem      # Index
        └── projects/         # Note details
            └── jarvy.mem
```

## License

MIT
