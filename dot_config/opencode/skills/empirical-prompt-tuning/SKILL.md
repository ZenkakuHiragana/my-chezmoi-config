---
name: empirical-prompt-tuning
description: Use this skill to improve agent-facing instructions empirically by running blinded fresh subagents against a frozen evaluation design, scoring outputs with evidence-backed rubrics in a separate pass, and iterating until gains flatten out without hold-out regression. Use it after creating or heavily revising prompts, skills, command workflows, AGENTS sections, or code-generation instructions, especially when unexpected behavior may come from ambiguous wording rather than missing capability.
---

# Empirical Prompt Tuning

The author of a prompt is a biased reader of that prompt.

Fresh executors are still the core advantage of empirical prompt tuning, but that alone is not enough. Treat the workflow as a small controlled experiment:

- fresh executors are the subjects
- scenarios are the stimuli
- prompt variants are the conditions
- separate scorers judge outputs against frozen requirements

The goal is not academic purity. The goal is to make instruction changes more trustworthy than self-rereading, vibes, or after-the-fact rationalization.

## When to use

- right after creating or heavily revising a skill, slash command, task prompt, AGENTS section, or code-generation prompt
- when fresh-executor behavior suggests the problem may be ambiguous wording rather than missing capability
- when a prompt is reused across many tasks or agents, or when prompt failures are costly enough to justify repeated evaluation

## When not to use

- disposable one-off prompts where the evaluation cost is not justified
- cases where the goal is only to reflect the author's taste rather than improve executor success
- environments where you cannot dispatch a fresh subagent

## Core principles

### 1. Freeze the evaluation design before the run

Do not tune by moving the scenario, checklist, or stop rule after seeing the current failure.

Before the first empirical run, freeze:

- the target prompt
- the failure modes you want to improve
- which task types are in scope and out of scope
- the scenario set
- the requirements checklist for each scenario
- which items are `[critical]`
- the scoring rules
- the repeat count
- the randomization or counterbalancing rule
- the stop and adoption rules

If you must change any of these after seeing results, version the plan and restart the baseline.

### 2. Keep executors blind

The executor should receive only the run packet:

- target prompt
- scenario
- required input files or paths
- output format

Do not show the executor:

- the scoring checklist
- the prompt-version label if variants are being compared
- the intended improvement for the current iteration
- the expected failure mode
- previous executor outputs

### 3. Separate execution from scoring

Executor self-report is useful qualitative data, but it is not the final pass or fail judgment.

Whenever possible, use a separate scorer that only sees:

- the scenario
- the frozen scoring packet
- the fixed deliverable and admissible evidence

Do not show the scorer:

- the prompt-version label until scoring is complete
- the intended improvement for the iteration
- the executor self-assessment before the score is final

### 4. Score requirement by requirement, with evidence

Prefer requirement-level, evidence-backed scoring over global impressions.

If a claimed behavior is not explicit in the deliverable or admissible execution evidence, do not count it as satisfied.

### 5. Repeat, then generalize

Single runs are too noisy to trust.

Run repeated trials on the same validation scenarios with fresh executors each time, then confirm that the result survives on hold-out scenarios that were not used during tuning.

## Workflow

### 0. Iteration 0: static description-body alignment

Before any empirical run, compare the frontmatter `description` against the body.

- read the promise made by the description
- read what the body actually instructs the caller to do
- if they diverge, fix the description or the body before dispatching any executor

Skipping this step creates false positives because the executor may reinterpret the body through the description and appear to succeed for the wrong reason.

### 1. Freeze an experiment plan

Create a frozen experiment plan before the first dispatch.

For routine prompt work, a lightweight plan is enough.
For high-importance prompts, use the fuller split and repeat structure below.

Minimum plan fields:

```text
experiment-plan
- target prompt
- failure modes to improve
- included task types
- excluded task types
- scenario set or scenario split
- per-scenario requirements checklist
- [critical] labels
- scoring rules
- repeat count per prompt version × scenario
- randomization or counterbalancing rule
- comparison rule
- stop rule
- adoption rule
- what may still change after freeze
```

