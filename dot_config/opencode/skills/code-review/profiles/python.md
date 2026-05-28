# Python Review Profile

Use this profile to add high-risk Python semantic checks to the core concerns for Python source, tests, and Python API documentation. It is not a complete Python style guide.

## Common checks

- Prefer existing pytest, tox, nox, ruff, mypy, pyright, and coverage commands when configured.
- Inspect supported Python versions, dependency versions, public API compatibility, and warning/deprecation policy when relevant.

## High-risk Python semantic triggers

- regex validators where `$` is used as an absolute end check; in Python, `$` can match before a final newline, so `\Z`, `fullmatch`, or explicit length checks may be required
- cache-key, dispatch, or deduplication logic that changes between identity, equality, hashing, ordering, or string coercion
- equality or truthiness on user-provided values; `__eq__` may raise, return non-bool results such as array-like masks, or be expensive for large objects
- removed or rewritten comments that documented Python semantic hazards, especially correctness/performance trade-offs in repeated cache, fixture, dispatch, or validation paths
- exception, error-handler, middleware, context manager, generator, fixture, teardown, cleanup, or finalization paths that must run on both handled and unhandled failures
- framework lifecycle hooks such as `finally`, `__exit__`, async cleanup, teardown handlers, `after_*` hooks, session persistence, signals, metrics, and response finalization
- docs or changelog text that names Python attributes, exception types, decorators, context managers, fixtures, warning classes, or public import paths changed by the diff

## Python review checks

- For regex validation changes, check absolute start/end semantics, `re.MULTILINE`, trailing-newline behavior, byte/string parity, empty input behavior, and boundary tests for rejected characters.
- For equality/cache changes, separately review correctness, exception safety, and cost. Check equal-but-not-identical values, identical-but-non-equal fallbacks, array-like comparisons, custom `__eq__`, and large parameter values.
- If prior code or comments named an expensive equality, hashing, conversion, or allocation concern, either report the cost as a separate finding or explicitly state why the repeated path, input scale, or compatibility contract makes it non-material.
- For exception or handler changes, enumerate the success path, handled-error path, unhandled-error path, default/no-handler path, and nested-error path. Confirm each required path still reaches finalization or deliberately skips it.
- For framework or test-runner lifecycle changes, verify that teardown, finalizers, session writes, signals, hooks, context resets, and resource cleanup still run when user callbacks raise.
- For public docs, compare every mentioned attribute, exception class, decorator, fixture name, import path, config key, and warning type against the implementation.

## Prefer

- targeted regression tests that fail on the old behavior and cover the risky Python semantic edge case
- small local guards around Python semantic hazards instead of broad cache, regex, or framework rewrites
- explicit uncertainty when the excerpt omits surrounding lifecycle, callback, or equality semantics
