# Test Quality Review

Do not accept tests merely because they exist. Review whether they prove meaningful behavior.

## Triggers

- tests assert interactions with mocks but not observable outcomes
- tests have no meaningful assertion, only check that code ran, or assert broad truthy/falsey values
- mocks/fakes are less faithful than the real dependency in the behavior being tested
- tests duplicate implementation logic instead of checking results
- names are too vague to explain the behavior under test
- fixtures are overly broad, magical, or unrelated to the assertion
- test data hides important cases in unreadable blobs
- tests depend on timing, order, environment, network, locale, or shared state without control
- snapshots are too broad and make intentional changes hard to review
- a test would pass even if the bug or contract violation returned
- test code contains multiple Acts, conditional logic, generated expected values, sleeps, shared global state, or order dependence
- skipped/ignored tests, catch-all exception handling, or swallowed failures make the test suite look greener than it is

## Questions

- What exact behavior would make this test fail?
- Is the assertion tied to a user/caller-visible result?
- Are mocks necessary, or are they hiding integration risk?
- Would a reader understand the case from the test name and data?
- Should test cases and test data be separated for readability?
- Is the test arranged, acted, and asserted clearly enough to diagnose a failure?
- Is it testing public behavior rather than private implementation details unless the detail is the contract?

## Prefer

- precise names describing the scenario and expected behavior
- small fixtures that expose the relevant distinction
- deterministic tests
- tests that fail for the regression they claim to protect
- simple assertions over complex expected-value generators
- real collaborators when they are fast and deterministic; mocks mainly for slow, remote, nondeterministic, or failure-injection boundaries
