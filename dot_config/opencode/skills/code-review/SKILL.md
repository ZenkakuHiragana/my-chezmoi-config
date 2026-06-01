---
name: code-review
description: Attach this capability when a task frame needs review of a specific diff or codebase surface for quality issues. It produces prioritized findings with severity, authority, evidence, impact, and next steps across correctness, design, tests, maintainability, security, performance, docs, and style. Do not use as the sole capability for implementing fixes, investigating observed behavior, or factual follow-up verification; attach investigation, public-research, or epistemic-audit as needed.
---

# Code Review

## Purpose

This capability reviews code for likely defects, design problems, regressions, and maintainability issues.

It is for advisory review, not for making fixes.

In mixed tasks, review context may provide hypotheses or locations to inspect, but it is
not the owner of public facts, local source-of-truth investigation, implementation, or
final prose quality.

The review must not stop at broad labels such as "performance" or "maintainability." It must use concrete trigger patterns, read enough context to judge impact, and report only findings backed by evidence.

## When to use

Attach this capability when the user asks to:

- review a diff, patch, or pull request
- review the current codebase for quality issues
- find problems in a changed area before merge
- evaluate whether code is ready to land

## When not to use

Do not attach this capability as the sole task owner when the main task is:

- implementing a change
- investigating a specific failure or unclear behavior
- researching external facts
- refactoring code
- writing a completion verdict after the work is already done

## Review contract

Review the code against common code review concerns:

- correctness, edge cases, and specification conformance
- design, integration, and responsibility placement
- complexity and maintainability
- tests and test quality
- naming, readability, comments, and documentation
- style and consistency with the existing codebase
- security, privacy, and misuse resistance when relevant
- performance, resource use, and reliability when relevant
- compatibility, migration, operations, and contributor rules when relevant

Use quality models as a coverage map, not as a mechanical checklist. At minimum, consider:

- functional suitability: does the change satisfy the intended behavior and user/caller contract?
- reliability: does it behave safely under failure, overload, retry, cancellation, and recovery?
- performance efficiency: does it meet plausible time, resource, and capacity expectations?
- security and privacy: does it preserve confidentiality, integrity, authorization, accountability, and safe secret handling?
- compatibility and portability: does it preserve public/persisted contracts, supported environments, and migration paths?
- maintainability: does it preserve modularity, analysability, modifiability, testability, and long-term code health?

If a diff is provided, review the changed lines and the surrounding context that the change depends on.

If only the current codebase is available, review the highest-risk areas first and state what scope was actually covered.

## Working rules

### 1. Read the code, not just the summary

Inspect the actual files, related callers, tests, docs, and project rules that define the contract.

Project-local rules, ADRs, specifications, domain notes, and explicit user constraints are
review authority. Generic best practices are advisory unless they are supported by a
concrete project risk, a project rule, a public contract, or a safety/security concern.

For a diff, read every changed line.

When available and relevant, inspect:

- PR description, issue text, design notes, README, CONTRIBUTING, and architecture docs
- nearby implementations and existing extension points
- tests, fixtures, generated docs, and examples
- build, lint, typecheck, and CI configuration
- expected input sizes, data lifetimes, hot paths, IO, concurrency, and external boundaries

### 2. Focus on material issues

Prioritize problems that could cause bugs, regressions, confusion, performance cliffs, security exposure, invalid tests, or hidden maintenance cost.

Treat minor polish as nits.

### 3. Separate blocking findings from polish

Mark issues by severity so the user can tell what must be fixed before merge.

Use these severity labels:

- `Blocker`: confirmed correctness, regression, security, privacy, data-loss, or contract issues that would make landing unsafe
- `Major`: serious design, maintainability, performance, migration, or test-quality concerns supported by concrete evidence and likely to create near-term trouble
- `Minor`: localized readability, naming, documentation, or consistency issues
- `Uncertain`: plausible concern with incomplete evidence; state what extra context would confirm or dismiss it

Also classify each finding's authority:

- `project_rule_violation`: a project rule, ADR, specification, documented invariant, or explicit user constraint is violated
- `contract_or_correctness_risk`: the code can break a public API, persisted format, user workflow, security boundary, or directly evidenced behavior
- `generic_risk`: general engineering guidance applies and no project rule was found to override it
- `uncertain`: project authority or impact is not yet established

