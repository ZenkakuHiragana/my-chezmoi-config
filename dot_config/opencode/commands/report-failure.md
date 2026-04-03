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

The canonical failure-log is local only. Store each incident as its own Markdown file under `~/.local/share/chezmoi/.opencode/local-failure-logs/`. If the directory does not exist, create it. Use the embedded template below to create a new file for each incident. Do not write raw evidence or unredacted entries into any repository-tracked file.

For local-only operation, confirm that `~/.local/share/chezmoi/.opencode/local-failure-logs/` is listed in `.gitignore` and that no files created there will be committed. Always require the user to confirm that raw evidence has been saved locally and will not be pushed.

## Embedded failure-log template

### Basic policy

- Collect facts first.
- Separate what was observed from why it is a problem.
- Use immediate containment only when needed before permanent corrective action.
- Analyze root cause in a later triage step.
- Manage failures as a closed loop and record the verification result.

### Record rules

- Do not write secrets, credentials, unpublished identifiers, internal URLs, local paths, proprietary names, customer information, personal information, or unnecessary private repository contents as-is.
- Replace values with stable placeholders such as `USER_A`, `REPO_A`, `INTERNAL_URL_A`, and `SECRET_A` when the exact value is not needed.
- If a precise quote mixes useful evidence with sensitive data, redact the sensitive parts or paraphrase it and note that it was anonymized.
- Keep the minimum context needed for triage, verification, and later refactoring.

### Current condition

- Write only what is directly supported by evidence.
- Do not infer motive or intent.
- Keep it short and factual.

### Target condition

- State what should have happened instead.
- If possible, record the expectation source.

### Evidence

- Record snippets, diffs, edited file paths, missing actions, tool traces, and missing checks.
- Prefer short, specific bullets.

### Immediate containment

- Write the smallest temporary fix for now.
- Separate it from permanent corrective action.
- If none, write `none`.

### Suspected cause category

- missing_rule
- weak_wording
- wrong_layer
- duplicated_or_conflicting_rules
- missing_validation
- missing_research_gate
- incomplete_task_contract
- unknown

### Corrective action

- Write after triage.
- Prefer rewording, moving layers, merging rules, splitting rules, restoring missing essentials, or adding the smallest new rule only if necessary.

### Verification plan

- State what future sign would show the issue is no longer recurring.
- State what file, behavior, or output should be checked next.

### Verification result

- pending / passed / failed

### Status

- `observed`
  - failure observed, no containment yet
- `contained`
  - temporary containment applied
- `under_rca`
  - root cause analysis in progress
- `corrective_action_defined`
  - permanent corrective action defined
- `verified_closed`
  - verification confirmed the issue is resolved

### Failure entry template

```md
---
id: F-YYYYMMDD-001
status: observed
date: YYYY-MM-DD

title:
short summary:

current_condition:

-

target_condition:

-

evidence:

-

observation_confidence: high

scope:
layers: - global_rules - role_prompt - skill_description - skill_body
archetypes: - implementation

immediate_containment:

- none

suspected_cause_category:

- unknown

root_cause_notes:

- pending

corrective_action:

- pending

verification_plan:

- pending

verification_result: pending

notes:

---
```

## 1. Read the control documents first

Read these files before doing anything else:

- `~/.local/share/chezmoi/AGENTS.md`
- `~/.local/share/chezmoi/opencode-prompt-dev/prompt-principles.md`
- `~/.local/share/chezmoi/.opencode/local-failure-logs/`

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

## 3. Protect non-public information before writing the log

The failure log is a persistent internal record. Before writing any evidence, summaries, or notes into it:

- never include secrets, credentials, private repository contents beyond what is needed, unpublished identifiers, internal URLs, local paths, proprietary names, customer information, or other user-sensitive details unless the user explicitly requested that disclosure and it is clearly safe
- replace non-public details with stable placeholders such as `USER_A`, `REPO_A`, `INTERNAL_URL_A`, or `SECRET_A` when the exact value is not required to understand the failure
- keep the minimum detail needed for triage, verification, and later refactoring
- if a raw quote mixes useful evidence with sensitive details, redact the sensitive parts or paraphrase the quote and note that it was anonymized

Apply the same rule to the final response whenever you quote or summarize the recorded evidence.

## 4. Write the current condition from evidence only

From the evidence, write a short current condition.

Rules:

- write only what is directly supported by the evidence
- do not use judgmental words such as “careless”, “bad”, “wrong”, “redundant”, or “misunderstood”
- do not infer motive or intent
- if evidence is too weak, say so and lower confidence

## 5. Write the target condition

State what should have happened instead.

If possible, identify the expectation source:

- explicit_user_request
- existing_prompt_text
- accepted_prior_behavior
- inferred_from_context
- unknown

If the expectation source is weak or inferred, say so clearly in notes.

## 6. Identify affected scope

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

## 7. Decide whether immediate containment is needed

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

## 8. Assign only an initial cause category

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

## 9. Define a minimal verification plan

Write a short verification plan for the containment or for the recorded issue.

The plan must answer:

- what future sign would show that the failure is no longer recurring
- what file, behavior, or output should be checked next

## 10. Append one failure entry to the local-only failure log

Create exactly one new sanitized Markdown file under `~/.local/share/chezmoi/.opencode/local-failure-logs/` for this incident.

Use the embedded template above exactly for field names and structure. Name the file with the incident id, for example `F-YYYYMMDD-001.md`. When fields are not yet available, use the placeholders:

- `root_cause_notes: pending`
- `corrective_action: pending`
- `verification_result: pending`

Do not commit or push any files from `~/.local/share/chezmoi/.opencode/local-failure-logs/`. If the user later requests cross-machine triage, the sanitized summary from one or more local incident files may be transcribed into another store after explicit review and anonymization.

## 11. Final response format

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