Rules:

- freeze the plan before the first empirical run
- do not change checklist items after seeing the result
- do not move `[critical]` labels after seeing the result
- do not tune scenarios to fit the current patch

### 2. Prepare the scenario set

At minimum, use two or three fixed scenarios.

For important prompts, split the scenario pool like this:

- **train**: scenarios you may inspect closely while designing fixes
- **validation**: scenarios you re-run every iteration without changing them
- **hold-out**: scenarios you do not use for tuning and only check near adoption

Reasonable starting sizes for important prompts:

- train: 3 to 5 scenarios
- validation: 3 to 5 scenarios
- hold-out: 3 to 5 scenarios

When possible, cover more than one scenario type:

- typical median case
- edge case
- information-missing case
- tool-heavy case
- known failure-prone case
- should-not-use case when misuse matters

Avoid ceiling and floor scenarios. If everything passes trivially or everything fails catastrophically, the run produces little signal.

### 3. Build the run packet and scoring packet

Prepare two separate packets.

- **run packet**: the target prompt, one scenario, required inputs, and output instructions
- **scoring packet**: the frozen requirements checklist, scoring rules, `[critical]` labels, and any admissible evidence rules

The executor gets the run packet only.
The scorer gets the scoring packet only after the executor output is fixed.

### 4. Use fresh blinded executors

Dispatch a new OpenCode subagent for every run.

In OpenCode this normally means using the subagent dispatch mechanism such as the `task` tool to launch a fresh agent session with no prior conversational state.

Rules:

- do not substitute self-rereading for a fresh executor
- do not reuse the same executor across iterations
- do not reuse the same executor across prompt variants in a comparison
- if scenarios are independent, run them in parallel

If prompt variants are being compared:

- anonymize the variants as A and B
- randomize or counterbalance variant order when order could matter
- randomize scenario order across runs when feasible

### 5. Execute the scenario

The executor should attempt the task normally and then return a structured report.

The report should capture observations first, before any scoring pass happens.

Record at least:

- deliverable
- execution summary
- ambiguities
- discretionary fill-ins
- blocked areas
- retries
- self-assessed uncertainty

### 6. Score in a separate blinded pass

After the executor output is fixed, score it in a separate pass using the frozen scoring packet.

Preferred order of rigor:

1. fresh scorer session
2. caller-side blinded review with the executor self-report hidden until scoring is complete

Do not use executor self-scoring as the final pass or fail decision.

Use requirement-level evidence records in a structure like this:

```json
{
  "requirement_id": "R3",
  "judgment": "pass | partial | fail",
  "evidence": "quoted or summarized evidence from the artifact or admissible logs",
  "missing": "what is absent when judgment is not pass",
  "confidence": "high | medium | low"
}
```

Success rule:

- a scenario is `success` only if every `[critical]` requirement is `pass`
- if any `[critical]` requirement is `partial` or `fail`, the scenario result is `failure`

Pass-rate rule:

- `pass` = 1
- `partial` = 0.5
- `fail` = 0
- divide the sum by the number of requirements

If a scenario fails, record which `[critical]` requirement failed and why.

### 7. Compare variants and inspect disagreement

Look at both execution quality and scoring stability.

Primary signals:

- critical pass rate
- requirement-level pass rate
- blocked-run rate
- new ambiguities
- new discretionary fill-ins

Supporting signals:

- median `tool_uses`
- median `duration_ms`
- median retry count when available
- output length when it helps detect suspiciously thin answers

For prose-heavy outputs, supplement checklist scoring with paired comparison:

- same scenario
- same admissible evidence
- anonymized output A and B
- randomized display order

Ask the scorer to choose one of:

- A
- B
- no material difference

and to cite the deciding requirement IDs.

If the rubric is subjective or the prompt is important, score the same output with two or three scorers.

Treat scorer disagreement as a signal that at least one of these is ambiguous:

