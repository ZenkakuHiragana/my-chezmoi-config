# prompt-failure-log.md

このファイルは、prompt failure の記録、暫定封じ込め、原因解析、恒久対策、有効性確認を管理するための軽量な台帳である。

## 基本方針

- まず事実を集める。
- 「観測されたこと」と「なぜ問題か」を分ける。
- 恒久対策の前に、必要なら暫定封じ込めを行う。
- 根本原因は後続の triage で分析する。
- failure は closed loop で管理し、最終的に verification result まで記録する。

## 記入ルール

### Current condition

- 実際に起きたことを、証拠ベースで書く。
- 評価語や意図推定は入れない。
- 「何が証拠として確認できるか」を短く書く。

### Target condition

- 本来どうあるべきだったかを書く。
- 期待挙動の根拠が明示できるなら notes に書く。
- 根拠が弱い場合は、その旨を notes に書く。

### Evidence

- 応答断片、差分、編集ファイル、未実行の行動、ログなどを記録する。
- 可能なら箇条書きで具体的に書く。

### Immediate containment

- いま再発を止めるための最小の暫定対応を書く。
- 恒久対策とは分ける。
- 暫定対応がない場合は `none` と書く。

### Suspected cause category

- 初期段階では原因を断定しない。
- 以下から最も近いものを選ぶ。
  - missing_rule
  - weak_wording
  - wrong_layer
  - duplicated_or_conflicting_rules
  - missing_validation
  - missing_research_gate
  - incomplete_task_contract
  - unknown

### Corrective action

- triage 後に書く。
- 以下の型を優先する。
  - reword
  - move_layer
  - merge_rules
  - split_rule
  - restore_missing_essential
  - add_minimal_new_rule

### Verification plan

- 何を見ればこの issue が解消されたと判断できるかを書く。

### Verification result

- pending / passed / failed のいずれかを書く。

## Status

- `observed`
  - failure を観測し、まだ封じ込めしていない
- `contained`
  - 暫定封じ込めを入れた
- `under_rca`
  - triage で原因解析中
- `corrective_action_defined`
  - 恒久対策が定義された
- `verified_closed`
  - 検証で解消が確認された

## Failure entry template

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

-

---
