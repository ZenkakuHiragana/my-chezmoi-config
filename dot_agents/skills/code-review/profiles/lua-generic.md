# Lua Review Profile

Use this profile in addition to core concerns for Lua projects.

## Common checks

- Prefer existing luacheck, formatter, and test commands when configured.
- Inspect module boundaries, globals policy, plugin/config conventions, and test fixtures when touched.

## Lua-specific triggers

- accidental globals or implicit shared state
- `nil` handling and truthiness surprises
- tables used ambiguously as arrays and maps
- repeated table construction, deep copy, or string concatenation in hot paths
- mutation of shared tables or module-level state across calls/tests
- metatable behavior that is hard to discover
- stringly-typed commands, event names, plugin names, or config keys without centralization
- weak assertions around plugin/config behavior

## Prefer

- local variables and explicit module exports
- constant tables or registries for known string domains
- small table shapes with clear ownership
- tests that cover nil, missing keys, and repeated invocation
