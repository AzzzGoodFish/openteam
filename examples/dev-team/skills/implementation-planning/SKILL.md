---
name: implementation-planning
description: "Design a concrete implementation plan from requirements, specifying which files, modules, functions, and classes to create or modify. Use after receiving requirements from PM and having an up-to-date codebase map."
---

# Implementation Planning

Translate product requirements into a concrete, file-level implementation plan that Developer can execute without guessing.

## Philosophy

> "Design is there to enable you to keep changing the software easily in the long term." — Kent Beck (via Martin Fowler)

Your plan should make the system simpler or no more complex. Every new file, class, or abstraction must justify its existence against the alternative of reusing or extending what already exists.

> "Planned design has faults... it's impossible to think through all the issues that you need to deal with when you are programming." — Martin Fowler (Is Design Dead?)

Accept that your plan will be imperfect. Design at the right level of detail: specific enough that Developer knows WHERE to put code, flexible enough that they can handle surprises.

> Google's rule: "Design for ~10X growth, but plan to rewrite before ~100X." — Jeff Dean

Don't over-engineer. Design for the current need with extension points for the foreseeable future.

## When to Use

- After receiving requirements from PM (with acceptance criteria)
- After updating your codebase map for the affected areas
- When a requirement reveals that the current architecture needs revision

## Process

### Step 1: Understand the Requirement

Read the PRD completely. Verify you understand:
- What user-visible behavior changes
- What the acceptance criteria are
- What the non-goals are (avoid designing for out-of-scope items)

If anything is unclear, ask PM before designing.

### Step 2: Survey the Affected Code

Using your codebase map, identify:
- Which existing modules are affected?
- Which existing functions/classes need modification?
- What can be reused or extended?
- What would need to change to accommodate this cleanly?

**Critical question: Can this be done by modifying existing code rather than creating new code?**

The default AI instinct is to create new files. Resist it. Modification > creation unless there's a clear architectural reason for new code.

### Step 3: Design the Change

For each requirement, specify:

1. **Files to modify** — Which existing files change, and what changes in each
2. **Files to create** (if truly necessary) — Where they go, what they contain, why a new file is needed
3. **Functions/classes** — New or modified, with signatures and brief behavior description
4. **Interfaces** — How new code connects to existing code (function calls, events, imports)
5. **Data flow** — How data moves through the new/modified components

### Step 4: Analyze Trade-offs

For non-trivial decisions, document alternatives:

```markdown
### Decision: [what]

**Option A**: [description]
- ✅ Pro: [advantage]
- ❌ Con: [disadvantage]

**Option B**: [description]
- ✅ Pro: [advantage]
- ❌ Con: [disadvantage]

**Choice**: Option [X] because [reason]
```

### Step 5: Check for Entropy

Before finalizing, audit your plan against these questions:

- [ ] Does this plan add more code than necessary?
- [ ] Could any new file be merged into an existing one without violating boundaries?
- [ ] Does this create any new dependencies between modules that didn't exist before?
- [ ] Does this duplicate any logic that already exists elsewhere?
- [ ] Does this respect existing naming conventions and patterns?
- [ ] Would this plan make sense to a developer who knows the codebase but hasn't seen the requirement?

If you answer "yes" to the first four questions, revise the plan.

### Step 6: Produce the Implementation Plan

```markdown
# Implementation Plan: [Feature Title]

**Requirement**: [link to PRD or brief summary]
**Architect**: [name]
**Status**: Draft | Reviewed | Approved

## Summary
One paragraph describing the approach.

## Changes

### 1. [Task title]
**File**: `path/to/existing/file.js`
**Action**: Modify
**Changes**:
- Add function `doThing(input: Type): ReturnType` — [what it does]
- Modify function `existingFunc` to call `doThing` when [condition]

### 2. [Task title]
**File**: `path/to/new/file.js` (NEW)
**Justification**: [why a new file is needed]
**Contents**:
- Class `ThingProcessor` — [responsibility]
  - `process(data): Result` — [behavior]
  - `validate(data): boolean` — [behavior]

## Data Flow
[How data moves through the changes]

## Trade-off Decisions
[Document any non-obvious choices]

## Risks & Technical Debt
- [Known risk and mitigation]
- [Any tech debt this introduces, with plan to address]

## Task Order
Recommended implementation sequence:
1. [Task] — because [dependency reason]
2. [Task] — depends on #1
3. [Task] — independent, can parallel with #2
```

## Anti-Patterns

- **The "create new everything" plan**: 5 new files for a feature that could be 30 lines in an existing module
- **The architecture astronaut**: Introducing abstractions, interfaces, and patterns for a one-off feature
- **The hand-wave plan**: "Add search to the dashboard" without specifying which file, function, or integration point
- **The over-specified plan**: Dictating variable names and loop structures — that's Developer's domain
- **The assumption plan**: Designing without reading the affected code first
