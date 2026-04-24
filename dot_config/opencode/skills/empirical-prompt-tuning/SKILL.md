---
name: empirical-prompt-tuning
description: Use this skill to improve agent-facing instructions empirically by dispatching fresh OpenCode subagents, scoring outputs with a frozen hidden rubric, and iterating until the gains flatten out. Use it after creating or heavily revising prompts, skills, command workflows, AGENTS sections, or code-generation instructions, especially when the failure mode may be ambiguous wording rather than missing capability.
---

# Empirical Prompt Tuning

The author of a prompt is a biased reader of that prompt.

This skill improves agent-facing instructions by having fresh executors run them, then evaluating the result from both sides:

- executor self-report
- instruction-side metrics

Keep iterating until the prompt stops producing meaningful gains.

## When to use

- right after creating or heavily revising a skill, slash command, task prompt, AGENTS section, or code-generation prompt
- when fresh-executor reports, retries, or discretionary fill-ins suggest instruction ambiguity
- when a prompt is reused across multiple tasks or agents, or when failures in that prompt are costly enough to justify measured evaluation

## When not to use

- disposable one-off prompts where the evaluation cost is not justified
- cases where the goal is only to reflect the author's taste rather than improve executor success
- environments where you cannot dispatch a fresh subagent

## Workflow

### 0. Iteration 0: static description-body alignment

Before any empirical run, compare the frontmatter `description` against the body.

- read the trigger and promise made by the description
- read what the body actually instructs the executor to do
- if they diverge, fix the description or the body before dispatching any executor

Skipping this step can create false positives because the executor may reinterpret the body through the description and appear to succeed for the wrong reason.

### 1. Prepare the evaluation design

Define the target prompt and prepare a frozen evaluation design with both of the following packets:

- **run packet**: the target prompt plus one scenario plus the task instructions, with no scoring checklist or rubric
- **scoring packet**: the frozen requirements checklist and scoring rules that will be applied after execution

Also prepare the evaluation scenarios:

- two or three realistic scenarios, usually one median case and one or two edge cases
- randomize the scenario order before dispatch
- if you compare two or more prompt variants, counterbalance the variant order across runs or blocks when order could matter
- if you compare prompt variants, freeze the scenario set and the block-level comparison rule before the first dispatch

Rules:

- mark at least one checklist item as `[critical]`
- freeze the checklist before evaluation
- do not change checklist items after seeing the result
- do not show the checklist to the executor during the run
- if multiple nuisance factors matter, block them rather than letting them leak into the run order

### 2. Use a fresh executor

Dispatch a new OpenCode subagent with the available subagent-dispatch tool for the current environment.

In OpenCode this normally means using the subagent dispatch mechanism such as the `task` tool to launch a fresh agent session with no prior conversational state.

Do not substitute self-rereading for a fresh executor.

Give the executor only the run packet. Do not include the scoring checklist or rubric in the executor prompt.

If multiple scenarios can be run independently, dispatch them in parallel.

If you are comparing prompt variants, keep the executor blind to which variant is the control and which is the revision.

### 3. Execute the scenario

Give the executor the target prompt plus the scenario and task instructions.

The executor should attempt the task normally and then return a structured report.

The report should capture open-ended observations first, before any scoring pass happens.

### 4. Evaluate from both sides

After the executor output is fixed, score it in a separate pass using the frozen scoring packet.

Prefer a fresh scorer session or a caller-side blinded review. The scorer should not see prompt-version labels until scoring is complete.
If the same person must both observe the executor and score it, keep the executor self-report hidden until the checklist score is final.

Record both:

- **executor self-report**: ambiguity, blocked interpretations, discretionary fill-ins, and retries
- **instruction-side metrics**:
  - success or failure
  - checklist pass rate
  - step count from dispatch usage metadata when available
  - duration from dispatch usage metadata when available
  - retry count from the executor report

Success rule:

- success is `○` only if every `[critical]` item is fully satisfied
- if any `[critical]` item is failed or only partially satisfied, the scenario result is `×`

Pass rate rule:

- `○` = 1
- `partial` = 0.5
- `×` = 0
- divide the sum by the number of checklist items

If a scenario fails, include a one-line note identifying which `[critical]` item failed and why.

### 5. Apply the smallest useful prompt change

Fix the most important ambiguity with the smallest prompt change that plausibly addresses it.

Keep each iteration focused on one theme.

Before applying the change, state which checklist items or decision thresholds the change is intended to improve.

### 6. Re-run with a fresh executor

Dispatch a new subagent and re-run the scenario.

Do not reuse the previous executor.

### 7. Stop when gains flatten out

Default heuristic stop condition:

- two consecutive iterations with no new ambiguities, and
- pass rate improvement of no more than 3 points, and
- step-count change within ±10% when metadata is available, and
- duration change within ±15% when metadata is available

For especially important prompts, require three consecutive clean iterations instead of two.

These thresholds are local starting heuristics, not externally validated constants. Adjust them when prompt importance or observed variance justifies it.

## Metrics and interpretation

Use qualitative feedback as the primary signal and quantitative metrics as supporting evidence.

