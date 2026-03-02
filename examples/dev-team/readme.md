# Dev Team Example

A four-role agent team for software development: PM → Architect → Developer → QA.

## Roles

| Agent | Role | Responsibilities |
|-------|------|-----------------|
| **pm** (leader) | Product Manager | Clarify requirements, write PRDs, coordinate the team |
| **architect** | Architect | Read codebase, design implementation plans, review architecture |
| **developer** | Developer | Implement code strictly per plan, write unit tests |
| **qa** | QA Engineer | Design test plans from requirements, run acceptance tests, report bugs |

## Workflow

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

## Skills

Each role has skills that guide its workflow stages:

- **PM**: `requirement-clarification`, `prd-generation`, `system-discovery`
- **Architect**: `codebase-mapping`, `implementation-planning`, `architecture-review`
- **QA**: `test-plan-design`, `acceptance-testing`, `bug-reporting`

## Deployment

### 1) Copy team config and agent prompts

```bash
# Create team directory
mkdir -p ~/.opencode/agents/<team-name>

# Copy team config (edit "name" field to match your team name)
cp team.json ~/.opencode/agents/<team-name>/

# Copy agent prompts
cp pm.md architect.md developer.md qa.md ~/.opencode/agents/<team-name>/../
```

Agent prompts live in `~/.opencode/agents/`, one level above the team directory. The team directory only holds `team.json` and runtime files.

### 2) Install skills

```bash
cp -r skills/* ~/.opencode/skills/
```

### 3) Configure OpenCode plugin

Add to `~/.opencode/opencode.json`:

```json
{
  "plugin": ["openteam"]
}
```

### 4) Start the team

```bash
openteam start <team-name>
```

This launches the serve process and enters the PM (leader) session. Use `openteam monitor <team-name>` to watch all agents in a split-screen layout.
