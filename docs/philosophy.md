# Philosophy: Blueprint-Implementation Balance

> The quality of AI-assisted coding depends not on the model, but on whether you know what you're building, how deeply you understand it, whether you can choose the right architecture, and whether you can guide the agent to follow your vision.

## The Spectrum

AI coding operates on a continuous spectrum between two poles:

```
Blueprint ◄─────────────────────────────► Implementation
(Design)                                    (Code)

  PM          Architect        Developer        Model
  What        How              Execute          Generate
```

As model capabilities evolve, the engineer's center of gravity shifts left — from implementation toward blueprint. But it never reaches either extreme. The art is in finding the right balance point.

## Core Principles

### 1. Blueprint Before Code

A single sentence of requirement hides multiple features, edge cases, and assumptions. The cost of discovering these during coding is 10-100x higher than discovering them during design.

The team exists to ensure that **what gets built** is fully understood before **how to build it** is decided, and **how to build it** is fully designed before **code is written**.

```
User Intent → PM (clarify what) → Architect (design how) → Developer (implement) → QA (verify)
```

Each stage enriches context. Each handoff reduces ambiguity.

### 2. Separation of Concerns in Verification

The entity that builds something cannot objectively verify it. This is not a trust issue — it's a structural one.

- **Developer** writes code and unit tests → proves "I built it correctly"
- **QA** writes acceptance tests from requirements → proves "the right thing was built"

These are fundamentally different questions answered by fundamentally different perspectives.

### 3. Fight Entropy Actively

The natural tendency of AI-generated code is **expansion**: new files, new abstractions, duplicated logic, eroded boundaries. Without active architectural stewardship, every feature makes the next feature harder to build.

The Architect's role is to resist this entropy — read code deeply, design changes that make the system simpler (or at worst no more complex), and reject implementations that trade short-term convenience for long-term degradation.

### 4. Calibrate to Model Capability

A good engineer judges:

- **What the model can do** — its strengths, blind spots, and failure modes
- **How well it executed** — reviewing output quality, not just completion
- **Where to intervene** — at what level of abstraction human guidance adds the most value

This calibration point shifts as models improve. Today's architect-level guidance may become tomorrow's single prompt. But the need for someone to *know what the right answer looks like* never disappears.

### 5. Simplicity as Architecture

> "Complexity should exist only in the problem domain. Infrastructure remains simple."

The team's tools, communication patterns, and processes should be as simple as possible. File-based memory, async message passing, structured handoff documents. No unnecessary infrastructure.

If a process can't be explained in a few sentences, it's too complex. If a role can't articulate its boundary in one sentence, it's poorly defined.

## Implications for the Team

### PM's job is expanding

As implementation becomes more automated, the PM's role in requirement clarity, scenario coverage, and acceptance criteria becomes the primary quality lever. A vague requirement + a powerful model = a fast wrong answer.

### Architect is the critical path

The architect sits at the balance point of the spectrum. They must understand both the product (from PM) and the code (from reading the codebase). They translate intent into structure. As models handle more implementation, the architect's design decisions have proportionally greater impact on outcome quality.

### Developer is the executor, not the decision-maker

The developer follows the plan. This isn't a limitation — it's a strength. By not making architectural decisions, the developer avoids the "creative interpretation" that causes most AI coding failures. The plan is the guardrail.

### QA is the reality check

QA exists because confidence requires independence. No matter how good the model gets at writing code, the question "does this actually solve the user's problem?" needs a separate answer from a separate perspective.

## The Anti-Pattern: AI Slop

When you skip the blueprint and go straight to implementation:

- You get 150K lines of code in a week with no design
- You get features that "work" but don't compose
- You get architectures that fight themselves
- You get products that solve the wrong problem quickly

Volume is not value. Speed without direction is waste.

## The Goal

OpenTeam exists to make the blueprint-implementation balance **explicit and repeatable**:

- Explicit roles with clear boundaries
- Structured handoff documents (PRD → Implementation Plan → Acceptance Report)
- Independent verification at every stage
- Skills that encode proven engineering practices

The result: AI that builds what you actually need, in an architecture that survives the next feature.
