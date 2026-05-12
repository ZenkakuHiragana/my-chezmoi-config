---
name: refactoring
description: Use this skill for behavior-preserving structural cleanup of existing code. Do not use for feature work, bug fixes, or external research. Expected result: clearer structure, names, and boundaries, with explicit validation for any intentional contract change.
---

# Refactoring

## Purpose

This skill guides behavior-preserving cleanup of existing code. Use it to improve structure, names, boundaries, and maintainability after first understanding the current design.

## When to use

- the codebase structure is hard to follow
- files or modules should be split, merged, or relocated
- names should better reflect responsibility
- duplicated logic should be consolidated
- dependency direction or ownership boundaries need tightening
- tests, docs, or comments need to be aligned with the refactor

## When not to use

- the main task is feature delivery or defect repair
- the task only needs a local edit without structural impact
- the request depends on external research rather than repository analysis

## Refactoring evaluation criteria

Assess the change against:

- behavior preservation
- public API and contract stability
- cohesion and coupling
- responsibility clarity
- naming precision
- duplication reduction
- complexity and readability
- dependency direction
- testability and change locality
- removal of dead, stale, or parallel paths

## Quality gates

A refactor is ready only when:

- intended behavior is unchanged, or every intentional change is isolated and explained
- every non-trivial diff hunk is accounted for as one of: rename, move, extraction, deletion of dead code, unchanged logic carried forward, or an explicitly intended behavior change
- any newly introduced helper, API, library function, language idiom, or abstraction has its exact semantics confirmed from local usage, existing tests/docs, or an authoritative source before it replaces existing logic
- touched public interfaces, schemas, configs, and entry points still line up
- weak or missing coverage is backed by characterization tests or another repeatable before/after check
- stale references to renamed or moved items are removed
- targeted tests for affected paths pass
- available static checks or linters for touched code pass
- the final diff and validation checks can account for each behavior-affecting change, and any intentional behavior change is isolated and explained

## Procedure

1. Map the current structure, call paths, and invariants.
2. Make a semantic inventory for the planned diff: what will be renamed, moved, extracted, deleted, or intentionally changed.
3. Identify the smallest coherent refactor that improves the design.
4. Prefer deletion, consolidation, and extraction over new abstractions.
5. Do not substitute existing logic with a new helper, API, library function, language idiom, or abstraction merely because it looks shorter or cleaner. If such a substitution is necessary, record the semantics evidence first; otherwise carry the existing expression forward.
6. Edit code, tests, docs, and prompts together when needed.
7. Re-read changed surfaces for stale names, duplicate paths, contradictions, and unaccounted semantic substitutions.
8. Validate with the most direct checks available, and include at least one before/after or characterization check when behavior preservation is not obvious from inspection.
9. If a behavior change is unavoidable, isolate it and treat it as a separate verified step.
