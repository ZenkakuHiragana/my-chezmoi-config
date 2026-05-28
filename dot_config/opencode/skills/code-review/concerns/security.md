# Security and Privacy Review

Use this concern when the change touches external input, trust boundaries, secrets, permissions, or execution boundaries.

## Triggers

- authentication or authorization
- input validation, parsing, deserialization, or schema handling
- filesystem paths, archives, symlinks, or generated files
- command execution, subprocesses, shell quoting, or plugin execution
- SQL/query construction, template rendering, HTML/Markdown output, or redirects
- secrets, credentials, tokens, keys, or sensitive user data
- logging, telemetry, crash reports, or debug output
- cryptography, randomness, hashing, signatures, or certificates
- network calls, CORS/origin checks, proxy behavior, or remote content
- dependency loading, sandbox boundaries, permissions, or capability checks
- new entry points, trust boundaries, privileged operations, admin functions, or cross-tenant/data-isolation behavior
- security-relevant logs, audit events, telemetry, examples, docs, or error messages

## Questions

- What input is attacker-controlled or untrusted?
- What authority does this code execute with?
- Could this leak secrets or private data through logs, errors, docs, or telemetry?
- Is validation centralized and consistent with existing policy?
- Does fallback behavior hide security failures?
- Does this change require a threat-model update: assets, attackers, trust boundaries, abuse cases, and mitigations?
- Are authentication, authorization, and audit decisions enforced at the right boundary and tested negatively?
- Are secrets centrally managed, rotated, least-privileged, and never printed or documented in plain text?
- Could logs or errors enable log injection, information disclosure, or credential exposure?

## Avoid overcorrection

Do not request security theater, unused abstraction, or blanket denial that breaks intended workflows without reducing a concrete risk.
