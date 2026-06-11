# C# + .NET Review Profile

Use this profile in addition to core concerns for C# and .NET projects.

## Common checks

- Prefer existing solution, project, test, format, and analyzer commands when configured.
- Inspect `.csproj`, `.sln`, analyzer settings, nullable settings, generated docs, and CI when touched.

## C#-specific triggers

- `ToList`, `ToArray`, `Select(...).ToList`, boxing, LINQ chains, or string allocation inside repeated paths
- repeated reflection, regex construction, serialization, or service lookup
- type names, enum-like states, commands, or property names compared as strings
- missing nullable handling or null-forgiving operators hiding uncertainty
- `async void`, fire-and-forget tasks, missing cancellation tokens, or blocking on async work
- `IDisposable`/`IAsyncDisposable` ownership and cleanup issues
- exceptions swallowed by broad `catch` or speculative fallbacks
- XML documentation missing or stale for public APIs when generated docs matter

## Prefer

- pattern matching, enums, `nameof`, polymorphism, or typed registries for closed domains
- moving invariant materialization outside loops
- clear ownership for disposable resources
- analyzer warnings treated as review evidence when relevant
