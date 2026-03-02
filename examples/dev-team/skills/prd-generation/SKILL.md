---
name: prd-generation
description: "Produce a structured Product Requirements Document from clarified requirements. Use after requirement clarification is complete and the team needs a formal handoff document for Architect and QA."
---

# PRD Generation

Produce a structured, actionable Product Requirements Document that serves as the single source of truth for Architect (design), Developer (implementation), and QA (verification).

## Philosophy

> "A functional specification describes how a product will work entirely from the user's perspective. It doesn't care how the thing is implemented. It talks about features." — Joel Spolsky

The PRD is NOT a technical design document. It describes WHAT the product should do, not HOW it should be built. It is the contract between the user's intent and the team's execution.

> "Shaped work is rough, solved, and bounded." — Shape Up

The PRD should be detailed enough that no one has to guess what to build, but abstract enough that the Architect has room to design the best solution.

## When to Use

- After requirements have been clarified (use `requirement-clarification` skill first)
- When handing off work to Architect and QA
- When documenting a feature for future reference

## PRD Structure

```markdown
# PRD: [Feature/Project Title]

**Author**: [PM agent name]
**Status**: Draft | Review | Approved
**Priority**: P0 | P1 | P2
**Date**: [date]

---

## 1. Background & Motivation

Why are we doing this? What problem does this solve? What user pain does it address?
Include any relevant context: user feedback, market pressure, technical debt.

Keep it concise — 2-3 paragraphs max.

## 2. Goals

3 clear, orthogonal goals. Each goal should be independently valuable.

- **Goal 1**: [measurable outcome]
- **Goal 2**: [measurable outcome]
- **Goal 3**: [measurable outcome]

## 3. User Scenarios

For each distinct user journey, write a concrete scenario:

### Scenario 1: [Name]
**User**: [who]
**Context**: [when/where]
**Flow**:
1. User does X
2. System responds with Y
3. User sees Z
**Edge cases**: [what if...]

### Scenario 2: [Name]
...

## 4. Requirements

### 4.1 Functional Requirements

| ID | Priority | Requirement | Acceptance Criteria |
|----|----------|-------------|---------------------|
| F1 | P0 | [what] | Given [x], when [y], then [z] |
| F2 | P0 | [what] | Given [x], when [y], then [z] |
| F3 | P1 | [what] | Given [x], when [y], then [z] |

### 4.2 Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NF1 | Performance | [specific measurable target] |
| NF2 | Compatibility | [specific constraint] |

## 5. Non-Goals (Out of Scope)

Explicit list of what we are NOT doing and why.

- ❌ [thing]: [reason]

## 6. Dependencies & Interactions

How this feature interacts with existing system capabilities.

- [existing feature] → [how it's affected]

## 7. Open Questions

Unresolved items that need answers before or during implementation.

- [ ] [question] — owner: [who should answer]

## 8. Appendix (Optional)

Supporting data, mockups, research, competitive analysis.
```

## Guidelines

### For Architect (Design Consumer)
- Requirements should describe WHAT, never HOW
- Include enough context about existing system behavior for the Architect to make informed design decisions
- Flag areas where you anticipate architectural complexity: "This interacts with the notification system in non-obvious ways"

### For QA (Verification Consumer)
- Every functional requirement MUST have acceptance criteria
- Acceptance criteria must be verifiable without reading source code
- Include edge cases and error scenarios explicitly — don't leave them for QA to "figure out"
- Describe the expected behavior precisely: exact error messages, status codes, UI states

### For the User (Alignment Consumer)
- The PRD should be readable by the user who requested the feature
- They should be able to confirm "yes, this is what I want" or "no, you misunderstood"
- Avoid jargon. Describe behavior in terms the user understands.

## Quality Checklist

Before marking a PRD as ready for review:

- [ ] Every requirement has acceptance criteria
- [ ] At least one concrete user scenario exists
- [ ] Non-goals are explicitly stated
- [ ] Dependencies with existing features are documented
- [ ] Open questions have assigned owners
- [ ] A non-technical person can understand what will be built
- [ ] Priority is assigned to every requirement (P0/P1/P2)

## Anti-Patterns

- **The novel**: 10-page PRDs that no one reads. Be concise. If it's too long, split into multiple PRDs.
- **The wishlist**: Requirements without priorities. Everything is P0 means nothing is P0.
- **The blueprint**: Specifying database schemas, API formats, or code structure. That's the Architect's job.
- **The assumption**: "Obviously the search should be instant" — nothing is obvious. Write it down.
- **The orphan**: A PRD with no scenarios. If you can't describe a user doing it, maybe they don't need it.