Do not present a `generic_risk` as a blocking finding unless the concrete impact is
shown for this project.

### 4. Avoid out-of-scope drift

Do not propose unrelated rewrites or broad cleanup unless the reviewed code clearly depends on them.

Do not turn a review finding into a speculative redesign. Prefer the smallest fix that addresses the concrete issue.

### 5. Review absence and excess

Check both missing handling and excessive handling.

Do not treat feature flags, fallbacks, compatibility shims, new abstractions, comments, tests, configuration knobs, documentation sections, or file/function splitting as automatically beneficial.

Flag them when they are not supported by an explicit requirement, existing public contract, persisted data, project convention, or concrete maintenance risk.

Before suggesting a fix, verify that the suggestion itself does not introduce unrequested fallback behavior, compatibility branches, feature flags, broad abstractions, documentation noise, or new behavior modes.

### 6. Be concrete

Each finding should name the location, explain the problem, and say why it matters.

If possible, suggest the smallest fix that addresses the issue.

Keep feedback neutral and constructive.

Do not report generic advice without a concrete location.

### 7. Say when evidence is insufficient

If a claim cannot be supported from the reviewed code, say so and ask for the missing context instead of guessing.

If input scale, deployment status, public API status, or compatibility requirements are unknown, state the assumption before judging severity.

### 8. Escape to investigation when the premise changes

During code review, a follow-up question or finding premise may stop being ordinary
review and become a factual investigation.

Reclassify the subquestion before continuing when it depends on external engine
behavior, platform semantics, public API behavior, generated data provenance, render
target formats, shader semantics, runtime objects, configuration keys, or project-local
domain rules.

Attach `investigation`, `public-research`, and `epistemic-audit` as needed to identify and
check the required source classes.
Do not make the review finding blocking while a required source class remains unchecked.
Report the concern as `Uncertain`, state the coverage gap, and name the evidence needed to
promote or dismiss it.

## Review workflow

1. Establish scope and intent.
   - Identify the touched language, profile, modules, public contracts, and likely risk level.
   - Infer the intended behavior from the diff, request, tests, docs, and adjacent code.
   - Identify input cardinality, hot paths, persisted data, public APIs, user workflows, IO, concurrency, and external services when relevant.
2. Load targeted review knowledge.
   - Use the core checklist below.
   - Read relevant concern files from `concerns/` when their trigger appears or the review scope is broad.
   - Read relevant combined language/toolchain profiles from `profiles/` when the codebase uses that stack.
   - Resolve concern and profile paths relative to this skill directory. If an auxiliary file is unavailable, continue with the core checklist and state which file could not be loaded.
3. Decide whether to review directly or split by concern.
   - Review directly when the surface is small enough for one coherent pass.
   - Use concern-based subagents when the review is broad, multi-file, high-risk, or spans several independent quality domains.
4. Run or inspect automated checks when possible.
   - Prefer existing project commands over invented commands.
   - Inspect CI, Makefile, package scripts, cargo commands, cmake presets, dotnet commands, luacheck config, test runners, and linters.
   - If feasible and safe, check whether the change adds compiler, analyzer, lint, or documentation warnings.
   - Do not duplicate linter output unless it has design, correctness, or maintainability impact.
5. Review in passes.
   - correctness and specification conformance
   - design and responsibility placement
   - performance and resource use
   - maintainability, idioms, and type-safety
   - complexity and minimality
   - tests and test quality
   - comments, documentation, and reader fit
   - security and misuse resistance
   - compatibility, migration, operations, dependencies, and contributor rules
6. Rank findings by severity.
7. Summarize the overall assessment and any remaining uncertainties.

## Core trigger checklist

Use these triggers even when you do not load a separate concern file:

