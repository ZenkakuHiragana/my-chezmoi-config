---
name: task-planning
description: >
  Use this skill when requirements are clear but the work still needs structured
  decomposition into ordered investigation, implementation, research, or verification steps.
  Use it before downstream execution when dependencies, sequencing, or checkpoints matter.
  Expected result: A single written task file saved under .opencode/work/ that captures the requested outcome,
  constraints, facts to gather, ordered work items, and checks before completion.
---

# Task Planning

## Purpose

This skill prepares a written task file for non-trivial work.

Use it when jumping directly into downstream execution would risk missing dependencies,
required research, execution order, or completion checks.

This skill does not implement the task.
It defines the task in a form that downstream execution can follow reliably.

## When to use

Use this skill when one or more of the following are true:

- the task spans multiple files, modules, systems, or documents
- the task has multiple phases such as investigation, implementation, and verification
- the order of operations matters
- local investigation, external research, or experiments must happen before implementation
- the task is large enough that relying only on conversational context would be error-prone
- the task needs explicit completion checks before execution begins

## When not to use

Do not use this skill when:

- the task is trivial and can be completed in one focused pass
- the requirements are still ambiguous or under-specified; use `requirements-clarification` first
- the task is purely investigative with no implementation intent; use `investigation` or `public-research`
- the task is already fully structured by a command workflow

## Expected inputs

- a clear task description or requirement
- repository context discoverable from the codebase, when the task is repository-local
- any explicit user constraints, preferences, or prior decisions already stated

## Expected outputs

When this skill is used:

- a single task file at `.opencode/work/<slug>.md`
- `.opencode/work/current-task.md` containing the slug only
- a recommendation for the next appropriate downstream skill

## Core rules

### 1. Produce a task file only

This skill produces a task file only.

Do not start implementation, edit code, create implementation artifacts, or make
execution-time decisions that belong to downstream work.

### 2. Base the task file on evidence

Read the actual repository when the task is repository-local.

Do not invent file names, module boundaries, dependency relationships, conventions,
tests, or verification mechanisms from assumptions.

If external facts are required before execution, state that explicitly.

### 3. Keep everything in one task file

Write one task file only.

Do not split task contract content and plan content into separate files.
Do not create additional task-state files beyond `.opencode/work/current-task.md`.

### 4. Keep the current-task pointer minimal

Write only the slug to `.opencode/work/current-task.md`.

Do not write summaries, timestamps, or additional metadata there.

### 5. Make work items concrete

Each work item must be specific enough that a downstream skill can execute it
without reconstructing the whole task from scratch.

Avoid vague items such as "update code as needed" or "verify everything."

### 6. Make dependencies explicit

If a work item depends on another item, state that dependency directly.

Do not rely on implied order when the dependency affects correctness.

### 7. Define research before execution

If a work item requires local investigation, external research, or experiments before action,
state that in `Research needed`.

Do not assume that downstream execution will infer missing facts automatically.

### 8. Define verification before execution

State how each work item will be checked.

Also state the cross-item checks required before the whole task can be treated as done.

Avoid vague checks such as "make sure it works."
Prefer checks tied to files, commands, outputs, behavior, or cited sources.

## Output location

Write the task file to:

`.opencode/work/<slug>.md`

Where `<slug>` is a short kebab-case identifier derived from the task title.

If `.opencode/work/` does not exist, create it.

Also write the slug only to:

`.opencode/work/current-task.md`

## Task file template

Use this structure for the output file:

```markdown
# Task: <title>

## Requested outcome

- <what must be achieved>

## Constraints

- <what must remain true>
- None identified.

## Facts to gather

- <task-level facts that must be confirmed before acting>
- None identified.

## Work items

### W-1: <short imperative title>

- **Phase**: investigate | implement | verify
- **Dependencies**: none | W-x
- **Description**: <what to do, concretely>
- **Research needed**: none | <what external or local information must be gathered first>
- **Deliverables**: <files or artifacts this item produces>
- **Verification**: <how to confirm this item is done correctly>

### W-2: ...

## Checks before completion

- <cross-item checks needed before the task can be treated as done>
- None identified.
```

If a section has no content after analysis, write `None identified.` rather than leaving it blank.

## Procedure

### Step 1: Confirm the task is clear enough to plan

Restate the task internally.

If the task is still ambiguous, stop and recommend `requirements-clarification` instead.

### Step 2: Survey the relevant context

For repository-local work, read the relevant code, configuration, tests, and documentation.

For externally grounded work, identify what facts must be gathered before execution.

Do not skip this step.

### Step 3: Write requested outcome and constraints

Record what must be achieved and what must remain true.

Do not expand the task beyond what the user asked for.

### Step 4: Identify facts to gather

List the task-level facts that must be confirmed before implementation or final judgment.

These are cross-cutting facts for the whole task, not per-item details.

### Step 5: Build concrete work items

Decompose the task into ordered work items.

Each work item must identify:

- its phase
- its dependencies
- its concrete description
- any research needed before action
- its deliverables
- its verification method

Use as many items as needed, but keep them meaningful.
Do not split work into tiny procedural noise.

### Step 6: Define checks before completion

List the cross-item checks needed before the whole task can be treated as done.

These should cover overall requested outcome, not just individual items.

### Step 7: Write the files

Write the task file to `.opencode/work/<slug>.md`.

Write the slug only to `.opencode/work/current-task.md`.

### Step 8: Recommend the next skill

Recommend the next downstream skill based on the first real execution need:

- use `implementation` when the task is ready for repository changes
- use `investigation` when repository-local facts still need to be gathered first
- use `public-research` when external facts must be verified first
- use `refactoring` when the next step is behavior-preserving structural cleanup

## Quick checklist

Before finishing, verify all of the following:

- the task was clear enough to plan
- the repository or other relevant context was actually inspected when needed
- the task file contains requested outcome, constraints, facts to gather, work items, and checks before completion
- each work item is concrete
- dependencies are explicit where needed
- research needs are stated where needed
- verification is defined for each work item
- completion checks are specific
- the file was written to `.opencode/work/<slug>.md`
- `.opencode/work/current-task.md` contains only the slug
- a next-skill recommendation was given
