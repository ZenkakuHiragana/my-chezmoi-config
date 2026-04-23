---
name: task-planning
description: >
  Use this skill when a normalized requirements artifact or other clear task contract already makes the requested outcome, constraints, and prerequisite facts concrete enough to write a task file, but the work still needs ordered investigation, implementation, research, or verification steps, or when long conversation-only instructions should be normalized into a durable artifact before downstream work. Use it before downstream execution when the task spans multiple files or phases, depends on sequencing, or needs a resume-safe plan that reduces compaction or omission risk. Do not use it when required requirement attributes are still unresolved; resolve those first with `requirements-clarification`, `investigation`, or `public-research`. Expected result: One task file under `.opencode/work/` with the outcome, constraints, relevant surfaces, ordered work items, and completion checks.
---

# Task Planning

## Purpose

This skill prepares a written task file for multi-step work.

It can either create an execution plan from clear requirements or normalize an important conversation-only procedure into a durable task artifact.

Use it when jumping directly into downstream execution would risk missing dependencies,
required research, execution order, or completion checks.

Also use it when the user already provided a long or multi-part procedure, but reliable execution would still depend on preserving that procedure, its dependencies, or its checks outside transient chat state.

Use it after `requirements-clarification` or another existing artifact has already made the requested outcome, constraints, invariants, acceptance criteria, verification method, and prerequisite facts concrete enough to fill the task file.

This skill does not implement the task.
It defines the task in a form that downstream execution can follow reliably.

## When to use

Use this skill when one or more of the following are true:

- the task spans multiple files, modules, systems, or documents
- the task has multiple phases such as investigation, implementation, and verification
- the order of operations matters
- local investigation, external research, or experiments must happen before implementation
- the task needs a written artifact because it spans multiple files or phases, or because a downstream agent may need to resume without chat history
- the user already provided a long or multi-part procedure, but important instructions, constraints, dependencies, or checks still exist only in conversation and should be normalized into a durable task file before downstream execution
- reliable execution would otherwise depend on preserving conversation-only details across a long session, resume, or compaction boundary
- the task needs explicit completion checks before execution begins

## When not to use

Do not use this skill when:

- the task is short enough that all required steps, constraints, and checks can be executed reliably in one focused pass without creating a durable task artifact
- required requirement attributes are still unresolved; use `requirements-clarification`, `investigation`, or `public-research` first
- the first meaningful work item would mostly be to discover missing facts or criteria before the requirement record is complete; use `requirements-clarification`, `investigation`, or `public-research` first
- the task is purely investigative with no implementation intent; use `investigation` or `public-research`
- the task is already fully structured by a command workflow

## Expected inputs

- a clear task description or requirement
- a normalized requirements artifact when the task is implementation-shaped
- repository context discoverable from the codebase, when the task is repository-local
- any explicit user constraints, preferences, or prior decisions already stated

## Expected outputs

When this skill is used:

- a single task file at `.opencode/work/<slug>.md`
- `.opencode/work/current-task.md` containing the slug only
- a recommendation for the next appropriate downstream skill

Before reading `.opencode/work/current-task.md`, decide from the current conversation alone whether the user is continuing a prior task and whether a missing task identifier blocks interpretation.
If the request is already clear without it, ignore the file.
If the conversation shows a continuation request but the task identifier is still missing, the file may be consulted only to recover that identifier, not to redefine the request.

## Core rules

### 1. Produce a task file only

This skill produces a task file only.

When the user already supplied an execution procedure in conversation, convert that procedure into the task file instead of relying on chat history as the durable source of truth.

Do not start implementation, edit code, create implementation artifacts, or make
execution-time decisions that belong to downstream work.

### 2. Base the task file on evidence

Read the actual repository when the task is repository-local.

When a normalized requirements artifact exists, use it as the primary source only when it is explicitly tied to the current task by the user, by `.opencode/work/current-task.md`, or by a matching `task_slug`, and the artifact passes these binding rules: candidate primary source first, then primary only when `status` is not `superseded`, `base_commit` is valid for the current repository state, and `superseded_by` is `none` or absent. Otherwise treat it as reference material only.

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

### 9. Preserve resume-critical context

The task file must contain enough information for a downstream agent to resume after compaction without reconstructing the work from chat history alone.

Do not assume that a detailed user-authored procedure can remain chat-only just because it already specifies order or dependencies.
If later execution still depends on that procedure, normalize it into the task file.

At minimum, capture:

- concrete input artifacts
- conversation-provided instructions, constraints, checks, and dependency notes that execution would otherwise need to remember
- requirement-record obligations such as invariants, acceptance criteria, verification method, and affected tests or docs
- relevant surfaces to change or inspect
- the chosen approach
- blocking unknowns that gate execution
- evidence-oriented verification expectations

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

