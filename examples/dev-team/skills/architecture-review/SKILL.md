---
name: architecture-review
description: "Review implemented code for architectural compliance, detect entropy (bloat, duplication, boundary violations), and propose corrections. Use after Developer completes implementation, or periodically to audit codebase health."
---

# Architecture Review

Review code changes for architectural integrity, detecting and correcting the entropy that naturally accumulates in AI-assisted development.

## Philosophy

> "High internal quality leads to faster delivery of new features, because there is less cruft to get in the way... experienced developers reckon that attention to internal quality pays off in weeks not months." — Martin Fowler

Entropy is the default outcome of development. Every feature adds code, and without active stewardship, the codebase becomes harder to understand, modify, and extend. Your review is the immune system.

> "Knowing your architecture is sacrificial doesn't mean abandoning the internal quality of the software." — Martin Fowler (Sacrificial Architecture)

Even if the entire system will be rewritten someday, internal quality still matters NOW — it determines how fast you can ship features TODAY.

## When to Use

- After Developer completes implementation (before QA verification)
- When you notice code complexity growing in a module
- Periodically as a codebase health check
- When multiple features have been added without review

## Review Checklist

### 1. Plan Compliance
- [ ] Do the changes match the implementation plan?
- [ ] Are there unexpected new files or modules? (Why?)
- [ ] Were any plan items skipped or altered? (Justified?)

### 2. Boundary Integrity
- [ ] Do modules still have clear, single responsibilities?
- [ ] Are there any new cross-module dependencies that shouldn't exist?
- [ ] Is any module reaching into another module's internals instead of using its public API?
- [ ] Are there any new circular dependencies?

### 3. Duplication Detection
- [ ] Is any new code duplicating logic that exists elsewhere?
- [ ] Could any new utility function be merged with an existing one?
- [ ] Are there copy-paste patterns that should be abstracted?

### 4. Complexity Assessment
- [ ] Are new functions/classes doing one thing well, or are they multi-purpose?
- [ ] Are there functions longer than ~50 lines that should be decomposed?
- [ ] Is the nesting depth reasonable (max 3 levels)?
- [ ] Are error paths handled, not swallowed?

### 5. Convention Adherence
- [ ] Do new files follow the project's naming conventions?
- [ ] Does new code follow the project's error handling patterns?
- [ ] Is the coding style consistent with the rest of the codebase?
- [ ] Are new exports intentional (not accidentally public)?

### 6. Bloat Assessment
- [ ] Can any new file be eliminated by integrating its content into existing files?
- [ ] Are there over-abstractions (interfaces with a single implementation, classes with a single method)?
- [ ] Were any "just in case" features or parameters added beyond the requirement?

## Severity Levels

- **Critical** — Boundary violation, circular dependency, data integrity risk → Must fix before QA
- **Major** — Significant duplication, wrong module placement, convention violation → Should fix before QA
- **Minor** — Style inconsistency, slightly suboptimal approach, missing comments → Can fix later
- **Note** — Observation for future consideration, not blocking

## Review Output Format

```markdown
# Architecture Review: [Feature/PR Title]

**Plan**: [link to implementation plan]
**Reviewer**: [architect name]
**Verdict**: ✅ Approved | ⚠️ Approved with notes | 🔴 Changes required

## Summary
One paragraph overall assessment.

## Findings

### [Critical/Major/Minor] — [Title]
**Location**: `path/to/file.js:L42`
**Issue**: [what's wrong]
**Impact**: [why it matters]
**Suggestion**: [how to fix]

### ...

## Metrics
- Files changed: [n]
- Files added: [n] (justified: [y/n])
- Lines added: [n]
- Lines removed: [n]
- Net complexity change: [simpler / same / more complex]

## Technical Debt
- [Any new debt introduced, with priority for addressing it]
```

## Guidelines

- **Be specific.** "The code is messy" is not a review. Point to exact files, lines, and patterns.
- **Suggest, don't just criticize.** Every issue should come with a proposed fix or direction.
- **Pick your battles.** Minor style issues shouldn't block a review. Focus on structural integrity.
- **Acknowledge good work.** If the implementation is clean, say so. Positive feedback reinforces good patterns.
- **Think in trajectories.** One boundary violation is minor. The pattern of boundary violations is critical. Flag trends early.