- Repeated paths: loops, recursion, iterator chains, request handlers, rendering paths, event handlers, polling loops, task queues, and batch jobs.
- Repeated expensive work: materialization, copying, cloning, sorting, parsing, serialization, regex/schema/query construction, IO, DB/network calls, subprocesses, lock acquisition, task/thread creation, and representation conversion.
- Reference/definition drift: new or renamed functions, commands, hooks, routes, config keys, generated artifacts, or test fixtures that are called, read, or documented but not defined, imported, registered, generated, or exercised in the changed scope.
- Modified-function drift: shared tail code, existing branches, and helper calls inside a modified function can regress even when the obvious new branch looks correct.
- Closed domains represented weakly: type names, statuses, commands, events, roles, fields, error codes, or modes handled as raw strings, numbers, maps, or unstructured objects when the language or architecture can model them.
- Responsibility drift: business policy in adapters/controllers/UI, infrastructure deciding domain policy, domain importing framework/IO details, concrete types leaking across interfaces, bypassed extension points, or reversed dependency direction.
- Complexity drift: one function or file doing multiple separable jobs, nested conditionals hiding state machines, duplication caused by not finding the right owner, or indirection added for only one known case.
- Test gaps: missing normal, boundary, empty, large, invalid, error, concurrency, migration, compatibility, or regression cases when relevant.
- Test weakness: assertions that only verify mocks, tests that duplicate implementation logic, magical fixtures, unreadable data, nondeterminism, or tests that would not fail for the bug or contract being protected.
- Documentation and comments: missing public API docs or migration notes, comments that contradict code, comments that merely restate code, docs that describe non-existent behavior, or prose that assumes history the reader does not have.
- Security and privacy: auth, authorization, input validation, parsing, deserialization, filesystem paths, command execution, query construction, rendering, secrets, logs, crypto, network boundaries, plugins, and sandboxing.
- Concurrency and resources: races, deadlocks, cancellation, timeouts, unbounded fan-out, leaked handles, missing dispose/drop/defer/RAII cleanup, unsafe shared mutation, and unclear ownership.
- Compatibility and migration: database schema, save data, serialized formats, config formats, CLI flags, public APIs, plugin APIs, protocols, caches, message schemas, and generated artifacts.
- Overengineering and policy creep: unrequested feature flags, environment-variable switches, fallbacks, compatibility paths, duplicate functions, preprocessor/build conditionals, config knobs, broad abstractions, or README sections that do not serve a real reader.

## Concern files

Concern files are codified review knowledge, not incident history. Load only the files relevant to the review scope or triggers.

- `concerns/correctness.md`: specification conformance, edge cases, error handling, and logical mismatch
- `concerns/performance.md`: input scale, repeated work, allocations, copies, and algorithmic cost
- `concerns/maintainability-idioms.md`: stringly-typed logic, existing helpers, idioms, naming, and type-system leverage
- `concerns/responsibility-boundaries.md`: layer/module ownership, dependency direction, and abstraction leaks
- `concerns/complexity.md`: function/file size, indirection, duplication, and excessive splitting
- `concerns/tests.md`: coverage expectations and missing test cases
- `concerns/test-quality.md`: whether tests prove meaningful behavior
- `concerns/comments-and-docs.md`: useful documentation, factual alignment, placement, reader-context alignment, negative documentation, and documentation noise
- `concerns/security.md`: security, privacy, and misuse-resistance triggers
- `concerns/concurrency-and-async.md`: concurrency, async, cancellation, ordering, and synchronization
- `concerns/resource-lifecycle.md`: ownership, cleanup, leaks, and lifecycle coupling
- `concerns/compatibility-and-migration.md`: public/persisted contracts, migration, rollback, and release impact
- `concerns/observability-and-operability.md`: logs, metrics, diagnostics, deployability, and supportability
- `concerns/dependencies.md`: dependency additions, license/maintenance risk, and reinvented existing functionality
- `concerns/minimality-and-intentionality.md`: unrequested mechanisms, speculative compatibility, excessive comments/docs, and smallest-correct-change checks

## Profiles

Use combined language/toolchain profiles first. Do not split language and stack guidance until repeated profiles show real duplication.

Initial profiles:

- `profiles/rust-cargo.md`
- `profiles/python.md`
- `profiles/cpp-cmake.md`
- `profiles/csharp-dotnet.md`
- `profiles/lua-generic.md`
- `profiles/lua-neovim.md`
- `profiles/shell.md`

If no exact profile exists, use the closest profile plus the core and concern files.

## Concern-based subagent review

Use this section only when acting as a parent or primary agent and subagent dispatch is available. Skill use alone is not delegation.

### When to split

Prefer a concern split when at least one is true:

- the diff spans several modules, layers, languages, or generated/user-facing artifacts
- the change affects public API, persisted data, security boundary, concurrency, performance, or operations
- the review would require more than two or three deep concern passes by one agent
- independent review perspectives are likely to catch different failure modes

