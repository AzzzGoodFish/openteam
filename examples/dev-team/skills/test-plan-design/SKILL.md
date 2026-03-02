---
name: test-plan-design
description: "Design a comprehensive test plan from product requirements and acceptance criteria. Use when receiving requirements from PM, before Developer completes implementation. Test design is independent of implementation."
---

# Test Plan Design

Design a test plan derived entirely from product requirements — not from implementation details. This is the foundation of independent verification.

## Philosophy

> "Write tests. Not too many. Mostly integration." — Guillermo Rauch

Tests exist to give you confidence that the system works for users. Not to achieve coverage numbers. Focus testing effort where it provides the most confidence per test.

> "The test pyramid argues that you should have many more low-level unit tests than high level broad-stack tests." — Martin Fowler

But remember: "If my high level tests are fast, reliable, and cheap to modify — then lower-level tests aren't needed." The pyramid is a guideline, not a law. Optimize for confidence.

> "I always argue that high-level tests are there as a second line of test defense. If you get a failure in a high level test, not just do you have a bug in your functional code, you also have a missing unit test." — Martin Fowler

QA's acceptance tests are the SECOND line of defense. Developer's unit tests are the first. When your tests catch something unit tests missed, that's a signal to send back.

## When to Use

- Immediately upon receiving requirements and acceptance criteria from PM
- Start designing tests BEFORE Developer finishes implementation
- Your test design is independent of and parallel to Architect's design work

## Core Principle: Test the Requirement, Not the Code

You design tests by reading the PRD and acceptance criteria. You do NOT:
- Read the source code to understand how it works
- Mirror the implementation structure in your tests
- Test internal functions, private methods, or implementation details
- Ask Developer how they implemented something

You DO:
- Test what the user sees and experiences
- Test the contract described in the acceptance criteria
- Test what happens when things go wrong
- Test interactions between features

## Process

### Step 1: Extract Test Cases from Acceptance Criteria

Every acceptance criterion becomes at least one test case:

**Acceptance Criterion**: "Given a user with valid credentials, when they submit the login form, then they are redirected to the dashboard"

**Test Cases**:
1. ✅ Valid credentials → redirect to dashboard
2. ❌ Invalid password → show error, stay on login page
3. ❌ Non-existent email → show error (same message as invalid password — no user enumeration)
4. ❌ Empty fields → show validation error
5. 🔄 Already logged in → redirect directly to dashboard

### Step 2: Categorize Test Cases

Organize tests into categories:

1. **Happy Path** — The normal, expected flow works correctly
2. **Boundary Conditions** — Edge cases at the limits of valid input
3. **Error Handling** — Invalid input, failures, unexpected states
4. **Regression** — Existing features still work after the change
5. **Integration** — The new feature works correctly with existing features

### Step 3: Prioritize Test Cases

Not all tests are equally valuable. Prioritize:

- **P0**: Happy path + critical error cases (if these fail, the feature is broken)
- **P1**: Boundary conditions + important integrations (if these fail, the feature is unreliable)
- **P2**: Edge cases + minor error handling (if these fail, the feature is rough around the edges)

### Step 4: Design Test Structure

For each test case, specify:

```markdown
### Test: [descriptive name]
**Category**: Happy Path | Boundary | Error | Regression | Integration
**Priority**: P0 | P1 | P2
**Requirement**: [which PRD requirement this verifies]

**Preconditions**: [what must be true before the test]
**Steps**:
1. [action]
2. [action]
**Expected Result**: [what should happen — be specific]
**Cleanup**: [if any state needs to be reset]
```

### Step 5: Produce the Test Plan

```markdown
# Test Plan: [Feature Title]

**PRD**: [link/reference]
**Author**: [QA agent]
**Status**: Draft | Ready | Executing

## Coverage Summary
- Total test cases: [n]
- P0 (critical): [n]
- P1 (important): [n]
- P2 (nice-to-have): [n]

## Test Cases

### Happy Path
[test case list]

### Boundary Conditions
[test case list]

### Error Handling
[test case list]

### Regression
[test case list]

### Integration
[test case list]

## Test Environment
- [any specific setup needed]
- [test data requirements]
```

## Guidelines

- **Start early.** You can design 80% of tests from the PRD alone, before any code is written.
- **Think like a user, not a developer.** Your tests should describe what a user does and sees, not what functions get called.
- **Be specific about expected results.** "The system shows an error" is not a test. "The system shows 'Invalid email format' below the email field and does not submit the form" is a test.
- **Don't test everything.** Focus on what matters. 10 well-chosen tests beat 100 mechanical ones.
- **Update as requirements evolve.** If PM changes acceptance criteria, update the test plan immediately.
