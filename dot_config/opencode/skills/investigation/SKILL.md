---
name: investigation
description: >
  Attach this capability when repository-local behavior or locally available source-of-truth evidence must be inspected before a claim, fix, or implementation is safe. This includes local upstream checkouts, generated graphs, runtime artifacts, logs, traces, authoritative paths named by AGENTS.md, domain notes, or the user, and unresolved `repo_derivable` attributes. It produces confirmed local observations, source coverage, remaining unknowns, and the next action. Do not use as the sole capability for public-only fact finding or for concrete implementation work whose facts and checks are already resolved.
---

# Investigation

## Purpose

This capability is for investigating repository-local or otherwise locally available evidence before deciding whether a factual claim, fix, implementation change, or review finding is safe.

Local evidence includes the current repository, local upstream checkouts, generated graphs,
runtime artifacts, logs, traces, authoritative paths, and other source-of-truth materials
named by AGENTS.md, project rules, domain notes, or the user.

It is also the default way to resolve `repo_derivable` fields left open by a normalized requirements artifact.

## When to use

- the observed behavior, reported issue, or factual state is unclear and you first need to establish what is actually happening
- you need to reproduce or approximate a behavior before deciding what to change
- you need direct evidence such as logs, traces, runtime state, temporary instrumentation, or concrete outputs
- you need to inspect a local upstream checkout, generated graph, runtime artifact, log, trace, or authoritative path that is outside the current repository but available locally
- you need to confirm which code path, branch, configuration, environment, input, or data shape is actually in play
- you need to separate internal causes from external dependencies, configuration, data, or environment factors
- you need to compare several plausible explanations before deciding the next action
- you need to check related public issues, release notes, or upstream reports; use `public-research` for that part when local evidence is not enough
- a requirements record says an attribute should be `repo_derivable`, but the actual value is not yet confirmed

## When not to use

- the current request or task contract already identifies a concrete repository change and required checks, and the main task is to implement it
- the main work is feature delivery, refactoring, or documentation updates rather than investigation
- the task is repository-independent fact finding with no local evidence, local source-of-truth, repository behavior, or state to inspect

## Investigation criteria

Assess the work against:

- what has been directly observed and confirmed
- which claims are repository-observed facts, deductions from local evidence, inferred candidates, working assumptions, unknowns, or rejected explanations
- which required local source classes were checked and which remain unchecked
- reproduction status and reproducibility conditions
- scope of impact and affected surfaces
- which code paths, inputs, state, configuration, data, or environment factors are confirmed in play
- what has been ruled out by evidence
- strongest remaining explanations ranked by evidence
- whether explicit user constraints remained intact while evidence was gathered
- whether added diagnostics are temporary and narrowly targeted

## Output expectations

Return:

- a short summary of the observed behavior or factual question
- confirmed observations and relevant evidence
- a local source coverage summary when multiple repository paths, logs, configs, generated outputs, or runtime states were required
- inferred candidates and working assumptions kept separate from confirmed observations
- which `repo_derivable` fields or local facts were resolved, when applicable
- reproduction status
- narrowed scope and what has been ruled out
- likely explanations ranked by evidence
- remaining unknowns
- the recommended next action or capability set
- any temporary diagnostics that should be removed after the investigation

## Procedure

1. Restate the observed behavior, factual question, and expected behavior if it is known.
2. Reproduce or approximate the behavior when possible.
3. If the user names or strongly implies a decisive source of truth, make it the first evidence target before proposing fixes, replacement designs, suppressions, workarounds, or broad theories. Examples include an exact source path, runtime state, log, route, register or constant provenance, authoritative specification, mode or authority table, generated-data path, or history diff. If that evidence is unavailable, record what was unavailable and why before moving to alternatives.
4. If AGENTS.md, project rules, domain notes, or the user identify a local source-of-truth repository, generated graph, runtime artifact, log, or authoritative path for the domain, include it as a required source class when the question depends on that domain.
5. Gather direct evidence from the relevant repository paths, logs, state, callers, configuration, environment, inputs, or outputs. Keep searches scoped to the relevant repository or to the smallest necessary, explicitly named directories, and do not use the filesystem root `/` or other very broad top-level directories as search roots.
6. When the task requires several local source classes, maintain a source coverage matrix with source class, status, evidence, and missing impact. Do not present an explanation as confirmed when a required source class is unchecked.
7. Keep explicit user constraints active while gathering evidence. Add temporary diagnostics only as narrowly as needed, and do not turn them into new supported control surfaces, runtime branches, or compatibility paths unless the request or an existing contract requires that.
8. Compare plausible explanations against the observed evidence and rule out what you can.
9. Check public issue trackers or docs when local evidence does not sufficiently explain the behavior.
10. Stop once you can report confirmed observations, remaining unknowns, and the smallest sufficient recommended next action or capability set, whether that is implementation, more targeted investigation, public research, epistemic audit, a user question, or no repository change.
11. Remove, disable, or clearly isolate temporary diagnostics before finishing if they are no longer needed.