- the requirement wording
- the scoring rule
- the artifact itself

### 8. Apply the smallest useful prompt change

Fix the most important ambiguity with the smallest prompt change that plausibly addresses it.

Keep each iteration focused on one coherent theme.

Before applying the change, state which requirements or decision thresholds the change is intended to improve.

### 9. Re-run with fresh executors

Re-run the same validation scenarios, with the same scoring packet and the same repeat count.

Do not claim improvement from a one-off rerun on a changed scenario.

Suggested repeat counts:

- routine prompt: 2 runs per prompt version × validation scenario
- important prompt: 3 to 5 runs per prompt version × validation scenario

### 10. Stop, hold out, and decide

Default stop heuristic for routine prompts:

- two consecutive iterations with no important new ambiguities on validation, and
- critical pass rate not worse than the previous best, and
- pass-rate improvement no more than 3 points, and
- median `tool_uses` change within ±10% when available, and
- median `duration_ms` change within ±15% when available

For important prompts, prefer a stricter end condition:

- three consecutive clean iterations, then
- a hold-out check before adoption

Practical adoption heuristic:

- validation critical pass rate is at least as good as the baseline
- total validation score improves meaningfully, or stays comparable while execution burden drops materially
- critical failures do not increase
- scorer disagreement does not increase materially
- hold-out performance does not collapse relative to recent validation results

If hold-out drops sharply, suspect overfitting and return to scenario design rather than patching blindly.

These thresholds are local heuristics, not universal statistical constants. Adjust them when prompt importance or observed variance justifies it.

## Metrics and interpretation

Use qualitative ambiguity reports as the primary signal and quantitative metrics as supporting evidence.

### Core metrics

| Metric                 | How to collect it                                  | Meaning                             |
| ---------------------- | -------------------------------------------------- | ----------------------------------- |
| Critical pass rate     | fraction of runs where all `[critical]` items pass | minimum safety bar                  |
| Requirement pass rate  | scored checklist percentage                        | degree of partial success           |
| Blocked-run rate       | executor reports or incomplete runs                | operational failure signal          |
| Scorer disagreement    | compare scorers on the same artifact               | rubric or artifact ambiguity        |
| Steps                  | subagent-dispatch usage metadata when available    | prompt efficiency and search burden |
| Duration               | subagent-dispatch usage metadata when available    | proxy for executor load             |
| Retries                | executor self-report                               | ambiguity signal                    |
| Ambiguities            | executor self-report                               | direct improvement material         |
| Discretionary fill-ins | executor self-report                               | hidden unstated requirements        |

### Interpreting step count and duration

High pass rate can still hide structural prompt weakness.

Compare step count and duration only across the same scenario set and comparable repeat structure.

Useful warning patterns:

- one scenario is three to five times heavier than the others
- a revision lowers time but increases missing evidence in the deliverable
- the output gets shorter while scorer confidence or requirement coverage gets worse

These often mean the prompt became thinner, not better.

### Interpreting disagreement

If scorers split on the same artifact, do not jump straight to prompt blame.

Ask whether the ambiguity is in:

- the requirement text
- the scoring rule
- the admissible evidence rule
- the artifact itself

Sometimes the right fix is to clarify the rubric before changing the prompt again.

## Executor launch contract

Use a prompt shaped like this:

```text
You are a fresh executor reading <target prompt name> with no prior context.

## Target prompt
<full prompt text, or a file path to read>

## Scenario
<one paragraph describing the situation>

## Required inputs
<paths, files, or inputs the executor may use>

## Task
1. Execute the scenario using the target prompt.
2. Return the report structure below.

## Report structure
- Deliverable: <artifact or concise execution summary>
- Execution summary: <what you did>
- Ambiguities: places where the prompt was unclear or hard to interpret
- Discretionary fill-ins: decisions you made that the prompt did not settle
- Blocked areas: places where the task could not be completed cleanly
- Retries: how many times you re-did the same judgment and why
- Self-assessed uncertainty: where you were least certain and why
```