### Core metrics

| Metric                 | How to collect it                               | Meaning                             |
| ---------------------- | ----------------------------------------------- | ----------------------------------- |
| Success / failure      | whether all `[critical]` items passed           | minimum bar                         |
| Pass rate              | checklist satisfaction percentage               | degree of partial success           |
| Steps                  | subagent-dispatch usage metadata when available | prompt efficiency and search burden |
| Duration               | subagent-dispatch usage metadata when available | proxy for executor load             |
| Retries                | executor self-report                            | ambiguity signal                    |
| Ambiguities            | executor self-report                            | direct improvement material         |
| Discretionary fill-ins | executor self-report                            | hidden unstated requirements        |

### Interpreting step count

High pass rate can still hide structural prompt weakness.

Compare step count across scenarios when the OpenCode subagent-dispatch mechanism reports it:

- if one scenario is three to five times heavier than the others, the prompt may be acting like a decision-tree index rather than a self-contained instruction
- a common cause is missing inline guidance or an unclear pointer for when to consult references

Use this signal to justify another iteration even when raw pass rate already looks strong.

### Expected effect patterns

Prompt edits do not affect metrics linearly.

Watch for three common patterns:

- **conservative effect**: the change improved fewer axes than expected
- **positive spillover**: one structural clarification improved multiple axes at once
- **zero effect**: the change sounded relevant but did not reach any actual decision threshold

To reduce guesswork, explicitly tie each proposed change to the checklist items or judgment thresholds it is meant to improve.

## Subagent launch contract

Use a prompt shaped like this:

```text
You are a fresh executor reading <target prompt name> with no prior context.

## Target prompt
<full prompt text, or a file path to read>

## Scenario
<one paragraph describing the situation>

## Task
1. Execute the scenario using the target prompt.
2. Return the report structure below.

## Report structure
- Deliverable: <artifact or concise execution summary>
- Ambiguities: places where the prompt was unclear or hard to interpret
- Discretionary fill-ins: decisions you made that the prompt did not settle
- Retries: how many times you re-did the same judgment and why
- Self-assessed uncertainty: where you were least certain and why
```

The caller should combine that report with any available OpenCode subagent-dispatch usage metadata to fill in the evaluation record.

## Blinded scoring packet

When you are ready to score, use a second prompt shaped like this:

```text
You are a fresh scorer reading an executor output with no prior context.

## Scenario
<one paragraph describing the situation>

## Executor output
<fixed executor output>

## Frozen scoring rubric
<the pre-registered checklist and scoring rules>

## Task
1. Score the output against the frozen rubric.
2. Return the report structure below.

## Report structure
- Checklist result: each item marked as ○ / × / partial, with reasons
- Success or failure: whether all [critical] items passed
- Pass rate: checklist satisfaction percentage
- Notes: any short scoring caveats
```

Do not reveal the prompt variant label to the scorer until scoring is complete.

## Environment constraints

If you cannot dispatch a fresh OpenCode subagent, do not pretend to do empirical tuning.

Allowed responses in that case:

- ask the user to run the evaluation in another session
- report `empirical evaluation skipped: dispatch unavailable`

Not allowed:

- replacing the fresh executor with self-rereading

### Structure-review mode

If you only need a static consistency review of prompt text, you may explicitly run **structure-review mode**.

In that mode, ask the subagent to inspect alignment, clarity, and contradictions in the text without executing the task itself.

Structure review is a useful supplement, but it is not a substitute for empirical execution and should not count toward the consecutive-clean stop condition.

## Reporting format

Record each iteration like this:

```text
## Iteration N

### Change from previous iteration
- <one-line summary>

### Scenario results
| Scenario | Success | Pass rate | steps | duration | retries |
|---|---|---|---|---|---|
| A | ○ | 90% | 4 | 20s | 0 |
| B | × | 60% | 9 | 41s | 2 |

### New ambiguities
- <Scenario B>: [critical] item N failed — <one-line reason>
- <Scenario B>: <other ambiguity>

### New discretionary fill-ins
- <Scenario B>: <executor-supplied judgment>

### Next prompt change
- <smallest next change>
```

## Red flags

- "I can just reread my own prompt" — no, that is not a fresh executor
- "One scenario is enough" — no, that overfits too easily
- "No ambiguities once means done" — require consecutive clean iterations
- "Let me fix everything at once" — keep one iteration focused on one theme
- "The metrics look fine so qualitative feedback does not matter" — qualitative ambiguity is the main signal
- "Let me reuse the same subagent" — no, use a fresh executor each time

## Expected inputs

- the target prompt or instruction text
- fixed evaluation scenarios
- fixed checklists with at least one `[critical]` item each
- access to an OpenCode subagent-dispatch mechanism that launches a fresh session, or an explicit decision to skip empirical tuning

## Expected outputs

- iteration records with scenario outcomes
- executor-reported ambiguities and discretionary fill-ins
- caller-side metrics when the environment exposes them
- a concise next change or an explicit stop decision

## Related skills

- `retrospective-codify`: for codifying lessons after a task is complete
- `code-review`: for reviewing implementation quality rather than instruction quality