Avoid splitting when the review is narrow, when the same shared file would need conflicting interpretation by all children, or when user intent is the main uncertainty.

### Parent pre-scan

Before delegation, the parent should lightly inspect the diff and map:

- changed files, generated files, tests, docs, config, migrations, and public contracts
- likely risk domains and relevant concern/profile files
- commands or checks that already exist for the project
- exact read set for each child

### Default concern packs

Assign one child one pack, or combine adjacent packs for small reviews:

- `correctness-tests`: correctness, edge cases, reference drift, test coverage, test quality
- `design-maintainability`: responsibility boundaries, maintainability, idioms, naming, complexity, comments/docs
- `performance-reliability`: performance, resource lifecycle, concurrency/async, retries, overload, cancellation
- `security-dependencies`: security, privacy, secrets/logging, dependencies, supply-chain risk
- `compatibility-operations`: compatibility, migration, observability, operability, release/rollback, contributor rules
- `language-profile`: one relevant `profiles/*.md` file per touched language/toolchain plus any stack-specific risks not covered elsewhere

If you decide to split, do not stop at a list of concern names. Either actually dispatch the children, or, when dispatch is unavailable or the task only asks for an orchestration proposal, provide concrete assignment packet outlines for each child.

### Child assignment constraints

Each child assignment should be read-only and bounded:

- assignment packet fields: `assignment_id`, `agent`, `task_kind`, `work_class`, `mode_constraint`, `delegation_shape`, `parallel_group`, `parallel_basis`, `side_effect_mode`, `goal`, `scope`, `inputs`, `read_set`, `write_set`, `constraints`, `must_not_do`, `evidence_required`, `output_schema`, `verification_hint`, `stop_conditions`, `join_instructions`
- mode: `mode_constraint=read_only`, `side_effect_mode=read_only`; use `parallel_basis=domain` for concern splits and `parallel_basis=review` only for independent second opinions over the same surface
- goal: review one concern pack against the named diff/surfaces
- read_set: exact files, diff, tests, docs, and relevant concern/profile files
- write_set: none
- constraints: include read-only execution, exact review scope, required concern/profile files, and any project/user limits
- must_not_do: no edits, no recursive delegation, no broad rewrite proposals, no final merge verdict
- evidence_required: every finding needs location, evidence, impact, suggested next step, and confidence
- output_schema: findings by severity, non-findings that were explicitly checked, uncertainties, and commands/checks the parent should run or inspect
- stop_conditions: return after the bounded concern review and do not expand scope without parent instruction
- join_instructions: return findings in a shape the parent can deduplicate and severity-rank

Minimal packet outline:

```text
assignment_id: <review-id>-<pack>
mode_constraint: read_only
side_effect_mode: read_only
parallel_basis: domain
goal: Review <one concern pack> for <named surfaces>.
scope: <files, diff range, tests, docs, configs>
read_set: <exact files and concern/profile files>
write_set: none
constraints: <project and review limits>
must_not_do: no edits; no recursive delegation; no broad rewrite proposals; no final merge verdict
evidence_required: location, evidence, impact, suggested next step, confidence
output_schema: findings by severity; checked non-findings; uncertainties; suggested parent checks
stop_conditions: stop after this concern pack
join_instructions: parent will deduplicate, verify evidence, reconcile severity, and write final review
```

### Parent fan-in

The parent owns the final review:

- deduplicate overlapping findings
- verify that every retained finding has concrete evidence and real impact
- reconcile severity disagreements conservatively
- discard generic advice, unsupported speculation, and out-of-scope redesigns
- check for missing high-risk packs before finalizing
- present one coherent review in the normal output format

## Output format

Present results in this order:

1. Scope reviewed
2. Findings, ordered by severity
3. Open questions or uncertainties
4. Overall assessment

For each finding, include:

- severity
- location
- claim
- authority
- evidence
- impact
- suggested next step
- confidence

If there are no findings, say so explicitly and mention the scope you reviewed and the major passes you performed.

## Quick checklist

Before finishing, verify all of the following:

- the actual code was reviewed
- the review scope is explicit
- relevant concern files or profiles were considered, not abstract labels only
- findings are prioritized
- each finding has concrete evidence, impact, and location
- minor polish is separated from blocking issues
- missing handling and excessive handling were both considered
- proposed next steps are minimal and do not add unrequested behavior
- uncertainties are explicit rather than hidden as confident claims
