---
name: bug-reporting
description: "Produce clear, actionable, reproducible bug reports. Use whenever a test fails or unexpected behavior is discovered during verification."
---

# Bug Reporting

Write bug reports that are precise, reproducible, and actionable — so Developer can fix the issue without asking clarifying questions.

## Philosophy

A bug you can't reproduce isn't a bug report — it's noise. A bug without context is a puzzle that wastes Developer's time. Every minute Developer spends understanding your report is a minute they're not fixing the bug.

The goal: Developer reads the report and immediately knows what's wrong, where to look, and how to verify the fix.

## When to Use

- Whenever an acceptance test fails
- When you observe unexpected behavior during any testing
- When regression tests reveal broken existing functionality

## Bug Report Format

```markdown
## Bug: [Short descriptive title]

**ID**: BUG-[number]
**Severity**: Critical | Major | Minor
**Requirement**: [which PRD requirement this violates, if applicable]
**Found in**: [acceptance test name / manual exploration]

### Environment
- [relevant environment details: OS, runtime version, config]

### Steps to Reproduce
1. [Precise first step — include exact commands, inputs, clicks]
2. [Second step]
3. [Third step]

### Expected Behavior
[What should happen according to the requirement/acceptance criteria]

### Actual Behavior
[What actually happened — be specific]

### Evidence
```
[Error output, log snippet, or test output]
```

### Notes
[Any additional context: does it happen consistently? any patterns?]
```

## Severity Guide

- **Critical**: Feature is completely broken. Core functionality doesn't work. Data loss. Crash.
- **Major**: Feature partially works but an important scenario fails. Significant usability issue. Blocks acceptance.
- **Minor**: Feature works but with cosmetic issues, minor inconsistencies, or edge cases. Doesn't block acceptance.

## Guidelines

### Be Precise
- ❌ "Search doesn't work"
- ✅ "Searching for 'billing' in the project search box returns 0 results, but 3 projects contain 'billing' in their names"

### Be Reproducible
- Include EXACT inputs, not paraphrased ones
- Specify the order of steps — it matters
- Note if the bug is intermittent and under what conditions

### Be Minimal
- Find the shortest reproduction path
- Remove unnecessary steps
- If a bug happens on step 10 of a flow, check if it also happens in a simpler scenario

### Separate Bugs
- One bug per report. Don't bundle "I found 3 issues" into one report.
- If bugs are related, note the relationship but file separately.

### Don't Diagnose
- Report what you observed, not what you think the cause is
- ❌ "The database query is probably wrong"
- ✅ "Searching for 'billing' returns 0 results when 3 matching projects exist"
- Developer knows the code. Trust them to find the cause from good symptoms.

## Anti-Patterns

- **The novel**: 2 pages of context before getting to the bug. Put the bug first, context after.
- **The guess**: "I think it might fail if..." — either reproduce it or don't report it.
- **The drive-by**: "Something seems off with search." What seems off? Compared to what?
- **The combo**: "Search doesn't work, also the button color is wrong, and the loading is slow." Three separate bugs.
