# Comments and Documentation Review

Review both missing documentation and documentation noise.

## Useful comments and docs explain

- non-obvious intent
- invariants and constraints future maintainers must preserve
- public API behavior
- migration steps and operational procedures
- generated-documentation requirements
- examples that users or contributors need
- trade-offs that cannot be expressed clearly in code, types, or tests
- security, privacy, compatibility, or operational assumptions that future maintainers must not accidentally break

## Factual alignment

Flag comments or docs when the described behavior, option, flag, API, default, file, command, or limitation does not match the current code.

This includes documentation for non-existent behavior, stale comments after a refactor, and prose that contradicts tests or implementation.

## Reader-context alignment

Flag comments or docs that may be true but do not help the intended reader because they depend on private conversation history, obsolete names, temporary implementation history, or agent self-justification.

Examples include comments that memorialize a rename, explain why a discarded feature flag does not exist, or describe an internal edit decision that is not part of the public or maintenance contract.

## Other suspicious patterns

- comments that restate obvious code line by line
- README sections for internal details not relevant to users or contributors
- comments added only to satisfy a perceived "needs comments" rule
- long prose that should be replaced by a clearer name, smaller function, type, or test
- documentation updates that hide an unnecessary design choice instead of fixing it
- examples, logs, screenshots, or snippets that contain secrets, tokens, private URLs, PII, or real credentials
- release notes that omit breaking changes, migration requirements, rollback/roll-forward notes, or operational readiness when users/operators need them

## Questions

- Who is the reader?
- What action or understanding does this text enable?
- Is the information part of a public or maintenance contract?
- Would this be better expressed by clearer code or tests?
- Will this become stale quickly?
- Is the document a tutorial, how-to, reference, or explanation, and does the content match that reader need?
- Does the doc change track build, test, release, configuration, deprecation, or migration changes introduced by the code?

## Prefer

- no comment over a misleading or performative comment
- replacing obsolete normative text instead of layering history around it
- keeping history in changelogs, migration notes, or commit messages when history matters
