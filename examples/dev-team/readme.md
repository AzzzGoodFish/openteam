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
- **Developer**: `incremental-implementation`, `self-verification`
- **QA**: `test-plan-design`, `acceptance-testing`, `bug-reporting`

## Deployment

### 1) Install the team

```bash
openteam setup dev-team
```

This copies agent prompts to `~/.openteam/agents/`, skills to `~/.openteam/skills/`, and team config to `~/.openteam/teams/<team-name>/team.json`.

### 2) Start the team

```bash
openteam start <team-name>
```

This launches the daemon, server, and agent panes in a tmux/zellij session.
