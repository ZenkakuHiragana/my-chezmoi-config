---
description: Analyze recorded prompt failures for root cause, define permanent corrective actions, and prepare verification of effectiveness
agent: plan
---

Your task is to perform triage on recorded prompt failures.

User request:
$ARGUMENTS

---

This command is for:

- clustering related failures
- root-cause analysis
- defining permanent corrective actions
- defining effectiveness checks

This command is not for:

- recording a brand-new failure from scratch
- applying broad hierarchy edits directly
- speculative rewriting without incident evidence

If the request is mainly about recording one new incident, recommend `/report-failure`.
If the request is mainly about applying hierarchy-wide changes already decided here, recommend `/refine-prompt`.

Follow this workflow exactly.

## 1. Read the control documents first

Read these files before doing anything else:

- `AGENTS.md`
- `opencode-prompt-dev/prompt-principles.md`
- `opencode-prompt-dev/prompt-refactor-checklist.md`
- `~/.local/share/chezmoi/.opencode/local-failure-logs/`

## 2. Select the relevant incidents

Focus primarily on failure entries whose status is one of:

- `observed`
- `contained`
- `under_rca`

Exclude entries that are primarily exercises, drills, or verification-only artifacts unless they document an actual failure pattern.

If the user specified particular ids, prioritize them.

## 3. Build failure clusters

Cluster failures by common underlying pattern, not by superficial wording.

Examples of clustering dimensions:

- same missing capability
- same wrong layer
- same duplicated or conflicting rule family
- same missing validation pattern
- same missing research gate
- same incomplete task contract pattern

Prefer a small number of meaningful clusters over many tiny clusters.

## 4. Restate each cluster as a gap

For each cluster, define:

- current condition:
  what is repeatedly happening
- target condition:
  what should happen instead
- gap:
  the observable difference between them

Keep this evidence-based.
Do not jump to root cause yet.

## 5. Perform root-cause analysis

For each cluster, analyze likely root causes.

Use disciplined root-cause reasoning.
You may use lightweight 5-whys reasoning, but do not force exactly five steps.

Check cause candidates such as:

- missing rule
- weak wording
- wrong layer
- duplicated or conflicting rules
- missing validation
- missing research gate
- incomplete task contract
- missing role boundary
- misplaced procedure between skill description and `SKILL.md`

A root cause is acceptable only if it explains the recurring gap and leads to a corrective action that could realistically prevent recurrence.

Do not confuse symptom, containment, and root cause.

## 6. Define permanent corrective action

For each cluster, define the preferred permanent corrective action.

Use this priority order:

1. reword_existing_rule
2. move_to_different_layer
3. merge_overlapping_rules
4. split_overloaded_rule
5. restore_missing_essential
6. add_minimal_new_rule only if the above are insufficient

For each action, specify:

- target layer
- affected files or likely file types
- why this is the smallest permanent correction that can prevent recurrence

Do not recommend a new rule if wording, layer correction, or restoration is likely enough.

## 7. Define effectiveness checks

For each permanent corrective action, define how effectiveness will be verified.

Include:

- what future behavior should change
- what evidence would show recurrence has stopped
- what nearby files or layers should be checked for duplication or conflict
- what result would count as failure of the corrective action

Do not close the loop without an effectiveness check.

## 8. Update failure-log statuses if justified

You may update incident files under `~/.local/share/chezmoi/.opencode/local-failure-logs/` only in these limited ways:

- move `observed` or `contained` to `under_rca` when triage has actually begun
- move to `corrective_action_defined` when a permanent corrective action and effectiveness check have been clearly defined
- add short root-cause notes
- add short corrective-action notes
- add short verification-plan notes

Do not mark anything `verified_closed` in this command.

## 9. Final response format

Provide these sections in order.

## Scope

- which failure ids or statuses were analyzed
- how many incidents were considered

## Clusters

For each cluster, provide:

- cluster name
- member failures
- current condition
- target condition
- gap

## Root-cause analysis

For each cluster, provide:

- likely root cause
- why this explains the gap better than nearby alternatives
- what evidence still remains uncertain, if any

## Permanent corrective actions

For each cluster, provide:

- recommended action type
- recommended target layer
- why it should prevent recurrence
- why smaller alternatives are insufficient, if applicable

## Effectiveness checks

For each cluster, provide:

- what to verify
- what would count as success
- what would count as recurrence

## Recommended next command

- say whether the next step should be `/refine-prompt`
- keep this concrete
