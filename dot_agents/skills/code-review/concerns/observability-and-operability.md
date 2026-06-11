# Observability and Operability Review

Use this concern when the change affects production operation, supportability, troubleshooting, or user-visible failure modes.

## Triggers

- new background jobs, daemons, services, queues, migrations, or scheduled tasks
- changes to startup, shutdown, retries, timeouts, or configuration
- new external services, files, caches, or generated artifacts
- errors that users or operators must diagnose
- behavior that can fail partially or recover later
- changes that affect latency, traffic, error rate, saturation, SLI/SLO, alerting, dashboards, or runbooks
- rollouts, canaries, background migrations, backfills, queues, retries, or external dependency changes

## Questions

- Are errors reported with enough context to debug without leaking secrets?
- Are logs actionable, appropriately leveled, and not too noisy?
- Are metrics, traces, or counters needed for a new operational path?
- Can operators tell whether a migration, backfill, or background process succeeded?
- Is rollback or recovery behavior documented where users/operators need it?
- Are config defaults safe and understandable?
- Which user-visible signal changes: latency, traffic, errors, saturation, or another SLI?
- Can logs, metrics, and traces be correlated without leaking secrets or high-cardinality user data?
- Are alerts urgent, actionable, user-impacting, and understandable, rather than pages for symptoms with no response?
- For canaries or staged rollout, can control and canary behavior be compared with clear success and stop criteria?

## Avoid overcorrection

Do not request logging, metrics, or docs for every internal detail. Operational visibility should serve a concrete reader and failure mode.
