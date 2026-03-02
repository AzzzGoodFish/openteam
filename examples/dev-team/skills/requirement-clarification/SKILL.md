---
name: requirement-clarification
description: "Decompose vague or incomplete requests into explicit, actionable requirements. Use when receiving any new feature request, bug report, or change request from a user before passing work to the team."
---

# Requirement Clarification

Transform a vague human request into clear, complete, actionable requirements with acceptance criteria.

## Philosophy

> "The most important function of a spec is to design the program... when you design your product in a human language, it only takes a few minutes to try thinking about several possibilities, revising, and improving your design." — Joel Spolsky

A single sentence from a user often hides 3-5 distinct requirements, multiple edge cases, and several unstated assumptions. The cost of discovering these gaps during coding is 10-100x higher than discovering them during clarification.

> "Wireframes are too concrete. Words are too abstract." — Shape Up (Basecamp)

Good requirements live at the right level of abstraction: **rough** enough to leave room for design, **solved** enough to show the path forward, **bounded** enough to know where to stop.

## When to Use

- Any time you receive a new request from a user
- When a request feels "obvious" — that's usually when the most assumptions are hiding
- When requirements change mid-flight and you need to re-assess

## Process

### Step 1: Listen and Restate

Before asking questions, restate the request in your own words. This immediately surfaces misunderstandings.

**Template**: "If I understand correctly, you want [restated goal] so that [assumed reason]. Is that right?"

### Step 2: Ask the Five Clarification Questions

For every request, work through these:

1. **WHO** — Who is the user? Are there multiple user types affected differently?
2. **WHAT** — What specifically should happen? What should NOT happen?
3. **WHEN** — What triggers this? Is it always available or conditional?
4. **WHERE** — Where does this fit in the existing system? What does it interact with?
5. **WHAT IF** — What happens when things go wrong? Invalid input? Network failure? Concurrent access? Permission denied?

### Step 3: Identify the Hidden Requirements

A request like "add search to the dashboard" actually contains:

- Search input UI (where? how does it look?)
- What is searchable? (all fields? specific fields?)
- Search behavior (instant? on-enter? debounced?)
- Empty state (no results found)
- Performance (how fast? what about large datasets?)
- Interaction with existing filters (replace? combine?)
- URL state (is the search query in the URL? shareable?)
- Accessibility (keyboard navigation? screen readers?)

Practice decomposing every request this way. The "obvious" features hide the most complexity.

### Step 4: Restore the Usage Scenario

Paint a concrete picture. Don't write abstract specs — write stories:

**Bad**: "The system should support search functionality with filtering capabilities."

**Good**: "Alice opens the dashboard and sees 200 projects. She types 'billing' in the search box. As she types, the list filters in real-time. She sees 3 projects with 'billing' in the name. She clicks one to open it. If she clears the search, all 200 projects reappear."

Scenarios expose gaps that specs hide. If you can't write the scenario, you don't understand the requirement.

### Step 5: Define Non-Goals

Explicitly state what you are NOT doing. This is as important as stating what you are doing.

> Shape Up calls this "setting the appetite" — deciding how much time and scope a feature deserves before designing the solution.

**Template**:
- ✅ We WILL: [in-scope items]
- ❌ We WON'T: [out-of-scope items, with brief reason]
- 🔮 We MIGHT LATER: [future considerations, explicitly deferred]

### Step 6: Write Acceptance Criteria

Every requirement gets acceptance criteria written as verifiable statements:

**Format**: "Given [context], when [action], then [expected result]"

Rules for good acceptance criteria:
- **Testable** — An independent person (QA) can verify pass/fail without asking you
- **Specific** — Numbers, states, exact behaviors — not "fast" or "user-friendly"
- **Complete** — Cover happy path, edge cases, and error cases
- **Independent** — Each criterion can be verified on its own

### Step 7: Assign Priority

- **P0 (Must-have)**: The feature is meaningless without this. Ship-blocking.
- **P1 (Should-have)**: Important but the feature still works without it. Do it if time allows.
- **P2 (Nice-to-have)**: Enhances the experience. Do it only if everything else is done.

## Output Format

```markdown
# Requirement: [Title]

## Background
Why this is needed. What problem it solves.

## User Scenario
Concrete story of a user going through the workflow.

## Requirements
- [R1] P0: [requirement with acceptance criteria]
- [R2] P0: [requirement with acceptance criteria]
- [R3] P1: [requirement with acceptance criteria]

## Non-Goals
- [what we're explicitly not doing and why]

## Open Questions
- [things we still need to clarify]

## Dependencies
- [existing system features this interacts with]
```

## Anti-Patterns

- **Premature solutioning**: Describing HOW to implement instead of WHAT the user needs
- **Acceptance-criteria-by-vibes**: "It should feel responsive" is not a criterion
- **Scope creep via "while we're at it"**: Each addition gets its own evaluation
- **Assuming context**: Don't assume the developer knows what "the dashboard" means — be specific
