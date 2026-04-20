---
name: requirements-clarification
description: >
  Use this skill when the user request is ambiguous, under-specified, or lacks clear scope or completion criteria. It structures the request into objective, scope, constraints, assumptions, open questions, and acceptance criteria, then hands off to planning or an execution skill. Do not use when the request is already concrete enough for `investigation`, `implementation`, `refactoring`, or `public-research`. Expected result: a written requirements document and a clear next-skill recommendation.
---

# Requirements Clarification

## Purpose

This skill structures vague, ambiguous, or under-specified user requests into a formal requirements document. Use it before `implementation` or planning when the request is not yet clear enough to act on directly.

The goal is to turn an unclear request into a written, reviewable artifact with explicit gaps identified and resolved where possible.

## When to use

Use this skill when the user request meets any of these conditions:

- the objective is vague or can be interpreted in multiple ways
- the scope is undefined or unclear
- no explicit constraints or acceptance criteria are given
- critical terms or concepts in the request are ambiguous
- the request could be satisfied at very different levels of effort or complexity

## When not to use

Do not use this skill when:

- the request is concrete enough to proceed directly to `implementation`, `investigation`, `refactoring`, or `public-research`
- the user is asking a factual question that does not require structural clarification
- the task is already structured by a command workflow (e.g. `/add-prompt-capability`)

## Expected inputs

- the raw user request
- any context the user provides (background, preferences, constraints)
- information discoverable from the repository

## Expected outputs

- a structured requirements document written to an external file
- targeted follow-up questions for the user when genuine gaps remain
- a handoff recommendation naming the appropriate downstream skill

## Core rules

### 1. Discover before asking

Before generating questions, check what the repository, existing files, configuration, and code patterns already reveal. Ask only about genuine gaps that cannot be resolved from available context.

This aligns with the global rule: prefer discovered facts over unnecessary questions.

### 2. Do not start implementation

This skill produces requirements only. Do not begin editing code, creating files beyond the requirements document, or making design decisions that belong to implementation.

### 3. Distinguish assumptions from facts

When you fill in a section based on inference rather than explicit user statement or repository evidence, label it as an assumption. Do not present assumptions as confirmed requirements.

### 4. Keep the document concise

Write the minimum structure needed to clarify the request. Do not pad the document with boilerplate, generic advice, or obvious statements.

### 5. Generate targeted questions

When you must ask the user, make each question specific and actionable. Avoid broad, open-ended questions when a concrete choice or confirmation would suffice.

Prefer questions framed as:

- a choice between explicit options
- a confirmation or correction of a stated assumption
- a request for a specific missing value or criterion

Avoid questions framed as:

- "What do you want?" (too broad)
- "Please describe your requirements in detail" (pushes framing work back to the user)

### 6. Write to an external file

After structuring, write the requirements document to a file. The default location is `docs/requirements/<slug>.md` where `<slug>` is a short kebab-case identifier derived from the objective. If the user specifies a different location, use that instead.

If the `docs/requirements/` directory does not exist, create it.

## Requirements document template

Use this structure for the output file:

```markdown
# Requirements: <title>

## Objective

<One sentence stating what must be achieved.>

## Scope

- In scope:
  - <item>
- Out of scope:
  - <item>

## Constraints

- <constraint>

## Assumptions

- [ASSUMPTION] <assumed fact not yet confirmed by user>

## Open questions

- [ ] <question to resolve>

## Acceptance criteria

- [ ] <measurable condition that must be true when done>
```

Fill in each section based on what is known. If a section has no content after discovery, write `None identified.` rather than leaving it blank.

## Procedure

### Step 1: Receive and restate

Restate the user's request in your own words internally. Identify which parts are concrete and which are ambiguous.

### Step 2: Discover from context

Read relevant repository files, configuration, code patterns, and documentation to answer as many requirement questions as possible without asking the user.

### Step 3: Structure into the template

Fill in each section of the requirements template:

- **Objective**: what the user wants to achieve, stated as a single goal
- **Scope**: what is included and explicitly excluded
- **Constraints**: technical, organizational, or policy constraints that bound the solution
- **Assumptions**: inferences you made that are not yet confirmed; label each with `[ASSUMPTION]`
- **Open questions**: genuine gaps that cannot be resolved from context; format as checkboxes
- **Acceptance criteria**: measurable conditions for completion; format as checkboxes

### Step 4: Evaluate completeness

Check whether the structured requirements are clear enough for a downstream skill to act on. If yes, proceed to Step 6.

If not, identify the minimum set of questions needed to fill the critical gaps.

### Step 5: Ask the user

Present the current draft to the user along with targeted questions.

Do not present an empty template. Show what you have already filled in so the user can confirm or correct.

After the user responds, update the document and re-evaluate completeness. Repeat this step until the requirements are clear enough to hand off.

### Step 6: Write the requirements file

Write the final document to the output file. Confirm the file path to the user.

### Step 7: Recommend handoff

State which downstream skill should handle the request next and why. Include the file path of the requirements document so the downstream invocation can reference it.

## Handoff rules

- If the requirements are now concrete enough for implementation, recommend `implementation` with the requirements file path.
- If the requirements reveal a need for external research before proceeding, recommend `public-research` for the research portion first.
- If the requirements reveal a structural problem in existing code, recommend `refactoring` as a prerequisite.
- If the requirements reveal behavior, state, or facts to investigate, recommend `investigation` first.

## Quick checklist

Before finishing, verify all of the following:

- the requirements document contains all six sections
- assumptions are explicitly labeled
- open questions are formatted as checkboxes
- acceptance criteria are measurable
- no question was asked that could have been answered from repository context
- the document was written to an external file
- the file path was communicated to the user
- a handoff recommendation was given
