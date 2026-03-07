---
name: self-verification
description: "Systematically verify your own implementation through layered testing. Use after completing implementation tasks, before considering the work done."
---

# Self-Verification

Prove your code works — to yourself, with evidence — before anyone else sees it.

## Philosophy

> "Testing shows the presence, not the absence of bugs." — Edsger Dijkstra

If testing can only show presence, then the question is: how thoroughly have you looked? A developer who runs one happy-path test and calls it done has barely looked at all.

> "I'm not a great programmer; I'm just a good programmer with great habits." — Kent Beck

Self-verification is a habit, not a talent. The discipline of checking your own work at multiple levels is what separates code that survives contact with reality from code that merely compiles.

> "Code without tests is broken by design." — Jacob Kaplan-Moss

But tests themselves can be broken by design too. A test that always passes proves nothing. A test that mirrors the implementation instead of testing the behavior is just a mirror — it reflects what you wrote, not whether it's correct.

## The Core Problem

AI agents are exceptionally good at producing code that **looks correct**. The syntax is right. The structure is reasonable. The variable names are descriptive. And yet:

- The edge case on line 34 silently swallows an error
- The async function doesn't handle the rejection path
- The loop works for 1 item and 100 items but breaks at 0
- The integration assumes a response format that changed in v2.1

You cannot see these problems by reading. You can only find them by **executing** — with tests designed to expose failure, not to confirm success.

## When to Use

- After completing each task from the implementation plan
- Before considering the work "done"
- As the final gate between implementation and any downstream verification

## Scope

Self-verification is **inside-out testing**: does my code do what I intended? This is distinct from acceptance testing, which works outside-in from requirements. Both are needed, but this skill focuses on what you can verify as the implementer — using your knowledge of the code to test it more deeply than anyone else can.

## Process

### Layer 1: Unit Tests — Does Each Piece Work?

Test individual functions and modules in isolation.

**What to test:**
- Pure functions: correct output for given inputs
- Edge cases: empty inputs, zero values, null/undefined, boundary values
- Error paths: invalid inputs, failure conditions, exception handling
- State transitions: does the state change correctly for each operation?

**Test selection rules** (from the test pyramid):
- If it's pure logic with no side effects → unit test
- If it has high cyclomatic complexity (multiple branches) → unit test each branch
- If it does calculations → unit test with known input/output pairs

**Red flags in your unit tests:**
- Test only calls the function and checks it doesn't throw — that's not a test, that's a smoke signal
- Test duplicates the implementation logic to compute the expected value — you're testing nothing
- Test uses the same data for every case — you're testing one path, not the function

### Layer 2: Integration Tests — Do the Pieces Work Together?

Test that your modified/created modules interact correctly with their dependencies.

**What to test:**
- Does module A call module B with the right arguments?
- Does the data flow through the full path correctly?
- Do error conditions in one module propagate correctly to another?
- Do new integrations respect existing contracts (function signatures, data formats)?

**When to use integration over unit:**
- Testing persistence (database, file system, state stores)
- Testing API contracts between modules
- Testing that your changes don't break existing callers

**Duplicate coverage guard** — before adding an integration test, check:
1. Is this already covered at unit level? → Don't duplicate
2. Would a unit test suffice? → Prefer unit
3. Is the interaction between modules the thing at risk? → Integration is correct

### Layer 3: Smoke Verification — Does the Feature Actually Work?

Step outside your developer perspective. Pretend you're a user. Run the feature.

**What to do:**
- Execute the core user journey that this feature enables
- Use realistic inputs, not test fixtures
- Check the observable outcome — what would a user actually see?
- Try the obvious "wrong" thing — what happens if input is missing?

**This is not acceptance testing.** You're not verifying every acceptance criterion. You're doing a basic sanity check: *does the thing I just built actually work when used like a real user would?*

**Common discovery at this layer:**
- "The unit tests all pass, but the feature doesn't actually work end-to-end because I forgot to wire module A to module B"
- "It works in my test but fails when called from the real entry point because the data format is different"
- "The happy path works but the error message is unreadable / the error crashes the process"

### Verification Report

After all three layers, produce an honest assessment:

```markdown
## Self-Verification: [Task Name]

### Unit Tests
- Tests added: [count]
- Coverage: [what's covered — functions, branches, edge cases]
- All passing: yes/no

### Integration Tests
- Tests added: [count]
- Coverage: [which module interactions verified]
- All passing: yes/no

### Smoke Verification
- Core journey tested: [describe what you did]
- Result: works / works with caveats / fails
- Issues found: [list, or "none"]

### Full Suite
- Ran complete test suite: yes/no
- Regressions found: none / [describe]

### Honest Assessment
- Confidence level: high / medium / low
- Known gaps: [anything you couldn't test and why]
- Risks for downstream verification: [what should get extra attention]
```

The "Honest Assessment" section is the most important part. Flagging "error handling around X has low confidence because edge cases are hard to reproduce" saves everyone time. Pretending everything is perfect when it isn't wastes everyone's time.

## What Makes a Good Test

A test is valuable when it can **fail meaningfully**. Ask yourself:

- If I delete the code this tests, does the test fail? (If not, it tests nothing)
- If I introduce a bug in the logic, does the test catch it? (If not, it's too shallow)
- Does the test tell me **where** the problem is when it fails? (If not, it's too broad)
- Would this test still make sense if the implementation changed but the behavior stayed the same? (If not, it's too coupled to implementation)

## Anti-Patterns

| What it looks like | Why it's dangerous |
|---|---|
| Writing tests that mirror the implementation | You're testing that your code does what your code does — circular |
| Testing only the happy path | Edge cases are where bugs live |
| Mocking everything | You're testing your mocks, not your code |
| Skipping Layer 3 ("unit tests pass, it must work") | Unit tests verify pieces; they don't verify the whole |
| Reporting high confidence without running the full suite | Confidence without evidence is optimism, not verification |
| Testing framework behavior instead of your code | Don't test that `Array.push` works — test your logic that uses it |

## Guidelines

- **Test behavior, not implementation.** Your test should describe *what* the code does, not *how*. "calculateTotal returns 130 for items [50, 80]" beats "calculateTotal calls reduce then applies tax multiplier."
- **Prefer the lowest test level that covers the risk.** Unit test for logic, integration test for boundaries, smoke test for wiring. Don't use E2E to test arithmetic.
- **When a test is hard to write, the code is telling you something.** Difficulty in testing usually means the code is doing too much, has hidden dependencies, or has unclear boundaries. Fix the code, don't work around it in the test.
- **Run the full suite every time, not just your new tests.** Regressions hide in the tests you didn't run.
- **Be honest about what you didn't test.** A known gap reported is better than an unknown gap hidden.
