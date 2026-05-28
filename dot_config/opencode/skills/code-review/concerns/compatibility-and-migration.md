# Compatibility and Migration Review

Use this concern when the change touches externally visible or persisted contracts.

## Contracts to inspect

- database schema and migration files
- save data and persisted game state
- serialized file formats and cache formats
- config file formats
- CLI options, stdout/stderr behavior, and exit codes
- public APIs, plugin APIs, extension points, and network protocols
- message/event schemas
- generated artifacts consumed by other tools
- observable contracts such as metric names, log formats consumed by tools, dashboards, and alert labels

## Questions

- Is old data, old config, or an old API already in the wild?
- Is this released/shared software, or private/unreleased code?
- Is backward compatibility explicitly required, or is a breaking change acceptable?
- What exact public or persisted contract is affected? Do not infer compatibility risk without a contract, user, or stored data.
- If semantic versioning or a similar policy is used, does the version impact match the public API change?
- Is there a migration path, and is it one-way or reversible?
- Are old fixtures or sample files tested?
- Are corrupt, partial, or unknown-version inputs handled intentionally?
- Is rollback possible when deployment fails?
- Do version numbers, schema versions, changelogs, or release notes need updates?
- Can old and new application versions safely run together during rolling deployment?

## Database-specific checks

- migration and rollback presence when required
- data backfill and default values for existing rows
- deploy order across old and new application versions
- index, constraint, and lock cost for expected table size
- staging execution with production-like data volume when risk warrants it
- forward-only or irreversible migration explicitly documented with recovery plan

## Save-data-specific checks

- save version fields and compatibility policy
- deterministic migration with old-save fixtures
- partial migration failure and corruption risk
- mod/plugin-created data handling when relevant

## Important constraint

Do not request compatibility machinery by default.

If there is no released contract, no persisted user data, and no explicit compatibility requirement, prefer a simple intentional breaking change over speculative fallback paths.
