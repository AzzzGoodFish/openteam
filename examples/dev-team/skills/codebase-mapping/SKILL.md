---
name: codebase-mapping
description: "Read and understand a codebase's architecture, modules, boundaries, and conventions. Use when onboarding to a new project, before designing any implementation, or when the codebase has evolved significantly since last review."
---

# Codebase Mapping

Deeply read and understand a codebase to build an accurate mental model of its architecture, enabling informed design decisions.

## Philosophy

> "The best code you can write now is code you'll discard in a couple of years time." — Martin Fowler (Sacrificial Architecture)

Understanding what exists is the prerequisite to designing what should exist. Most architectural mistakes happen when designers work from imagination rather than from reality.

> "A poor architecture is a major contributor to the growth of cruft — elements of the software that impede the ability of developers to understand the software." — Martin Fowler

Your job is to map the cruft as well as the clean parts. Both inform design decisions.

## When to Use

- First time working on a codebase
- Before designing any non-trivial implementation
- When you suspect the codebase has drifted from the last documented architecture
- After a major refactor or feature addition

## Process

### Step 1: Structural Survey

Start with the broadest view and zoom in:

1. **Project root** — What's in the top-level directory? Build system? Monorepo? Single package?
2. **Source tree** — Map the directory structure. What's the organizational principle? (by feature? by layer? by domain?)
3. **Entry points** — Where does execution start? CLI entry, HTTP server bootstrap, main function, index exports
4. **Dependencies** — What external libraries are used? What do they tell you about architectural choices?
5. **Build & config** — How is the project built, tested, deployed? What environment variables matter?

### Step 2: Module Boundary Analysis

For each major module/directory:

1. **Responsibility** — What is this module's job? (one sentence)
2. **Public interface** — What does it export? What do other modules use from it?
3. **Internal structure** — How is it organized internally?
4. **Dependencies** — What other modules does it depend on? (draw the dependency graph)
5. **Boundary integrity** — Is the boundary clean? Or do other modules reach into its internals?

**Red flags to note:**
- Circular dependencies between modules
- A module that depends on everything (god module)
- A module that everything depends on (hidden coupling)
- Files that don't belong in their directory
- Duplicated logic across modules

### Step 3: Pattern Recognition

Identify the recurring patterns in the codebase:

- **Naming conventions** — How are files, functions, classes, variables named?
- **Architectural patterns** — MVC? Event-driven? Plugin architecture? Layered?
- **Error handling** — How are errors propagated? Custom error types? Error codes?
- **Data flow** — How does data move through the system? Transforms? Validations?
- **State management** — Where is state held? How is it mutated?
- **Testing patterns** — What's the test structure? What frameworks? What's the coverage strategy?

### Step 4: Identify Architectural Decisions

Document the implicit decisions embedded in the code:

- Why was this technology chosen over alternatives?
- Why is the code organized this way?
- What constraints does this architecture impose on future changes?
- Where has the architecture been compromised (tech debt)?

### Step 5: Produce the Architecture Map

```markdown
# Architecture Map: [Project Name]

## Overview
One paragraph summary of the system's architecture.

## Structure
Directory tree with annotations explaining each major directory.

## Module Map
For each module:
- **Purpose**: one sentence
- **Public API**: key exports/interfaces
- **Dependencies**: what it uses
- **Dependents**: what uses it

## Dependency Graph
ASCII or description of module dependency relationships.

## Patterns & Conventions
- Naming: [patterns]
- Error handling: [approach]
- Data flow: [description]
- Testing: [approach]

## Architectural Decisions
Key decisions and their rationale (known or inferred).

## Technical Debt
Known compromises, hacks, TODOs, and boundary violations.

## Hotspots
Areas of high complexity or frequent change that need extra care.
```

## Guidelines

- **Read code, don't skim it.** Skimming leads to wrong mental models. Read the actual implementations of key functions, not just their signatures.
- **Follow the data.** When in doubt about architecture, trace how data flows from input to output. Data flow reveals the true architecture, regardless of what the directory structure suggests.
- **Respect what exists.** The current architecture was built by people who had reasons. Understand those reasons before judging.
- **Note the drift.** Reality drifts from intent. Document where the code has diverged from its apparent design.
- **Keep it updated.** An outdated architecture map is worse than none — it creates false confidence.
