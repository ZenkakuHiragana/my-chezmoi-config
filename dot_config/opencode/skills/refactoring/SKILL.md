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
- touched public interfaces, schemas, configs, and entry points still line up
- weak or missing coverage is backed by characterization tests or another repeatable before/after check
- stale references to renamed or moved items are removed
- targeted tests for affected paths pass
- available static checks or linters for touched code pass
- the final diff shows no accidental broad logic change

## Procedure

1. Map the current structure, call paths, and invariants.
2. Identify the smallest coherent refactor that improves the design.
3. Prefer deletion, consolidation, and extraction over new abstractions.
4. Edit code, tests, docs, and prompts together when needed.
5. Re-read changed surfaces for stale names, duplicate paths, or contradictions.
6. Validate with the most direct checks available.
7. If a behavior change is unavoidable, isolate it and treat it as a separate verified step.
