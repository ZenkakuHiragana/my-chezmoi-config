---
name: debugging
description: Use this skill when a reported bug or unexpected behavior is not yet understood and you need to reproduce it, inspect code paths, add temporary diagnostics, compare hypotheses, or check related public issues before implementing a fix. Do not use for direct fix work once the cause is clear or for general feature work. Expected result: a narrowed root-cause hypothesis, concrete evidence, and a clean handoff to implementation.
---

# Debugging

## Purpose

This skill is for investigating unclear defects and unexpected behavior before the fix is obvious.

## When to use

- the user reports wrong behavior but the cause is unclear
- you need repro steps, logs, traces, or temporary instrumentation
- you need to inspect nearby code paths, state, or branching logic
- you need to compare several candidate causes
- you need to check related public issues, release notes, or upstream reports; use `public-research` for that part when local evidence is not enough

## When not to use

- the root cause is already clear and the task is to implement the fix
- the main work is feature delivery or refactoring
- the task is repository-independent fact finding

## Investigation criteria

Assess the work against:

- reproducibility
- scope of impact
- strongest candidate cause
- whether behavior changes with input, state, or environment
- whether similar issues already exist publicly
- whether added diagnostics are temporary and targeted

## Output expectations

Return:

- a short symptom summary
- observed evidence
- likely root cause or ranked hypotheses
- remaining unknowns
- any temporary diagnostics that should be removed after the fix
- handoff notes for implementation if appropriate

## Procedure

1. Restate the symptom and expected behavior.
2. Reproduce or approximate the failure.
3. Search the codebase for the relevant path, state, and callers.
4. Add temporary diagnostics only as narrowly as needed.
5. Compare candidate causes against observed evidence.
6. Check public issue trackers or docs when local evidence does not explain the behavior.
7. Stop once the likely cause is narrow enough to hand off to implementation.
8. Remove or clearly isolate temporary diagnostics before finishing if they are no longer needed.

## Before finishing

For non-trivial investigations, produce a `completion-review` statement.
