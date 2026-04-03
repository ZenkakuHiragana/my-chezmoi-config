---
name: task-planning
description: Use this skill when requirements are clear but the work still needs structured decomposition into ordered investigation, implementation, research, or verification steps. Use it before downstream execution when dependencies, sequencing, or checkpoints matter. Do not use for trivial tasks, unresolved requirements, or tasks already fully structured by a command workflow. Expected result: a written execution plan with ordered work items, dependencies, deliverables, and verification checkpoints.
---

# Task Planning

## Purpose

This skill decomposes a well-defined task or requirement into an ordered, dependency-aware execution plan. Use it for larger tasks where jumping directly into downstream execution risks missing dependencies, ordering mistakes, or verification gaps.

The goal is to produce a written, reviewable plan that makes the work sequence explicit before execution begins.

## When to use

Use this skill when the task meets any of these conditions:

- the task spans multiple files, modules, or systems
- the task has multiple phases (investigate, then implement, then verify)
- the order of operations matters and wrong ordering could cause wasted work or regressions
- some work items depend on research or decisions that must happen first
- the task is large enough that tracking progress without a plan would be error-prone

## When not to use

Do not use this skill when:

- the task is trivial or can be completed in a single focused edit
- the requirements are still ambiguous or under-specified; use `requirements-clarification` first
- the task is purely investigative with no implementation intent; use `investigation` or `public-research`
- the task is already structured by a command workflow (e.g. `/add-prompt-capability`)

## Expected inputs

- a clear task description or requirement (from the user directly, or from a `requirements-clarification` output)
- repository context discoverable from the codebase
- any explicit constraints, preferences, or prior decisions the user has stated

## Expected outputs

- a written execution plan document saved to an external file
- a handoff recommendation naming the appropriate downstream skill and the plan file path

## Core rules

### 1. Do not start implementation

This skill produces a plan only. Do not edit code, create implementation files, or make design decisions that belong to implementation.

### 2. Base the plan on repository evidence

Read the actual codebase to understand the current structure, call paths, and conventions. Do not invent file names, module boundaries, or dependency relationships from assumptions.

### 3. Make dependencies explicit

Every work item must state what it depends on. If two items are independent, say so explicitly rather than leaving the relationship implicit.

### 4. Classify each work item by phase

Assign each work item one of these phases:

- **investigate**: research, explore, or gather information needed before acting
- **implement**: make concrete changes to files, configuration, or structure
- **verify**: run checks, tests, or inspections to confirm correctness

A single work item can span multiple phases if the scope is small enough that splitting it would be artificial, but state which phases it covers.

### 5. Define concrete verification checkpoints

After each logical group of implementation items, define what must be true before proceeding. Avoid vague checkpoints like "make sure it works." Prefer specific checks such as "type checker passes on affected module" or "test suite for package X passes."

### 6. Keep the plan actionable

Each work item should be small enough that a downstream skill can execute it in one focused pass. If an item is too large, split it.

### 7. Write the plan to an external file

The plan must be written to a file so that downstream skills can reference it. The default location is `docs/plans/<slug>.md` where `<slug>` is a short kebab-case identifier derived from the task title.

If the `docs/plans/` directory does not exist, create it.

## Plan document template

Use this structure for the output file:

```markdown
# Task Plan: <title>

## Context

<One or two sentences summarizing the task and its origin. Reference the requirements file if one exists.>

## Work items

### W-1: <short imperative title>

- **Phase**: investigate | implement | verify
- **Dependencies**: none | W-x
- **Description**: <what to do, concretely>
- **Research needed**: none | <what external or local information must be gathered first>
- **Deliverables**: <files or artifacts this item produces>
- **Verification**: <how to confirm this item is done correctly>

### W-2: ...

## Execution order

<Numbered list reflecting dependency-respecting topological order.
State parallel opportunities where items are independent.>

1. W-1
2. W-2, W-3 (parallel)
4. W-4

## Verification checkpoints

- **After W-x**: <what must be true before starting the next group>
- **Final checkpoint**: <what must be true before declaring the overall task done>

## Open risks

- <risk or unknown that could affect the plan>
- None identified.
```

Fill in each section based on what is known. If a section has no content after analysis, write `None identified.` rather than leaving it blank.

## Procedure

### Step 1: Restate the task

State the task in your own words internally. Confirm that the requirements are clear enough to plan around. If they are not, stop and recommend `requirements-clarification` instead.

### Step 2: Survey the repository

Read the relevant code, configuration, tests, and documentation to understand:

- the current structure and conventions
- the files and modules likely affected by the task
- existing tests and verification mechanisms
- patterns and constraints the plan must respect

Do not skip this step even if you think you already know the codebase. The plan must be grounded in current reality.

### Step 3: Decompose into work items

Break the task into the smallest coherent units that can each be executed independently.

For each item, determine:

- what phase it belongs to
- what it depends on
- what it produces
- how to verify it

### Step 4: Analyze dependencies

Map the dependency graph across work items. Identify:

- strict ordering requirements (A must finish before B can start)
- items that can run in parallel
- items that gate later phases (e.g. research must complete before implementation begins)

### Step 5: Define verification checkpoints

Place checkpoints at natural phase boundaries:

- after investigation items, before implementation begins
- between implementation groups when later groups depend on earlier ones
- at the end, before the task is declared done

### Step 6: Write the plan document

Fill in the plan template using the information gathered.

Ensure:

- every work item has all six fields filled in
- the execution order reflects the dependency graph
- verification checkpoints are concrete and checkable
- open risks are stated honestly

### Step 7: Review the plan for completeness

Before finalizing, check:

- does the plan cover everything the task requires?
- are there any implicit dependencies that were not written down?
- are verification checkpoints sufficient to catch common failure modes?
- is each work item small enough to be actionable?

### Step 8: Write the file and recommend handoff

Write the plan to the output file. Confirm the file path to the user.

Recommend the appropriate downstream skill:

- If the plan's first items are implementation, recommend `implementation` with the plan file path.
- If the plan's first items require external research, recommend `public-research` for those items first.
- If the plan reveals a structural problem that should be resolved first, recommend `refactoring`.
- If the plan reveals behavior, state, or facts that must be investigated first, recommend `investigation`.

## Quick checklist

Before finishing, verify all of the following:

- the task requirements were clear enough to plan (if not, `requirements-clarification` should have been used instead)
- the repository was actually surveyed, not assumed
- every work item has phase, dependencies, description, research needed, deliverables, and verification
- the execution order respects all stated dependencies
- verification checkpoints are concrete and specific
- open risks are listed
- the plan was written to an external file
- the file path was communicated to the user
- a handoff recommendation was given
- for non-trivial planning work, produce a `completion-review` statement before finishing
