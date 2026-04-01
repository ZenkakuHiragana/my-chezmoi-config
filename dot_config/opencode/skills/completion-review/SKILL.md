---
name: completion-review
description: Use this skill before declaring a non-trivial task done. Produces a structured completion statement covering checks performed, supporting evidence, unachieved items, and residual risks, ending with an explicit completion verdict. Do not use for trivial single-step tasks or purely conversational responses. Expected result: a clear, evidence-backed decision on whether the work qualifies as a final deliverable, preventing premature or incomplete completion declarations.
---

# Completion Review

## Purpose

This skill provides a cross-cutting completion gate. Use it to decide whether the work done in this session can be treated as a final deliverable.

It does not replace skill-specific checklists. It adds a structured verdict layer on top of them.

## When to use

Use this skill when:

- you have finished the primary work (edits, investigation, research, or refactoring) and are about to present the result to the user
- the task involved multiple steps, multiple files, or non-trivial decision-making
- the user or the originating command expects a completion judgement

## When not to use

Do not use this skill when:

- the task was a trivial single-step action with an obvious outcome
- the response is purely conversational or informational with no deliverable
- you are providing a mid-progress status update, not a final deliverable
- the output is a failure triage entry where the corrective action is still pending

## Completion statement structure

Before finishing, produce a completion statement containing exactly these five sections.

### 1. Checks performed

List each verification or inspection action you actually carried out.

Be specific. Do not list checks you intended but did not run.

Examples of valid entries:

- re-read edited file `X` and confirmed the change matches the intent
- ran type checker on affected module, no errors
- inspected callers of changed function `Y`, no breakage
- verified citation links resolve to the claimed sources
- compared before/after behavior for the refactored path

### 2. Evidence

For each check, state the concrete observation that supports it.

Do not use vague language such as "looks fine" or "should work."

Examples of valid evidence:

- "file re-read shows the new key is present at line 42"
- "type checker returned exit code 0"
- "callers at `A.ts:15` and `B.ts:88` pass the new argument shape"
- "webfetch confirmed the API endpoint returns the documented shape"

### 3. Unachieved items

List anything that was part of the original request or an obvious follow-up that you did not complete.

If there are none, write `None.`

Do not omit items because they seem minor. If you skipped a step, say so.

### 4. Residual risks

List any known gaps, assumptions, or risks that remain after your work.

If there are none, write `None.`

Include risks even if they are unlikely, as long as they are real.

Examples:

- "renamed public function; external consumers outside the repository are not checked"
- "no integration test exists for this path"
- "the fix assumes the upstream API will not change its error format"

### 5. Completion verdict

State exactly one of:

- `complete`: all requested work is done, all checks passed, no unachieved items, no meaningful residual risks.
- `complete_with_caveats`: the core request is satisfied, but unachieved items or residual risks exist and are documented above.
- `blocked`: the work cannot be completed due to a concrete blocker. Name the blocker.

Do not use any other verdict wording.

## Rules

### Do not declare completion without evidence

A completion verdict must be backed by the checks and evidence sections. If the evidence section is empty, the verdict must not be `complete`.

### Do not upgrade the verdict

If unachieved items or residual risks exist, the verdict is `complete_with_caveats` at most, never `complete`.

If a concrete blocker exists, the verdict is `blocked`, never `complete_with_caveats`.

### Do not bury bad news

If something was attempted and failed, list it under unachieved items or residual risks. Do not describe a failure as if it were a success.

### Keep the statement factual

The completion statement is a record, not a persuasive document. State what happened, not what you hope the user will believe.

## Output format

Present the completion statement in this order, using a clear heading or label for each section:

```
## Completion review

### Checks performed
- ...

### Evidence
- ...

### Unachieved items
- ...

### Residual risks
- ...

### Verdict: <complete | complete_with_caveats | blocked>
<one-line justification referencing the sections above>
```

## Quick checklist

Before finishing, verify all of the following:

- every check listed was actually performed, not just intended
- every check has corresponding evidence
- unachieved items are listed even if they seem minor
- residual risks are listed even if unlikely
- the verdict matches the content of the other four sections
- the verdict is one of the three allowed values
- no vague or aspirational language appears in the statement
