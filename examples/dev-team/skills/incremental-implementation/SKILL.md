---
name: incremental-implementation
description: "Execute implementation plans through small, verified steps — fighting the complexity explosion that AI-assisted development naturally produces. Use throughout the entire implementation process, from first line to last commit."
---

# Incremental Implementation

Build working software one verified step at a time. The antidote to AI-generated complexity explosion.

## Philosophy

> "Make it work, make it right, make it fast." — Kent Beck

But the critical missing word is *incrementally*. AI agents are uniquely dangerous here: they can produce 500 lines of plausible-looking code in one shot. Plausible is not working. The only way to know code works is to run it — and the smaller the step, the easier it is to find what broke.

> "The key to TDD is the size of the steps. They should be small... not because you're stupid, but because you want immediate feedback." — Kent Beck (Test Driven Development by Example)

Immediate feedback is not a luxury — it's your only defense against the illusion of progress. A mountain of unverified code is not progress; it's debt you haven't discovered yet.

> "The first rule of functions is that they should be small. The second rule of functions is that they should be smaller than that." — Robert C. Martin (Clean Code)

This isn't just about function size. It's about change size. Each step you take should be small enough that when tests fail, you know exactly where the problem is.

## The Core Problem

AI agents have three failure modes that this skill directly addresses:

1. **Complexity explosion** — The agent writes too much code at once. New files, new abstractions, new utilities — each "helping" the next. By the time tests run, the blast radius of failure is enormous.

2. **Plausible but wrong** — The agent produces code that reads like it should work. Variable names make sense. The structure looks clean. But it was never executed. "Looks correct" is the most dangerous state code can be in.

3. **Lost comprehension** — The agent writes code it doesn't fully understand. It assembled patterns that seemed right, but can't explain why line 47 handles the edge case it does. If you can't explain it, you can't debug it.

## When to Use

- Every time you implement code from a plan or specification
- This is not a sometimes-skill — it's your operating discipline

## Process

### Step 1: Decompose Before You Code

Read the implementation plan. Break each task into steps where each step:

- Changes **one thing** (one function, one behavior, one integration point)
- Can be **verified independently** (has a test or an observable outcome)
- Is **small enough** that if it breaks, you know why within seconds

**Rule of thumb**: If a step touches more than 2-3 files, it's too big. Split it.

### Step 2: Read the Code You're About to Change

Before modifying any file:

1. Read the **entire file**, not just the function you'll change
2. Understand the **conventions** — naming, error handling, patterns
3. Identify **what already exists** that you can use
4. Note **what other code depends** on what you're about to change

**The #1 cause of bugs in AI-assisted development**: modifying code without understanding its context. The five minutes you spend reading saves the hour you'd spend debugging.

### Step 3: Red-Green-Refactor (Per Step)

For each step in your decomposition:

**RED** — Write a failing test first
- The test defines what "done" means for this step
- Run the test. Watch it fail. This confirms the test actually tests something.
- If you can't write a test, you don't understand the requirement well enough.

**GREEN** — Write the minimum code to pass
- Minimum means minimum. Not "clean" minimum, not "elegant" minimum — just make the test green.
- Resist the urge to write ahead. The next step has its own tests.

**REFACTOR** — Clean up while green
- Improve structure, naming, duplication — only if tests stay green
- If refactoring breaks a test, you went too far. Revert and try smaller.

### Step 4: Verify the Full Context

After each step passes:

1. Run the **entire test suite**, not just your new tests
2. Check for **regressions** — your change might break something you didn't expect
3. If the suite fails, fix it **now** — never proceed with failing tests

**Non-negotiable rule**: You do not move to the next step until all tests pass. This is not optional. This is not flexible. Broken tests are a stop sign.

### Step 5: Confirm Your Understanding

After each task (group of steps), pause and verify:

- Can you explain **what you just built** and **why** it works?
- Can you trace the **data flow** through your changes?
- Do you know what would break if someone **deleted line X**?

If you can't answer these, you've written code you don't understand. That's a bug waiting to happen. Go back and read what you wrote until you can explain it.

### Step 6: Report Honestly

When reporting completion:

```
Task: [task name]
Files changed: [list with specific changes per file]
Tests added: [count, what they verify]
All tests passing: yes/no
Regressions: none / [describe]
```

**Never claim "all tests pass" without running them.** Never claim "no regressions" without running the full suite. Honesty is not optional — a lie here costs hours of rework downstream.

## Modification vs. Creation

Before creating any new file, answer these questions:

1. **Does an existing file already handle this concern?** → Modify it
2. **Does the plan explicitly specify a new file?** → Create it, but only with what the plan requires
3. **Am I creating this file for "cleanliness"?** → Don't. Put it in an existing file.

The default action is **modify**. Creation requires justification. Every new file increases the surface area of the codebase — which is entropy.

## Anti-Patterns

| What it looks like | Why it's dangerous |
|---|---|
| Writing all code first, then all tests | Tests become post-hoc rationalizations, not specifications |
| "I'll run tests after I finish the whole task" | Blast radius grows with every unverified line |
| Creating helper files "for later" | You're designing, not implementing — stay in scope |
| Copy-pasting similar code to "move fast" | Duplication is debt. Flag it for abstraction instead |
| Skipping the read step because "I know this file" | You know what it looked like last time. It may have changed. |
| Reporting "tests pass" based on expectation | Run them. Every time. No exceptions. |

## Guidelines

- **Speed comes from small steps, not from big leaps.** Counterintuitively, writing less code per step makes you faster overall because you spend zero time debugging mystery failures.
- **When stuck, make the step smaller.** If a step is hard to implement, it's probably trying to do too much. Split it.
- **Commit at natural boundaries.** After a task is complete and all tests pass, that's a commit point. Small, verified commits are easier to review and easier to revert.
- **Ask early, not late.** If you're unsure about the plan, clarify before writing code. Rework is more expensive than a question.
