---
description: Record one prompt failure using evidence, define current vs target condition, and apply the smallest safe containment if needed
agent: build
---

Your task is to record one prompt failure as a quality incident.

User request:
$ARGUMENTS

---

This command is for:

- collecting facts
- defining the gap between current condition and target condition
- applying the smallest safe immediate containment when justified

This command is not for:

- full root-cause analysis
- hierarchy-wide refactoring
- broad consolidation across multiple failures

If the request is mainly about broad cleanup or consolidation, recommend `/triage-failure` or `/refine-prompt` instead.

Follow this workflow exactly.

## 1. Read the control documents first

Read these files before doing anything else:

- `~/.local/share/chezmoi/AGENTS.md`
- `~/.local/share/chezmoi/opencode-prompt-dev/prompt-principles.md`
- `~/.local/share/chezmoi/opencode-prompt-dev/prompt-failure-log.md`

## 2. Collect raw evidence first

Before writing any interpretation, collect the raw evidence for this failure.

Evidence may include:

- exact response snippets
- prompt text excerpts
- file diffs
- edited file paths
- missing actions
- tool-use traces
- absence of expected citations, searches, validations, or checks

Do not summarize yet.
Do not infer intent yet.

## 3. Write the current condition from evidence only

From the evidence, write a short current condition.

Rules:

- write only what is directly supported by the evidence
- do not use judgmental words such as “careless”, “bad”, “wrong”, “redundant”, or “misunderstood”
- do not infer motive or intent
- if evidence is too weak, say so and lower confidence

## 4. Write the target condition

State what should have happened instead.

If possible, identify the expectation source:

- explicit_user_request
- existing_prompt_text
- accepted_prior_behavior
- inferred_from_context
- unknown

If the expectation source is weak or inferred, say so clearly in notes.

## 5. Identify affected scope

Determine the affected prompt layers and task archetypes.

Possible layers:

- global_rules
- role_prompt
- skill_description
- skill_body

Possible archetypes:

- implementation
- refactoring
- public_research
- local_investigation
- planning
- verification
- writing
- other

## 6. Decide whether immediate containment is needed

Ask:

- Is this failure likely to recur soon?
- Is there a small safe patch that can reduce recurrence now?
- Can that patch be applied without broad redesign?

If yes:

- apply the smallest safe containment
- prefer a narrow rewording or local patch
- do not perform broad refactoring
- do not generalize more than needed
- set status to `contained`

If no:

- do not patch
- set status to `observed`

Immediate containment is temporary.
Do not confuse it with permanent corrective action.

## 7. Assign only an initial cause category

Do not perform full root-cause analysis here.

Assign one or more initial cause categories from:

- missing_rule
- weak_wording
- wrong_layer
- duplicated_or_conflicting_rules
- missing_validation
- missing_research_gate
- incomplete_task_contract
- unknown

This is provisional classification only.

## 8. Define a minimal verification plan

Write a short verification plan for the containment or for the recorded issue.

The plan must answer:

- what future sign would show that the failure is no longer recurring
- what file, behavior, or output should be checked next

## 9. Append one failure entry to the failure log

Append exactly one new entry to `~/.local/share/chezmoi/opencode-prompt-dev/prompt-failure-log.md`.

Follow the file’s existing template and conventions exactly.

Required fields:

- id
- status
- date
- title
- short summary
- current_condition
- target_condition
- evidence
- observation_confidence
- scope
- immediate_containment
- suspected_cause_category
- root_cause_notes
- corrective_action
- verification_plan
- verification_result
- notes

Use:

- `root_cause_notes: pending`
- `corrective_action: pending`
- `verification_result: pending`

unless the file format explicitly requires something else.

## 10. Final response format

Provide these sections in order.

## Recorded failure

- title
- id
- status

## Current vs target condition

- current condition
- target condition
- expectation source

## Evidence used

- short list of the evidence items used

## Immediate containment

- what was done, or `none`
- why this was or was not justified

## Next step

- say whether this should later go to `/triage-failure`
