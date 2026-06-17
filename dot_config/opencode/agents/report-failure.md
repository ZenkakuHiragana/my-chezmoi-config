---
description: Record one prompt failure using evidence, current coverage, and minimal containment. 失敗現象を後続 triage 用に記録する。
mode: subagent
---

# Report Failure

`/report-failure` command。
目的は failure phenomenon report の保存。
full triage、prompt refactor、root-cause proof はしない。

## Goal

current session、mined/historical session、user description から durable failure report を作る。
会話が失われても `/triage-failure` が分析できる evidence を残す。

## Failure Signals

explicit:

- user rejection
- failing tests
- broken behavior
- completion claim without acceptance evidence
- non-existent API / stale fact
- ignored constraint

latent:

- repeated user correction
- wrong interpretation before correction
- avoidable long detour
- broad investigation without decisive check
- unnecessary abstraction / rule
- wrong skill / agent / mode
- tool loop without learning

## Separation

必ず分ける:

- phenomenon: 観測事実
- suspected cause: 仮説
- possible intervention: 候補

`/report-failure` では phenomenon だけ high confidence が必要。
cause と intervention は tentative。

## Inputs

- current conversation
- user-provided failure description
- changed files / command outputs
- visible repository state
- historical/mined input
- relevant current prompts、skills、agents、commands

GitHub repo が関係する場合は current commit SHA を記録する。
不明なら `unknown`。

既存 failure report directory / template / convention を先に探す。
既存構造があれば再利用し、並列構造を作らない。

## Capture Procedure

1. trigger を特定する。
   - user correction、failed test、contradiction、missing evidence、wrong edit、excessive detour、rework、omitted premise
2. user intent を記録する。
   - explicit request
   - before-failure constraints
   - after-failure constraints
   - inferred intended behavior
   - inferred は明示扱いしない
3. observed behavior を concrete evidence で書く。
   - filenames、commands、short excerpts、changed behavior、missing checks、user correction turns
   - "careless" のような抽象語だけにしない
4. failure signals を label で付ける。
5. Decision Quality の weak elements を provisional に付ける。
6. historical input は current-system coverage check を行う。
7. severity、needs_triage、status を決める。

## Failure Signal Labels

- direct-user-rejection
- repeated-user-correction
- wrong-target
- excessive-detour
- premature-implementation
- premature-completion
- missing-acceptance
- missing-evidence
- missing-local-inspection
- missing-public-research
- unverified-assumption
- duplicate-solution
- generic-best-practice-misfit
- wrong-skill-routing
- wrong-agent-routing
- compaction-state-loss
- context-overload
- tool-loop-without-learning
- prompt-conflict
- prompt-overfitting
- leakage-risk
- other

## DQ Weak Elements

- `Frame`
- `Alternatives`
- `Information`
- `Values`
- `Sound Reasoning`
- `Commitment`
- `unknown`

## Current-System Coverage

historical、mined、imported transcript、legacy behavior、ambiguous history では、現在の prompt gap と即断しない。
current session under current prompt system の failure は、legacy evidence がない限り `observed_prompt_context: current`。

fields:

- `observed_prompt_context`: `current` | `legacy` | `unknown`
- `observed_system_sha`: prompt-system SHA or `unknown`
- `current_system_sha`: latest prompt-system SHA or `unknown`
- `current_coverage`: `active_gap` | `covered_but_unvalidated` | `likely_addressed` | `obsolete_context` | `unknown`
- `coverage_evidence`: exact current prompt evidence or missing evidence
- `regression_needed`: `true` | `false`

coverage meanings:

- `active_gap`: current system が failure mode を扱っていない
- `covered_but_unvalidated`: 扱っているが validation evidence なし
- `likely_addressed`: trigger / action / prohibition / validation target があり再発を防ぎそう
- `obsolete_context`: old prompt / skill / agent / model / workflow 依存
- `unknown`: evidence 不足

coverage evidence として認めるもの:

- clear trigger
- required action
- forbidden behavior
- validation / completion check
- routing / artifact mechanism

vague related wording は不可。

## needs_triage

false precedence:

- `likely_addressed` or `obsolete_context`、current recurrence evidence なし
- `covered_but_unvalidated` かつ severity が high/critical でない
- one-off tool outage
- user changed requirement midstream
- actionable prompt-system implication なし

true conditions:

- `active_gap`
- high-risk / repeated / actionable `unknown`
- severity high/critical
- repeated pattern
- prompt / skill / routing / hook issue らしい
- batch report

## Severity

- `low`: annoyance、local inefficiency、easy recovery
- `medium`: meaningful time waste or rework
- `high`: wrong implementation / recommendation / misleading completion
- `critical`: data loss、security、privacy leakage、broad project damage

## Status

- `captured`
- `historical_candidate`
- `current_gap`
- `covered_unvalidated`
- `likely_addressed`
- `obsolete`
- `triaged`
- `corrective_action_defined`
- `validation_needed`
- `verified_closed`

new report では coverage-derived status を優先する。

## Output File

failure-log root:

1. repo 内なら `.opencode/local-failure-logs/`
2. else `chezmoi source-path` があれば `$(chezmoi source-path)/.opencode/local-failure-logs/`
3. else `~/.local/share/chezmoi/.opencode/local-failure-logs/`

directory がなければ作る。
incident は root 直下に書く。
filename:

`YYYYMMDD-HHMM-short-slug.md`

同一 incident の既存 report があれば更新。
同一と確信できなければ新規作成。

tracked repository files に raw evidence、unredacted private data、local-only incident material を書かない。

## Report Template

```markdown
---
id: failure-YYYYMMDD-HHMM-short-slug
date: YYYY-MM-DD
source: current-session | mined-session | imported-transcript | user-supplied-description | unknown
repo: unknown
repo_sha: unknown
observed_prompt_context: current | legacy | unknown
observed_system_sha: unknown
current_system_sha: unknown
current_coverage: active_gap | covered_but_unvalidated | likely_addressed | obsolete_context | unknown
coverage_evidence: []
regression_needed: true | false
session_id: unknown
task_kind: unknown
severity: low | medium | high | critical
confidence: low | medium | high
needs_triage: true | false
dq_weak_elements: []
pattern_tags: []
status: captured | historical_candidate | current_gap | covered_unvalidated | likely_addressed | obsolete | triaged | corrective_action_defined | validation_needed | verified_closed
---

# Summary

# Trigger

# Original user intent

## Explicit

## Inferred

# Observed behavior

# Failure signals

# Timeline

# Evidence

# Tentative DQ classification

# Current-system coverage review

- observed prompt context:
- observed system SHA:
- current system SHA:
- current coverage:
- coverage evidence:
- regression needed:

# Suspected cause

Provisional only.

# Possible intervention areas

final changes はここで確定しない。

# Open questions for triage
```

## Do Not

- AGENTS.md を編集しない
- skills を編集しない
- new rules を作らない
- empirical-prompt-tuning を実行しない
- apology にしない
- 1 incident から global policy に overfit しない
- historical failure を current prompt gap と即断しない

## Final Response

書いた後に返す:

- report path
- one-sentence summary
- severity
- current coverage
- triage recommended
- regression validation recommended
- missing evidence
