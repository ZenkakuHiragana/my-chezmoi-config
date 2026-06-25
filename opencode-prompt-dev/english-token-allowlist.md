# 英語維持語彙の棚卸し

## 目的

プロンプト、command、agent、skill の本文では、機械的な一致や運用上の分類に必要な英語だけを残す。
ここにない英語は、説明上どうしても必要な場合を除き、日本語化する。

## 判定順序

1. path、file 名、URL、command 名、skill 名、agent 名、tool 名は残す。
2. schema field、frontmatter key、status 値、severity 値、固定の出力ラベルは残す。
3. code、template、引用、ユーザー入力、外部仕様の正式名称は残す。
4. この文書の「維持する制御語彙」にある語は残す。
5. それ以外の英語は、日本語で意味が落ちないなら日本語化する。

## 維持する制御語彙

### 基本面

- `prompt`
- `command`
- `agent`
- `skill`
- `tool`
- `hook`
- `plugin`
- `harness`
- `artifact`
- `schema`
- `field`
- `template`
- `frontmatter`
- `description`
- `routing`
- `router`
- `privacy`
- `security`
- `reasoning-effort`
- `handoff`
- `workflow`
- `triage`
- `config`
- `repository`
- `runtime`
- `model`
- `profile`
- `reference`
- `ast-grep`
- `chezmoi source-path`

### プロンプト運用

- `task frame`
- `task contract`
- `work_class`
- `mode_constraint`
- `side_effect_mode`
- `execution_route`
- `task_kind`
- `capability`
- `capability set`
- `capability pack`
- `prompt surface`
- `source coverage`
- `source policy`
- `evidence standards`
- `validation target`
- `validation strategy`
- `completion check`
- `acceptance criteria`
- `verification method`
- `output schema`
- `assignment packet`
- `Requirement contract`
- `Readiness record`
- `Parallel group`
- `Parallel basis`
- `Execution`
- `Side effect mode`
- `Decision Quality`
- `DQ`
- `DQ Weak Elements`
- `Blocking unknowns`
- `Sources and References`

### 状態値と分類値

- `unknown`
- `repo_derivable`
- `public_fact`
- `user_provided`
- `confirmed`
- `not_needed`
- `missing`
- `blocked`
- `user_decision`
- `subsystem_derivable`
- `contract_gap`
- `implementation_discretion`
- `pass_with_assumption`
- `active_gap`
- `covered_but_unvalidated`
- `likely_addressed`
- `obsolete_context`
- `covered_unvalidated`
- `current_gap`
- `historical_candidate`
- `triaged`
- `corrective_action_defined`
- `validation_needed`
- `verified_closed`
- `pass`
- `partial`
- `fail`
- `draft`
- `active`
- `superseded`
- `done`
- `low`
- `medium`
- `high`
- `critical`
- `None`
- `read_only`
- `write_ok`
- `true`
- `false`
- `skip`
- `no findings`
- `needs_manual_review`

### 失敗記録 schema 値

- `create_historical_note`
- `create_incident`
- `create_regression_scenario`

### 介入種別

- `prompt_surface_change`
- `command_prompt_change`
- `skill_change`
- `agent_routing_change`
- `artifact_schema_change`
- `hook_or_plugin_change`
- `harness_change`
- `regression_validation_only`
- `no_change`

### 検証と実験

- `baseline`
- `train`
- `validation`
- `hold-out`
- `scoring`
- `score`
- `critical labels`
- `A/B`

## 日本語化する語

次の用途の英語は原則として日本語化する。

- 説明文の一般語
- 見出しだけの一般語
- 手順を飾るだけの英語句
- 固定 field ではない評価軸名
- 「制御語彙っぽい」だけで文字列一致に使わない語

例:

- `failure modes` → 失敗の型
- `current system` → 現行システム
- `prompt edit` → プロンプト編集
- `global rule` → 共有規則
- `behaviorally meaningful instruction` → 挙動上意味のある指示
- `required output` → 必須出力
- `private` → 非公開

## 迷う場合

- 機械的に照合されるなら残す。
- 人間向け説明だけなら日本語化する。
- 残す場合は、近くに日本語の意味を添える。
