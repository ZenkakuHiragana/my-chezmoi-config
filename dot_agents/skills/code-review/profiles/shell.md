# Shell Script Review Profile

Use this profile in addition to core concerns for shell scripts.

## Common checks

- Prefer existing shellcheck, formatter, and project test commands when configured.
- Inspect target shell, portability policy, CI OS matrix, and invocation docs when relevant.

## Shell-specific triggers

- unquoted variables, word splitting, globbing, and unsafe `eval`
- missing `--` before user-controlled paths
- unsafe temporary files or cleanup traps
- pipelines hiding failures or relying on unspecified `set -e` behavior
- new shell function calls, sourced helpers, scripts, commands, traps, or hooks that are not defined or sourced on the execution path
- similarly named shell functions where a rename may have left a stale call site
- command-builder functions that can print more than one line when callers expect one command string
- command availability assumptions without a project policy
- environment-variable fallback branches added without user requirement
- silent fallbacks that hide real errors
- parsing human-readable command output when structured output exists
- docs that describe environment variables or switches not actually supported

## Prefer

- explicit target shell and portability assumptions
- direct failure with useful errors over speculative fallback
- narrow traps and cleanup for temporary resources
- quoting and arrays where the shell supports them

## Shell review checks

- For every new function call in a changed branch, confirm the definition is in the same file, sourced file, or documented shell environment.
- Do a short definition sweep before ranking findings: list the helper calls in the changed control-flow path, then check whether each one resolves. Do not stop after the first unresolved-looking helper.
- Prioritize unresolved calls in state-changing paths such as startup, reset, clear, retry, watcher, migration, and cleanup flows.
- Treat a modified shell function as a unit. Re-check helper calls in shared tail code and existing branches that remain reachable after the changed branch returns or falls through.
- Generic helper calls in CLI-specific lifecycle code are suspicious when only a specific variant is visible. For example, a generic startup sender call near a defined CLI-specific startup sender may be a stale rename unless the generic helper is also defined or sourced.
- If the excerpt is partial, distinguish definite stale-call evidence from uncertain missing-context evidence. A call to `send_startup_prompt` next to a defined `send_codex_startup_prompt`, for example, is stronger stale-call evidence than a general helper whose definition may simply be outside the excerpt.
- For command-construction helpers, check that exactly one command string is emitted on success unless the contract explicitly allows multi-line output.
- For CLI reset, wake-up, retry, or watcher paths, name the focused tests that should cover the changed route.
