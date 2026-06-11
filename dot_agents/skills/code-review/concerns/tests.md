# Test Coverage Review

Check whether the change is protected by tests appropriate to its risk and contract.

## Cases to look for

- normal path
- boundary values
- equivalence classes and representative inputs
- decision-table combinations when behavior depends on several conditions
- state transitions when state or workflow changes
- empty, missing, null/nil, or default input
- large input when scale matters
- invalid or malformed input
- error handling and partial failure
- concurrency, ordering, cancellation, or timeout behavior when relevant
- resource cleanup
- backward compatibility only when a compatibility contract exists
- migration behavior for persisted data
- regression test for the fixed bug or changed contract
- performance-sensitive behavior when a performance cliff is plausible
- dispatch, routing, command-construction, reset/retry, or lifecycle paths changed by the diff
- reference-definition checks when a dynamic language, shell script, plugin system, generated file, or runtime registry would not catch missing symbols at compile time
- static analysis, compiler/analyzer warnings, lint, type checks, or fuzz/property tests when the change risk justifies them

## Questions

- What behavior would break if this change regressed?
- Which caller or user-visible contract needs protection?
- Are important edge cases absent because tests only cover the happy path?
- Are project test conventions and CONTRIBUTING requirements followed?
- Which focused existing tests would prove that a changed dispatch or command path still returns exactly the expected value?
- Would a broken implementation actually fail these tests?
- Is the test level appropriate: unit for local logic, integration for component contracts, end-to-end for critical user workflows?

## Avoid overcorrection

Do not demand broad test suites for trivial mechanical changes. Match test depth to risk, public contract, and failure cost.
