---
name: technical-feasibility
description: "Identify unvalidated technical assumptions in a design, research them against external sources (docs, APIs, community), and produce a feasibility verdict. Use after receiving requirements and before implementation planning, whenever the design depends on technologies, APIs, or platform capabilities you haven't verified."
---

# Technical Feasibility Validation

Surface the assumptions hiding in your design, validate them against reality, and kill bad ideas before they become bad code.

## Philosophy

> "The most dangerous assumptions are the ones nobody thinks to question." — Gerald Weinberg

Every design contains assumptions — about what an API can do, how a library behaves, what a platform allows. In AI-assisted development, these assumptions multiply fast because the agent confidently fills in gaps with plausible-sounding answers. Plausible is not verified.

> "One of the primary reasons that architectural approaches need to be validated is that we take a significant risk if we build the system and find out afterwards that it didn't work." — Simon Brown (Software Architecture for Developers)

The cost of discovering a wrong assumption during implementation is 10x higher than discovering it during design. The cost of discovering it in production is 100x. This skill exists to shift discovery left — into the cheapest phase.

> "Do the simplest thing that could possibly work." — Kent Beck

But first, verify that the simple thing *actually* works. Simplicity built on a false assumption is just well-organized failure.

## When to Use

- After receiving requirements that involve **external dependencies** you haven't personally verified (APIs, libraries, platform features, protocols)
- When your design assumes a capability that you learned from training data rather than from current documentation
- When PM's requirements push into unfamiliar technical territory
- When Developer or QA raises doubt about whether something is actually possible
- Before implementation-planning, to ensure the plan is built on verified ground

## What This Is NOT

- Not a full technology evaluation or market research — that's a different activity
- Not codebase exploration — use codebase-mapping for that
- Not a proof of concept (you don't build anything) — you research and document findings
- Not needed for well-understood, already-used technologies in the project

## Process

### Step 1: Extract Assumptions

Read the requirements and your design notes. For every technical decision, ask:

**"What am I assuming is true that I haven't verified?"**

Common assumption categories:

| Category | Example |
|----------|---------|
| **API capability** | "This API supports batch operations" |
| **Library behavior** | "This library can handle streaming responses" |
| **Platform constraint** | "Lambda supports connections longer than 30s" |
| **Protocol support** | "The target environment allows WebSocket upgrades" |
| **Data format** | "The response includes pagination metadata" |
| **Performance** | "This operation completes within our latency budget" |
| **Compatibility** | "These two libraries work together without conflicts" |
| **Authentication** | "This service supports API key auth, not just OAuth" |
| **Rate limits** | "The free tier allows enough requests for our use case" |

Produce a numbered list of assumptions, each with:
- **Assumption**: What you believe to be true
- **Criticality**: How badly the design breaks if this is wrong (Critical / Major / Minor)
- **Confidence**: How sure you are before research (High / Medium / Low / Guessing)

**Focus on Critical + Low-Confidence items.** These are where research has the highest ROI.

### Step 2: Research and Validate

For each assumption worth validating (Critical or Major with Medium-or-lower confidence):

1. **Check official documentation first** — the primary source of truth
2. **Check release notes / changelogs** — capabilities change between versions
3. **Check community sources** — Stack Overflow, GitHub issues, forums often reveal real-world behavior that docs omit
4. **Check known limitations** — every technology has them; look for the "Limitations" or "Known Issues" section
5. **Cross-reference multiple sources** — a single blog post is not validation

**Research standards** (borrowed from bmad research methodology):
- **Anti-hallucination**: Never claim something is validated based on your training data alone. Cite the source.
- **Confidence levels**: Mark each finding as [Verified], [Likely], or [Unverified]
- **Conflict resolution**: When sources disagree, document both and flag the discrepancy
- **Version awareness**: Note the version of the technology your finding applies to

### Step 3: Assess Impact

For each validated or invalidated assumption, determine the design impact:

- **Confirmed** — Assumption holds. No design change needed. Record the evidence.
- **Partially confirmed** — Works but with caveats (rate limits, version requirements, partial support). Design may need adjustment.
- **Invalidated** — Assumption is wrong. The design must change. Propose alternatives immediately.
- **Inconclusive** — Cannot determine from research alone. Flag as a risk; may need a spike or prototype.

### Step 4: Produce the Feasibility Report

```markdown
# Technical Feasibility Report: [Feature Title]

**Requirement**: [brief summary or link to PRD]
**Architect**: [name]
**Verdict**: Go | Go with caveats | Blocked — needs redesign

## Summary
One paragraph: overall feasibility assessment and key risks.

## Assumptions Validated

### [#] [Assumption title]
**Assumption**: [what was assumed]
**Criticality**: Critical | Major | Minor
**Status**: Confirmed | Partially confirmed | Invalidated | Inconclusive
**Evidence**: [what you found, with source links]
**Design impact**: [none | adjustment needed | redesign required]
**Action**: [what to do — keep plan, modify approach, or propose alternative]

### ...

## Design Adjustments Required
[If any assumptions were invalidated or partially confirmed, describe the required changes to the design approach]

## Unresolved Risks
[Anything that couldn't be validated through research alone — may need a prototype or spike]

## Sources
- [Technology] official docs: [URL]
- [Relevant GitHub issue/discussion]: [URL]
- ...
```

## Guidelines

- **Be honest about what you don't know.** An architect who says "I assumed this works but haven't verified" is more valuable than one who says "this works" based on vibes.
- **Go deep on critical items, skim minor ones.** Not every assumption needs a research paper. Focus your time where the design risk is highest.
- **Version-pin your findings.** "Works in v3.2" is useful. "Works" is not — because v4.0 might break it.
- **Update the feasibility report as you learn more.** If Developer discovers something during implementation that contradicts your findings, update the report.
- **Don't let research become procrastination.** The goal is to validate the critical unknowns, not to achieve perfect knowledge. When you have enough to make a design decision, stop researching and start planning.
- **Share findings with the team.** If you discover that a key API doesn't work as expected, PM needs to know — it may change the requirement, not just the implementation.