## Inputs

- <requirements file, research note, issue, or explicit user decision this plan depends on>
- None identified.

## Relevant surfaces

- <files, directories, commands, outputs, or artifacts to change or inspect>
- None identified.

## Binding metadata

- task_slug: <slug>
- source request summary: <brief summary>
- target repository or path: <repo or path>
- base_commit: <commit hash or `unknown`>
- status: draft | active | superseded | done
- superseded_by: <slug or `none`>

## Binding rules

- Binding rules:
  - A requirements artifact is a candidate primary source only when one of these holds:
    - the user explicitly names the artifact
    - `.opencode/work/current-task.md` points to it
    - `task_slug` matches the current task
  - A candidate primary source becomes primary only when `status` is not `superseded`,
    `base_commit` is valid for the current repository state, and `superseded_by` is `none`
    or absent.
  - If `status` is `superseded` or `base_commit` is unknown or stale, do not use the file as
    primary source.
  - If `superseded_by` is present, inspect that artifact next as the preferred candidate
    source.
  - If none of the explicit binding conditions hold, treat the file as reference material
    only.

## Chosen approach

- <brief explanation of the intended execution shape>
- None identified.

## Facts to gather

- <task-level facts that must be confirmed before acting>
- None identified.

## Blocking unknowns

- <unknown that must be resolved before a dependent work item can proceed>
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

When upstream conversation contains long procedural guidance, capture the durable substance of that guidance in the task file instead of referring vaguely to “the steps above” or “the user plan.”

## Procedure

### Step 1: Confirm that the task file can be filled from known requirements and facts

Restate the task internally.

If the requested outcome, constraints, prerequisite facts, acceptance criteria, or blocking unknowns still cannot be filled without guessing, stop and recommend `requirements-clarification` or the appropriate prerequisite skill instead.

### Step 2: Survey the relevant context

For repository-local work, read the relevant code, configuration, tests, and documentation.

For externally grounded work, identify what facts must be gathered before execution.

Do not skip this step.

### Step 3: Write requested outcome, constraints, and inputs

Record what must be achieved, what must remain true, and which concrete upstream artifacts or user decisions this plan depends on.

If a normalized requirements artifact exists, carry forward its invariants, acceptance criteria, verification method, and affected tests or docs rather than re-inventing them.

If the user already gave an ordered procedure, capture the durable instructions, constraints, and checks from that procedure in these sections and in later work items.

Do not expand the task beyond what the user asked for.

### Step 4: Identify relevant surfaces and chosen approach

List the concrete surfaces that may need to change or be checked.

Also record the chosen approach in a short form so downstream execution can resume without rediscovering the high-level shape of the task.

### Step 5: Identify facts to gather and blocking unknowns

List the task-level facts that must be confirmed before implementation or final judgment.

These are cross-cutting facts for the whole task, not per-item details.

Separate unknowns that merely need investigation from unknowns that block execution order or make later work items unreliable until they are resolved.

### Step 6: Build concrete work items

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

If the procedure already exists in conversation, translate it into concrete work items rather than merely pointing downstream execution back to chat history.

### Step 7: Define checks before completion

List the cross-item checks needed before the whole task can be treated as done.

These should cover overall requested outcome, not just individual items.

### Step 8: Write the files

Write the task file to `.opencode/work/<slug>.md`.

Write the slug only to `.opencode/work/current-task.md`.

### Step 9: Recommend the next skill

Recommend the next downstream skill based on the first real execution need:

- use `implementation` when the requested repository changes, target surfaces, and required checks are already concrete enough to execute
- use `investigation` when repository-local facts still need to be gathered first
- use `public-research` when external facts must be verified first
- use `refactoring` when the next step is behavior-preserving structural cleanup

## Quick checklist

Before finishing, verify all of the following:

- the task file could be filled without inventing missing requirements or prerequisite facts
- requirement-record obligations were preserved when such an artifact existed
- the repository or other relevant context was actually inspected when needed
- the task file contains requested outcome, constraints, inputs, relevant surfaces, chosen approach, facts to gather, blocking unknowns, work items, and checks before completion
- any long or dependency-rich conversation-only procedure needed for execution was normalized into the task file
- each work item is concrete
- dependencies are explicit where needed
- research needs are stated where needed
- verification is defined for each work item
- completion checks are specific
- the file was written to `.opencode/work/<slug>.md`
- `.opencode/work/current-task.md` contains only the slug
- a next-skill recommendation was given
