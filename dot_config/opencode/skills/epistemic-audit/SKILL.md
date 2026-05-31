---
name: epistemic-audit
description: >
  Use this skill when a task requires non-trivial factual claims, required source-class selection, requirement interpretation, source synthesis, review judgment, implementation premises, or reader-facing explanation where confirmed facts, deductions, inferences, assumptions, project rules, generic guidance, unknowns, or session-local context may be confused. It produces a control-plane ledger and prose or decision constraints, not final prose. Do not use for tiny obvious replies or as a substitute for repository investigation or public research.
---

# Epistemic Audit

## Purpose

This skill separates claim status, evidence, and allowed use before those claims are
turned into requirements, investigation conclusions, review findings, implementation
premises, summaries, comments, documentation, or other natural-language output.

It is a control-plane workflow, not a writing style. The audit should constrain the
final answer or edit without forcing visible classification labels into normal
reader-facing prose.

## When to use

Use this skill when one or more of the following are true:

- a task combines user intent, repository evidence, public sources, project rules, and
  model inference
- a follow-up user turn may have changed the task type, source-of-truth class, or allowed
  use of a previous claim
- a requirement, review finding, implementation premise, or conclusion could be filled
  by a plausible but unverified assumption
- the task must decide which source classes are required before choosing or completing
  `investigation`, `public-research`, `code-review`, or `implementation`
- multiple source classes must be checked before a factual answer is safe
- project-local rules or domain premises may override generic best practices
- reader-facing text could leak session-local context, obsolete names, discarded designs,
  or private discussion history
- a subagent is asked to provide a read-only claim audit before the parent writes final
  prose or edits files

## When not to use

Do not use this skill when:

- the task is a tiny obvious reply with no material factual, review, or requirement claim
- the only missing fact must first be gathered from a single obvious source class; use
  `investigation` or `public-research` directly
- the primary problem is document structure, scannability, or reader fit after facts are
  already settled; use `technical-writing`

Do not use this skill as a substitute for gathering missing repository or public facts.
However, use it before or alongside `investigation` or `public-research` when the task
must first decide which source classes are required, or when public facts, repository
evidence, project rules, and model inference may be confused.

## Claim statuses

Use these statuses consistently:

- `user_stated`: explicitly provided by the user
- `repo_observed`: directly observed in repository files, commands, tests, logs, or state
- `public_observed`: directly observed in public primary or authoritative sources
- `project_rule`: active project-specific rule, ADR, specification, domain note, or user
  constraint
- `deduced`: logically derived from binding claims without adding a material auxiliary
  assumption
- `inferred_candidate`: plausible, but dependent on an auxiliary assumption, incomplete
  evidence, or pattern extrapolation
- `working_assumption`: temporary assumption used only to continue investigation or draft a
  plan; it has no binding force
- `unknown`: required information that is not resolved
- `session_local`: context known only from the current conversation or execution and not
  necessarily known to readers or future agents
- `rejected_assumption`: a tempting assumption that was considered and explicitly not
  adopted

## Allowed-use rules

- Binding requirements, review findings, implementation premises, and reader-facing
  factual statements may use only `user_stated`, `repo_observed`, `public_observed`,
  `project_rule`, or valid `deduced` claims.
- `inferred_candidate` and `working_assumption` claims may guide investigation or be
  recorded as non-binding candidates, but they must not become acceptance criteria,
  blocking review findings, implemented behavior, or factual prose without confirmation.
- `unknown` blocks any conclusion that materially depends on it.
- `session_local` may be used in reader-facing text only when the text reintroduces the
  context for that reader.
- `rejected_assumption` must not guide downstream work unless new evidence reopens it.

## Source coverage matrix

When the task needs more than one source class, create a compact coverage matrix:

| Source class               | Required         | Status                           | Evidence              | Missing impact |
| -------------------------- | ---------------- | -------------------------------- | --------------------- | -------------- |
| user request               | yes/no           | checked/unchecked/not applicable | request excerpt       | none or impact |
| repository evidence        | yes/no           | checked/unchecked/not applicable | path:line or command  | none or impact |
| public primary source      | yes/no           | checked/unchecked/not applicable | URL or citation       | none or impact |
| project rules/domain notes | yes/no           | checked/unchecked/not applicable | path:line             | none or impact |
| prior/session context      | yes/no/forbidden | checked/unchecked/not applicable | conversation artifact | none or impact |

If a required source class is unchecked, do not assert a conclusion as confirmed.
Either gather the source with the appropriate skill/tool or state the limitation.

## Claim ledger

For non-trivial audits, maintain a ledger with these fields:

| claim_id | claim | status             | evidence     | derivation           | binding_level | allowed_use      |
| -------- | ----- | ------------------ | ------------ | -------------------- | ------------- | ---------------- |
| C-1      | ...   | user_stated        | user request | none                 | binding       | requirement      |
| C-2      | ...   | inferred_candidate | pattern only | auxiliary assumption | non-binding   | investigate only |

Use `binding_level` values:

- `binding`: may define requirements, findings, implementation premises, or facts
- `non_binding`: may be mentioned only as a candidate, caveat, or follow-up
- `temporary`: may guide immediate investigation only
- `blocked`: must not be used until resolved
- `rejected`: must not be used

## Procedure

1. Restate the exact output or decision that needs claim control.
2. If the current message is a follow-up, compare it with the previous workflow and
   reclassify the turn if the task type or required source-of-truth class changed.
3. Identify the intended audience when reader-facing prose is involved.
4. Identify required source classes and fill the source coverage matrix.
5. List the material claims and assign statuses, evidence, derivation, binding level, and
   allowed use.
6. Move plausible but unconfirmed content into `inferred_candidate`, `working_assumption`,
   `unknown`, or `rejected_assumption` instead of silently promoting it.
7. Derive constraints for the downstream output or edit:
   - what may be stated directly
   - what must be caveated
   - what must not be asserted
   - what source must be gathered before proceeding
   - what session-local context must be reintroduced or omitted
8. If the audit was delegated, return the control-plane result only. Do not draft final
   prose or make repository edits unless the assignment explicitly asks for them.

## Output schema

Return or record:

- `output_or_decision_target`
- `reader_context` when relevant
- `source_coverage`
- `binding_claims`
- `deductions`
- `inferred_candidates`
- `working_assumptions`
- `unknowns`
- `session_local_risks`
- `rejected_assumptions`
- `constraints_for_final_output_or_edit`
- `recommended_next_action`

## Quick checklist

Before finishing, verify all of the following:

- every material claim has a status and evidence or an explicit lack of evidence
- no inferred candidate is used as a binding requirement, finding, premise, or fact
- required source coverage gaps are visible
- project rules are separated from generic guidance
- reader-facing constraints account for session-local context
- the final prose or downstream edit can remain readable without exposing the ledger
