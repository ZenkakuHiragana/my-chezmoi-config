# Correctness Review

Review whether the implementation satisfies the stated or implied contract.

## Triggers

- Code behavior diverges from PR text, comments, issue requirements, tests, or docs.
- New branches do not preserve existing edge-case behavior.
- Error handling changes success/failure semantics.
- State transitions, ordering, retries, or cleanup depend on unstated assumptions.
- Boundary cases are not visible in code or tests.
- Defaults, units, encodings, time zones, locale, precision, or rounding are implicit.
- New or renamed functions, commands, hooks, handlers, generated files, config keys, or fixtures are referenced but not defined, imported, registered, generated, or exercised.
- A call target has a nearby similarly named symbol, suggesting a stale rename or copy/paste mistake.
- Overload, timeout, retry, cancellation, or partial failure can leave state corrupted, work duplicated, or errors hidden.
- Retry logic lacks retriable/non-retriable classification, deadlines, backoff, jitter, or a retry budget.

## Questions

- What behavior is promised to callers or users?
- Which inputs are valid, empty, large, malformed, missing, duplicated, or out of order?
- What happens on partial failure?
- Does the code fail loudly when recovery semantics are unclear?
- Are comments and tests describing the same behavior the code implements?
- Can every new reference introduced by the diff be resolved from the changed file, imports, generated outputs, or surrounding project conventions?
- Would a missing reference fail at compile time, test time, startup, or only in a rare runtime path?
- Did you sweep all high-risk new references, or only stop after the first suspicious unresolved symbol?
- In a partial excerpt, is the risk a definite mismatch against a nearby definition, or an uncertain external dependency that should be reported with lower confidence?
- What should happen under overload, dependency failure, timeout, cancellation, and partial completion?
- Can failed or repeated operations safely run twice, roll back, or resume?

## Prefer

- explicit preconditions and postconditions when they matter
- clear error propagation with context
- fail-fast or degraded behavior when recovery semantics are defined
- tests that demonstrate the intended externally observable behavior
- narrow fixes over broad rewrites
