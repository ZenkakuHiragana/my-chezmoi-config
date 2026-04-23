---
name: investigation
description: Use this skill when you need to investigate repository-local behavior, state, or facts before deciding on a real fix or implementation change. Use it for reproduction, evidence gathering, code-path confirmation, temporary instrumentation, and configuration, environment, or data inspection. Do not use when the current request or task contract already identifies a concrete repository change and required checks, or when the task is mainly public fact-finding. Expected result: confirmed observations, reproduction status, narrowed scope, ranked explanations, remaining unknowns, and the recommended next action.
---

# Investigation

## Purpose

This skill is for investigating repository-local observed behavior, system state, and factual conditions before deciding whether any real fix or implementation change is needed.

## When to use

- the observed behavior, reported issue, or factual state is unclear and you first need to establish what is actually happening
- you need to reproduce or approximate a behavior before deciding what to change
- you need direct evidence such as logs, traces, runtime state, temporary instrumentation, or concrete outputs
- you need to confirm which code path, branch, configuration, environment, input, or data shape is actually in play
- you need to separate internal causes from external dependencies, configuration, data, or environment factors
- you need to compare several plausible explanations before deciding the next action
- you need to check related public issues, release notes, or upstream reports; use `public-research` for that part when local evidence is not enough

## When not to use

- the current request or task contract already identifies a concrete repository change and required checks, and the main task is to implement it
- the main work is feature delivery, refactoring, or documentation updates rather than investigation
- the task is repository-independent fact finding with no repository-local behavior or state to inspect

## Investigation criteria

Assess the work against:

- what has been directly observed and confirmed
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
- reproduction status
- narrowed scope and what has been ruled out
- likely explanations ranked by evidence
- remaining unknowns
- the recommended next action
- any temporary diagnostics that should be removed after the investigation

## Procedure

1. Restate the observed behavior, factual question, and expected behavior if it is known.
2. Reproduce or approximate the behavior when possible.
3. Gather direct evidence from the relevant repository paths, logs, state, callers, configuration, environment, inputs, or outputs. Keep searches scoped to the relevant repository or to the smallest necessary, explicitly named directories, and do not use the filesystem root `/` or other very broad top-level directories as search roots.
4. Keep explicit user constraints active while gathering evidence. Add temporary diagnostics only as narrowly as needed, and do not turn them into new supported control surfaces, runtime branches, or compatibility paths unless the request or an existing contract requires that.
5. Compare plausible explanations against the observed evidence and rule out what you can.
6. Check public issue trackers or docs when local evidence does not sufficiently explain the behavior.
7. Stop once you can report confirmed observations, remaining unknowns, and exactly one recommended next action, whether that is implementation, more targeted investigation, a user question, or no repository change.
8. Remove, disable, or clearly isolate temporary diagnostics before finishing if they are no longer needed.
