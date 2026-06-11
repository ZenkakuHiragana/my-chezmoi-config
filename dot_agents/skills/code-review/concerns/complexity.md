# Complexity Review

Review both excessive concentration and excessive fragmentation.

Treat code as too complex when a reader cannot quickly understand the main path or when a future change is likely to introduce a bug.

## Too much in one place

- long functions that perform multiple separable jobs
- files that mix unrelated responsibilities
- deeply nested branches or loops
- repeated condition blocks that form a hidden state machine
- duplicated logic caused by missing ownership or missing helper discovery
- complex boolean expressions without named concepts
- test code with complex control flow, generated expectations, or broad fixtures that hide the behavior under test

## Too much splitting or indirection

- tiny functions that hide a simple straight-line flow
- new interfaces, factories, managers, strategies, or registries for one known case
- files split so readers must jump constantly to understand one operation
- abstractions named after implementation mechanics rather than domain meaning
- configuration-driven behavior where direct code would be clearer

## Questions

- Does each unit have one coherent reason to change?
- Is the split aligned with domain boundaries or merely with line count?
- Would another maintainer find the main path quickly?
- Does indirection reduce duplication or merely obscure control flow?
- Did the reviewer need an explanation that should instead be captured by simpler code, a better name, or a focused comment?

## Prefer

- extracting named concepts that carry real domain meaning
- keeping simple local logic local
- reducing nesting with early returns only when it improves clarity
- avoiding future-proof abstractions without a concrete second use case
- keeping tests simple enough that a failing assertion is easy to diagnose
