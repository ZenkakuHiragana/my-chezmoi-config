# 制御語彙

## 目的

プロンプト、コマンド、エージェント、スキル本文で、機械的な一致や運用上の分類に必要な語彙の棚卸し。
文字列照合は言語非依存なので、外部コードと一致する語だけ英語のまま維持し、それ以外の制御語彙はバックティックで囲んだ日本語で表す。

## 判定順序

1. パス、ファイル名、URL、コマンド名、スキル名、エージェント名、ツール名は残す。
2. テンプレート変数（chezmoi の `{{ ... }}` 等）はコードと一致させるため残す。
3. スキーマフィールド、フロントマターのキー、`status` 値、`severity` 値、固定の出力ラベルは残す。
4. コード、テンプレート、引用、ユーザー入力、外部仕様の正式名称は残す。
5. この文書の「維持する制御語彙」にある語は、機械的に照合される文字列として使う場合だけ残す。
6. それ以外の制御語彙は日本語で表し、バックティックで囲む。英語である必要はない。

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

### 外部コードと一致する語（英語維持）

- 文脈状態: `confirmed` / `not_needed` / `missing` / `blocked`
- 不足の分類: `user_decision` / `repo_derivable` / `subsystem_derivable` / `public_fact` / `contract_gap`
- 必要根拠種別: `user_provided`（`repo_derivable` / `subsystem_derivable` / `public_fact` / `contract_gap` は不足の分類と同じ）
- 検査ID: `RR-CONTRACT-1`（`RR-OBL-<連番>` も同形式で英語維持）
- 失敗記録スキーマ値: `observed_prompt_context` / `observed_system_sha` / `current_system_sha` / `current_coverage` / `coverage_evidence` / `regression_needed` / `problem_classes` / `P1` / `P2` / `P3` / `P4` / `P5` / `create_historical_note` / `create_incident` / `create_regression_scenario`
- 状態値と分類値: `unknown` / `active_gap` / `covered_but_unvalidated` / `likely_addressed` / `obsolete_context` / `covered_unvalidated` / `current_gap` / `historical_candidate` / `triaged` / `corrective_action_defined` / `validation_needed` / `verified_closed` / `partial` / `low` / `medium` / `high` / `critical` / `true` / `false` / `skip` / `needs_manual_review` / `none` / `current` / `legacy` / `captured` / `obsolete` / `strong` / `weak` / `unclear` / `escalate_to_write_ok` / `needs_parent_clarification` / `severity`
- 介入種別: `prompt_surface_change` / `command_prompt_change` / `skill_change` / `agent_routing_change` / `artifact_schema_change` / `hook_or_plugin_change` / `harness_change` / `regression_validation_only` / `no_change`
- プロンプト改善アクション値: `add_minimal_new_rule` / `restore_missing_essential` / `reword_existing_rule` / `merge_overlapping_rules` / `split_overloaded_rule` / `move_to_different_layer`
- 検証と実験: `train` / `validation` / `hold-out`
- 汎用サブエージェントの返答形式: `result` / `evidence` / `verification_performed` / `risks_or_unknowns` / `next_action`
- 作業票の追加フィールド: `chosen_skills` / `why_this_choice` / `side_effect_mode` / `execution_route` / `task_kind`
- 実行経路とフィクスチャ値: `derive` / `survey_only` / `target_selection_status` / `mode_constraint` / `read_only` / `pass` / `fail`
- パネル運用の固定名: `panel packet` / `evidence file` / `known gaps` / `source_id` / `None` / `user-specified` / `literal-match` / `explicit-reference`
- ツール名とパラメータ: `glob` / `grep` / `webfetch` / `write` / `read` / `task` / `pattern` / `path`
- 設定キーとスキーマフィールド: `status` / `name` / `agent`
- スキル / エージェント / レビュー固定名: `claim-grounding` / `code-review` / `derive-fixture-variants` / `review-response` / `review-orchestration` / `context-clarification` / `empirical-prompt-tuning` / `extract-failure-patterns` / `general-fast` / `general-strong` / `grill-me` / `japanese-doc-review` / `refactoring` / `report-failure` / `requirement-reviewer` / `review-audit` / `task-planning` / `technical-writing`
- 基本: `description` / `ast-grep` / `chezmoi source-path`

### 日本語の制御語彙

- 手続きの結果: `合格` / `不合格` / `判定不能`
- 指摘の分類: `採用` / `却下` / `要調査` / `対象外`
- 準備完了の判定: `判定結果` / `仮定付き合格`
- 作業分類（旧 work_class）: `単発` / `限定` / `広域`
- 実行モード（旧 mode_constraint）: `読み取り専用` / `書き込み可`
- 作業票の項目: `作業分類` / `実行モード` / `目的` / `範囲` / `入力` / `読取可能` / `編集可能` / `制約` / `禁止事項` / `必要な根拠` / `出力形式` / `検証のヒント` / `停止条件` / `統合方法`
- 検査結果の3値: `反例未確認` / `破綻確認` / `破綻`
- 契約と指摘の項目: `要件契約` / `要件契約候補` / `準備完了記録` / `依頼引用` / `明示要求` / `不変条件` / `受け入れ条件` / `保つ条件` / `侵害する条件` / `該当なし` / `なし`
- 文脈の用語: `作業段階` / `文脈状態`
- レビューの項目: `検査項目`
- 出力契約のフィールド: `必要な結果` / `対象範囲` / `判別対象` / `判断と認可` / `結果を生む実経路` / `観測する結果と判別対象` / `利用者または情報所有先`
- 意味差分: `削除する意味` / `保持する意味` / `追加する意味`
- 状態値: `仮定` / `判断保留` / `既存と重複` / `既存追記` / `新規` / `未作成`
- 根拠接地の判定: `支持` / `反証` / `未決`
- 根拠接地の記録: `候補ID` / `問い` / `質問種別` / `予想所有先` / `接触範囲の宣言` / `既知の根拠` / `情報源` / `所有関係` / `到達手段` / `探索手続き` / `操作` / `操作の逐語` / `宣言範囲` / `到達した停止条件` / `取得状態` / `得た内容` / `接触余剰` / `制限` / `次の行動` / `存在` / `内容` / `状態` / `存在かつ権威あり` / `存在かつ権威なし` / `不在かつ探索完了` / `不在かつ探索未了`

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
