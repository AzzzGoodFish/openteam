---
name: system-discovery
description: "Learn and document a target system's capabilities, workflows, and user-facing behaviors. Use when onboarding to a new project, before working on requirements, or when the team lacks understanding of what the system currently does."
---

# System Discovery

Systematically learn a target system and produce a structured cognition document that enables the team to make informed decisions.

## Philosophy

You cannot manage requirements for a system you don't understand. Most AI agent failures happen because requirements are written against an imagined system, not the real one. This skill forces you to **actually learn the system** before proposing any changes.

> "Architecture is about the important stuff. Whatever that is." — Ralph Johnson (via Martin Fowler)

To know what's important, you first need to know what exists.

## When to Use

- First time working on a project
- Before writing requirements for an area you haven't explored
- When a team member claims "the system already does X" and you need to verify
- After major changes when the system cognition document may be outdated

## Process

### Step 1: Identify System Type

Determine what kind of system you're dealing with. This shapes your discovery approach:

- **CLI tool** → Read help output, run commands, trace common workflows
- **Web service** → Explore routes/endpoints, identify user flows, understand data model
- **SDK/Library** → Read public API surface, examine examples, understand integration patterns
- **Backend service** → Map API endpoints, understand data flow, identify dependencies
- **Desktop/Mobile app** → Identify screens, user workflows, state management

### Step 2: Read Before You Run

Start with passive discovery — reading what exists:

1. **README and docs** — What does the project claim to do?
2. **Entry points** — `main`, `index`, `app`, CLI entry, route definitions
3. **Public API surface** — Exported functions, CLI commands, HTTP endpoints, UI screens
4. **Configuration** — What's configurable? What are the defaults?
5. **Tests** — What does the project test? Tests reveal intended behavior better than docs.
6. **Recent changes** — Git log for recent activity areas

### Step 3: Trace User Journeys

For each major capability, trace the complete user journey:

1. What triggers it? (command, click, API call, event)
2. What inputs does it need?
3. What happens step by step?
4. What does the user see/receive?
5. What can go wrong? How does the system handle errors?
6. What side effects occur? (data changes, notifications, file writes)

### Step 4: Map the Boundaries

Identify what the system does NOT do:

- What limitations are intentional (design choices)?
- What limitations are accidental (not yet implemented)?
- Where does this system end and other systems begin?
- What assumptions does the system make about its environment?

### Step 5: Produce the Cognition Document

Write a structured document with the following sections:

```markdown
# System Cognition: [Project Name]

## Overview
One paragraph: what this system is and who it's for.

## System Type
CLI / Web service / SDK / Backend / etc.

## Core Capabilities
For each capability:
- **What**: What it does
- **How**: How a user triggers and uses it
- **Where**: Which code modules implement it

## User Journeys
For each major workflow, a step-by-step trace.

## Boundaries & Limitations
What the system deliberately does not do.
What it cannot currently do.

## Key Conventions
Naming patterns, file organization, coding style, architectural patterns.

## Integration Points
External dependencies, APIs consumed, data sources.

## Open Questions
Things you couldn't determine from reading alone.
```

## Guidelines

- **Be concrete.** "The system handles authentication" is useless. "Users log in via email+password on POST /api/auth/login, receiving a JWT stored in httpOnly cookie" is useful.
- **Verify claims.** If the README says "supports WebSocket", check that it actually does.
- **Note staleness.** If docs and code disagree, document both and flag the discrepancy.
- **Don't boil the ocean.** You don't need to understand every line of code. Focus on the user-facing surface and the high-level architecture. Go deeper only where requirements demand it.
- **Update, don't rewrite.** If a cognition document already exists, update it incrementally.