Do not give the executor the scoring packet.

## Scorer launch contract

When you are ready to score, use a second prompt shaped like this:

```text
You are a fresh scorer reading an executor output with no prior context.

## Scenario
<one paragraph describing the situation>

## Executor output
<fixed executor output>

## Admissible evidence
<diff, test output, command output, or 'none'>

## Frozen scoring packet
<the pre-registered checklist, [critical] labels, and scoring rules>

## Task
1. Score the output against the frozen packet.
2. Return the report structure below.

## Report structure
- Requirement results: <JSON array with requirement_id, judgment, evidence, missing, confidence>
- Critical summary: <which [critical] items passed or failed>
- Scenario success: <success or failure>
- Pass rate: <percentage>
- Scoring caveats: <short notes only>
```

Do not reveal the prompt variant label to the scorer until scoring is complete.

## Paired comparison contract

For prose-heavy outputs or close decisions, you may use an additional paired-comparison scorer:

```text
You are a fresh scorer comparing two outputs for the same scenario.

## Scenario
<one paragraph describing the situation>

## Output A
<artifact A>

## Output B
<artifact B>

## Frozen scoring packet
<requirements checklist and comparison rule>

## Task
Choose exactly one of: A, B, no material difference.
Then cite the deciding requirement IDs and explain the choice briefly.

## Report structure
- Choice: A | B | no material difference
- Confidence: high | medium | low
- Deciding requirements: <ids>
- Reason: <short explanation>
```

Randomize whether the better candidate appears as A or B.

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

Structure review is a useful supplement, but it is not a substitute for empirical execution and should not count toward the stop condition.

## Reporting format

Record each iteration like this:

```text
## Iteration N

### Change from previous iteration
- <one-line summary>

### Validation summary
| Scenario | Runs | Critical pass rate | Pass rate | median steps | median duration | blocked rate |
|---|---:|---:|---:|---:|---:|---:|
| A | 2 | 100% | 92% | 4 | 20s | 0% |
| B | 2 | 50% | 68% | 9 | 41s | 50% |

### New ambiguities
- <Scenario B>: [critical] item R2 failed — <one-line reason>
- <Scenario B>: <other ambiguity>

### New discretionary fill-ins
- <Scenario B>: <executor-supplied judgment>

### Scorer disagreement
- <Scenario B / R3>: scorer 1 = pass, scorer 2 = partial — <one-line explanation>

### Next prompt change
- <smallest next change>
```

If a hold-out run was performed, report it separately from validation.

## Red flags

- "I can just reread my own prompt" — no, that is not a fresh executor
- "One scenario is enough" — no, that overfits too easily
- "One run is enough" — no, single runs are too noisy
- "The executor already said it passed" — self-report is not final scoring
- "I can show the rubric to the executor" — that changes the task
- "I can reveal the revision label to the scorer" — that biases the score
- "Let me fix the rubric after seeing the output" — version the plan and restart instead
- "Let me reuse the same subagent" — no, use a fresh executor each time
- "The average score improved, so the new critical failures are fine" — no, critical regressions block adoption
- "The output is shorter, so the prompt is better" — shorter can mean thinner or less evidenced

## Expected inputs

- the target prompt or instruction text
- a frozen experiment plan or enough material to create one before execution
- fixed scenarios or a fixed scenario split
- fixed checklists with at least one `[critical]` item when success or failure matters
- access to an OpenCode subagent-dispatch mechanism that launches a fresh session, or an explicit decision to skip empirical tuning

## Expected outputs

- iteration records with repeated-run scenario outcomes
- executor-reported ambiguities and discretionary fill-ins
- evidence-backed scoring records
- caller-side metrics when the environment exposes them
- a concise next change, stop decision, or adoption decision

## Related skills

- `technical-writing`: for polishing the structure and reader fit of the prompt text itself
- `retrospective-codify`: for codifying lessons after the task is complete
- `code-review`: for reviewing implementation quality rather than instruction quality
