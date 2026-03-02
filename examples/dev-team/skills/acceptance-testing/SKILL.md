---
name: acceptance-testing
description: "Execute acceptance tests against completed implementation, run the full test suite, and produce a structured verification report. Use after Developer notifies implementation is complete."
---

# Acceptance Testing

Execute your test plan against the completed implementation, run the full test suite, and produce a definitive pass/fail acceptance report.

## Philosophy

> "Acceptance criteria are the contract." — from QA Agent prompt

Your job is binary: each criterion either passes or fails. There is no "close enough." There is no "it mostly works." The acceptance criteria from PM define the contract, and you enforce it.

The separation between development and verification exists for a reason — the person who built it cannot objectively judge it. You are the independent judge.

## When to Use

- After Developer notifies that implementation is complete
- After Developer fixes bugs from a previous verification round
- For regression testing after significant changes

## Process

### Step 1: Verify Preconditions

Before testing:

1. **Developer confirmation** — Has Developer explicitly stated all tasks are complete and all unit tests pass?
2. **Test plan ready** — Is your test plan from `test-plan-design` complete and up to date?
3. **Environment** — Is the test environment set up? Any dependencies needed?

If preconditions aren't met, don't start. Send the gap back to the responsible party.

### Step 2: Run Developer's Unit Tests First

Run the full unit test suite that Developer wrote:

- If unit tests FAIL → **Stop.** Send back to Developer. Don't waste time on acceptance tests when basic code correctness is broken.
- If unit tests PASS → Proceed to acceptance testing.

This matters: unit test failures are Developer's problem. Acceptance test failures are requirement understanding problems.

### Step 3: Execute Acceptance Tests

Work through your test plan systematically:

For each test case:
1. Set up preconditions
2. Execute the steps exactly as written
3. Compare actual result against expected result
4. Record: PASS, FAIL, or BLOCKED (with details)
5. If FAIL: capture evidence (error output, logs, screenshots if applicable)

**Important**: Execute tests in priority order (P0 first). If critical tests fail, you may choose to stop and report early rather than continuing with lower priority tests.

### Step 4: Write Acceptance Test Code

Translate your test cases into executable test code:

- Use the project's existing test framework
- Tests should be in a separate directory/file from Developer's unit tests
- Tests should interact with the system at the user-facing level (API calls, CLI commands, UI actions)
- Tests should NOT import internal modules or call private functions
- Tests should be readable by PM — the test name and assertions should tell the story

### Step 5: Regression Check

Verify that existing features still work:

- Run the full pre-existing test suite
- If any pre-existing test now fails → regression bug, report separately
- Pay special attention to features listed in the PRD's "Dependencies & Interactions" section

### Step 6: Produce Acceptance Report

```markdown
# Acceptance Report: [Feature Title]

**PRD**: [reference]
**Test Plan**: [reference]  
**Tester**: [QA agent]
**Date**: [date]
**Verdict**: ✅ ACCEPTED | 🔴 REJECTED

## Summary
[One paragraph: overall result and key findings]

## Results by Criterion

| ID | Requirement | Result | Evidence |
|----|------------|--------|----------|
| F1 | [requirement text] | ✅ PASS | [brief evidence] |
| F2 | [requirement text] | ❌ FAIL | [see Bug #1] |
| F3 | [requirement text] | ⏸️ BLOCKED | [reason] |

## Bugs Found

### Bug #1: [Title]
**Severity**: Critical | Major | Minor
**Requirement**: [which requirement it violates]
**Steps to Reproduce**:
1. [step]
2. [step]
**Expected**: [what should happen]
**Actual**: [what actually happened]
**Evidence**: [error output, logs]

## Regression Results
- Pre-existing test suite: [PASS / n failures]
- Regression issues: [none / list]

## Test Coverage
- Total tests: [n]
- Passed: [n]
- Failed: [n]
- Blocked: [n]
```

## Decision Logic

```
Unit tests fail?
  → REJECT, send to Developer, don't run acceptance tests

Any P0 acceptance test fails?
  → REJECT, file bugs, send to Developer

All P0 pass, some P1 fail?
  → REJECT if P1 failures are significant
  → ACCEPT WITH NOTES if P1 failures are minor and documented

All P0 and P1 pass, some P2 fail?
  → ACCEPT WITH NOTES, document P2 failures for future

Regression failures?
  → REJECT regardless of acceptance test results
```

## Guidelines

- **Be thorough but efficient.** Run P0 tests first. If they fail, report early.
- **Evidence over opinion.** Every failure needs reproduction steps and actual output.
- **Don't fix bugs yourself.** Your job is to find and report them, not to fix them. Send them to Developer.
- **Re-verify completely.** When Developer fixes a bug, re-run ALL tests, not just the one that failed. Fixes can introduce new bugs.
- **Separate your concerns.** Unit test failures → Developer problem. Acceptance failures → may be Developer or PM problem (misunderstood requirement). Regression → Developer problem.
