---
name: implementation
description: Use this skill when the requested repository change is already clear and the task is to make or update files to satisfy it, including feature work, known bug fixes, and coherent code, documentation, configuration, prompt, or script changes. Do not use when the main task is to investigate observed behavior, gather diagnostic evidence, or decide whether any real change is needed.
---

# Implementation

## Purpose

This skill is for tasks that require changing repository contents and bringing the work to a complete, internally consistent state.

Use this skill to improve self-propelled execution quality for implementation work. The goal is not only to edit files, but to finish the requested change with the necessary surrounding updates and basic validation.

## When to use

Use this skill when the user asks for any of the following:

- implement a feature
- apply a known bug fix or behavior change whose intended edit is already clear
- modify existing behavior
- update documentation, configuration, prompts, or scripts as part of a concrete repository change
- make repository changes and verify that they are coherent

## When not to use

Do not use this skill when the task is primarily:

- answering factual questions without changing files
- open-ended external research
- broad requirements exploration with no concrete change target
- local investigation only, where the deliverable is analysis rather than edits
- investigating unclear behavior, confirming observed facts, or gathering diagnostic evidence before deciding on a real change; use `investigation` instead

If the task is mainly external fact-finding, use `public-research` instead.

## Expected inputs

You should already have, or first derive, the following:

- the concrete user request
- the relevant files or directories
- the expected outcome
- any explicit constraints given by the user

If these are not fully explicit but can be discovered from the repository, prefer reading the repository over asking unnecessary questions.

## Expected outputs

A completed repository change, together with concise evidence that the change was checked.

At minimum, provide:

- what was changed
- what was checked
- any remaining limitation only if it could not reasonably be resolved during this run

## Core working rules

### 1. Complete the requested change, not only the first local edit

Do not stop after making one plausible edit if the request implies additional required changes elsewhere.

If a command-line interface, configuration key, prompt contract, public function, user-facing behavior, or documented workflow changed, inspect likely dependent surfaces and update them as needed.

Typical dependent surfaces include:

- help text
- README or usage docs
- tests
- configuration examples
- related type definitions
- validator logic
- prompt contracts
- state files or schemas
- callers and integration points

### 2. Prefer repository discovery over avoidable questions

If the missing information is discoverable from code, docs, tests, configuration, logs, or existing patterns, investigate first.

For repository-local work, read the relevant files before answering or editing, and keep `read` / `glob` / `grep` searches scoped to the current repository or explicitly named paths.

Ask only when the missing information is a true user preference, a policy choice, or a trade-off that cannot be resolved from repository context.

### 3. Classify the change before editing

Before editing, classify the task internally as one of:

- new_feature
- modify_existing
- bugfix

This classification affects what to inspect.

#### new_feature

Give extra attention to:

- new entry points
- wiring and registration
- documentation for new behavior
- configuration exposure
- missing tests for the added path

#### modify_existing

Give extra attention to:

- current behavior and intended contract
- affected callers
- compatibility with surrounding logic
- regression risks
- stale documentation or examples

#### bugfix

Give extra attention to:

- confirming the affected path, inputs, or configuration that the known fix must address
- verifying that the intended change actually addresses the observed failure
- preventing nearby regressions
- preserving intended behavior outside the fix

### 4. Read before you write

Before editing, inspect enough of the relevant context to avoid shallow or contradictory changes.

At minimum, read:

- the target file
- nearby callers or consumers
- relevant type or schema definitions
- tests or docs that define expected behavior when they exist

### 5. Prefer replacing outdated truth over layering history into normative files

When editing normative artifacts such as code comments, prompts, specifications, instructions, or user documentation:

- write the current intended behavior
- prefer replacing obsolete wording over appending patches around it
- do not preserve old behavior descriptions unless the file is explicitly historical
- keep change history in changelogs, commits, migration notes, or separate historical documents

Do not create documents that read as half-old and half-new.

### 6. Do not add unnecessary compatibility work

Do not invent migration layers, fallback behavior, compatibility shims, comments about former behavior, or extra abstractions unless they are required by the request or by an existing supported contract.

### 7. Avoid fake completion

Do not declare success merely because a local edit was made.

The task is complete only when the requested outcome and its obvious supporting updates are done, or when a real blocker prevents completion.

A blocker must be concrete, such as:

- required files or information are absent
- a tool or command is unavailable
- tests or build steps cannot be run in this environment
- the request requires a policy choice the repository cannot answer

### 8. Use a failure ladder instead of repeating the same attempt

When an approach fails:

#### first failure

Try a different plausible approach after inspecting more evidence.

#### second failure

Re-check assumptions, affected files, and whether the problem was misclassified.

#### third failure

Stop repeating the same pattern. Report the blocker, what was tried, what evidence was checked, and what remains unresolved.

Do not loop on nearly identical edits or commands.

## Implementation flow

Follow this order unless there is a clear reason not to.

### Step 1: Understand the target

State internally:

- what the user wants changed
- what counts as completion
- which change class applies

### Step 2: Survey the affected area

Read the target file and nearby related files.

For `modify_existing` and `bugfix`, pay extra attention to:

- existing behavior
- call sites
- state transitions
- existing tests
- docs that encode the contract

### Step 3: Make the change

Edit the minimum set of files needed for a coherent result, but do not artificially limit yourself if surrounding updates are required.

### Step 4: Re-read changed surfaces

After editing, re-read the changed files and nearby dependent surfaces to catch contradictions, stale wording, and missed updates.

### Step 5: Validate

Perform proportionate validation.

Start from the most direct checks:

- changed file re-read
- relevant diagnostics or type checks if available
- targeted tests if available
- broader checks only when justified by the affected surface

### Step 6: Final completion check

Before finishing, compare the result against:

- the original request
- the current behavior implied by the changed files
- obvious dependent surfaces

Ask:

- is the requested behavior actually implemented?
- did any contract change without related docs or help being updated?
- are there stale comments, examples, or prompts that still describe the old state?
- for modify_existing or bugfix, was regression risk checked at least locally?

## Output style

Be concise and concrete.

Prefer:

- files changed
- behavior changed
- checks performed
- remaining blocker, if any

Avoid long self-justification or process narration.

## Quick checklist

Before finishing, verify all of the following:

- the repository change matches the user request
- obvious dependent surfaces were checked
- changed files were re-read
- validation was attempted at an appropriate level
- no stale normative text remains in touched areas
- no unnecessary compatibility layer was introduced
- success is not being claimed on the basis of a partial edit
- for non-trivial tasks, produce a `completion-review` statement before finishing
