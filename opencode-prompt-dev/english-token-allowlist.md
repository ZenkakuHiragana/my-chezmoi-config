# 英語維持語彙の基準

## 目的

プロンプト、コマンド、エージェント、スキルの本文では、機械的な一致や運用上の分類に必要な英語だけを残す。
ここにない英語は、説明上どうしても必要な場合を除き、日本語化する。

## 判定順序

1. パス、ファイル名、URL、コマンド名、スキル名、エージェント名、ツール名は残す。
2. スキーマフィールド、フロントマターのキー、`status` 値、`severity` 値、固定の出力ラベルは残す。
3. コード、テンプレート、引用、ユーザー入力、外部仕様の正式名称は残す。
4. この文書の「維持する制御語彙」にある語は、機械的に照合される文字列として使う場合だけ残す。
5. それ以外の英語は、日本語で意味が落ちないなら日本語化する。

## 新たな制御語彙を作る条件

新たな語、フィールド、スキーマ名を作る前に、平易な日本語で展開できるかを先に確認する。
新たな語、フィールド、スキーマ名を作ってよいのは、次をすべて満たすときに限る。

1. 複数のプロンプト、コマンド、エージェント、スキル、成果物、スキーマで、厳密に同じ意味・対象として参照する必要がある。
2. 平易な日本語に展開すると、意味、境界、所有者、検査方法のいずれかがぶれる。
3. 値域、責務、所有者、検査方法を短く定義できる。
4. 実行エージェントが読む AGENTS.md、スキル、コマンド用プロンプト、または対象スキーマに定義を置ける。
5. `check_vocabulary.py` で未登録使用を検出できる。

次に当てはまる語、フィールド、スキーマ名は作ってはならない。

- 一文で平易に展開できる語。
- 人間向け説明だけに使う語。
- 固定フィールドではない見出し、評価軸、整理ラベル。
- 既存語の言い換えで足りる語。

## 維持する制御語彙

### 基本面

- `description`
- `ast-grep`
- `chezmoi source-path`

### プロンプト運用

- `work_class`
- `mode_constraint`
- `side_effect_mode`
- `execution_route`
- `task_kind`
- `goal`
- `scope`
- `inputs`
- `constraints`
- `read_set`
- `write_set`
- `must_not_do`
- `evidence_required`
- `output_schema`
- `verification_hint`
- `stop_conditions`
- `join_instructions`
- `chosen_skills`
- `why_this_choice`
- `result`
- `evidence`
- `verification_performed`
- `risks_or_unknowns`
- `next_action`
- `severity`

### 状態値と分類値

過去ログ、失敗の選別と介入判断レポート、作業台帳の状態値として照合する。

- `unknown`
- `accepted`
- `rejected`
- `no-decision`
- `resolved`
- `needs-investigation`
- `out-of-scope`
- `repo_derivable`
- `public_fact`
- `user_provided`
- `confirmed`
- `not_needed`
- `missing`
- `blocked`
- `ready_for_exit_check`
- `RR-CONTRACT-1`
- `reset_required`
- `rollback_required`
- `user_decision`
- `subsystem_derivable`
- `contract_gap`
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
- `low`
- `medium`
- `high`
- `critical`
- `read_only`
- `write_ok`
- `true`
- `false`
- `skip`
- `needs_manual_review`
- `none`
- `current`
- `legacy`
- `captured`
- `obsolete`
- `strong`
- `weak`
- `unclear`
- `tiny-local`
- `bounded`
- `broad-or-unclear`
- `escalate_to_write_ok`
- `needs_parent_clarification`

### 失敗記録スキーマ値

- `observed_prompt_context`
- `observed_system_sha`
- `current_system_sha`
- `current_coverage`
- `coverage_evidence`
- `regression_needed`
- `problem_classes`
- `P1`
- `P2`
- `P3`
- `P4`
- `P5`
- `create_historical_note`
- `create_incident`
- `create_regression_scenario`

### プロンプト改善アクション値

- `add_minimal_new_rule`
- `restore_missing_essential`
- `reword_existing_rule`
- `merge_overlapping_rules`
- `split_overloaded_rule`
- `move_to_different_layer`

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

実験設定で機械的に照合する分割名として使う。

- `train`
- `validation`
- `hold-out`

### スキル / エージェント / レビュー固定名

- `code-review`
- `review-response`
- `review-orchestration`
- `context-clarification`
- `empirical-prompt-tuning`
- `extract-failure-patterns`
- `general-fast`
- `general-strong`
- `grill-me`
- `investigation`
- `japanese-doc-review`
- `public-research`
- `report-failure`
- `requirement-review`
- `task-planning`
- `technical-writing`

## 日本語化する語

次の用途の英語は原則として日本語化する。

- 説明文の一般語
- 見出しだけの一般語
- 手順を飾るだけの英語句
- 固定フィールドではない評価軸名
- 「制御語彙っぽい」だけで文字列一致に使わない語

## 迷う場合

- 機械的に照合されるなら残す。
- 人間向け説明だけなら日本語化する。
- 残す場合は、近くに日本語の意味を添える。
