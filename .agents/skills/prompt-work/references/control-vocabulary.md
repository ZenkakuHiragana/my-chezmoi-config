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
5. バックティック内の語彙として使う場合は、`check_vocabulary.py` で未登録使用を検出できる。

次に当てはまる語、フィールド、スキーマ名は作ってはならない。

- 一文で平易に展開できる語。
- 人間向け説明だけに使う語。
- 固定フィールドではない見出し、評価軸、整理ラベル。
- 既存語の言い換えで足りる語。

## 維持する制御語彙

### 外部コードと一致する語（英語維持）

- 検査ID: `RR-CONTRACT-1`（`RR-OBL-<連番>` も同形式で英語維持）
- ツール名とパラメータ: `glob` / `grep` / `webfetch` / `write` / `read` / `task` / `pattern` / `path`
- 設定キーとスキーマフィールド: `status` / `name` / `agent`
- 基本: `description` / `chezmoi source-path`

### 日本語の制御語彙

- 手続きの結果: `合格` / `不合格` / `判定不能`
- 指摘の分類: `採用` / `却下` / `要調査` / `対象外`
- `準備完了判定`: `判定結果`
- 実行モード: `読み取り専用` / `書き込み可`
- 作業票の項目: `実行モード` / `目的` / `範囲` / `入力` / `読取可能` / `編集可能` / `制約` / `禁止事項` / `必要な根拠` / `出力形式` / `検証のヒント` / `停止条件` / `統合方法`
- 検査結果の3値: `反例未確認` / `破綻確認` / `破綻`
- 契約と指摘の項目: `要件契約` / `要件契約候補` / `依頼引用` / `固定した区別` / `伝播した拘束` / `侵害する条件` / `該当なし` / `なし`
- レビューの項目: `検査項目`
- 出力契約のフィールド: `確認方法`
- 根拠接地の判定: `未決`
- 失敗採掘の報告方針: `インシデント作成` / `履歴メモ作成` / `回帰シナリオ作成` / `スキップ` / `手動レビュー` / `未作成`
- 派生フィクスチャの分岐: `対象選択状態` / `実行経路` / `導出` / `調査のみ` / `あり`

### スキル名・エージェント名

- スキル名: `claim-grounding` / `task-grounding` / `requirement-contract` / `review-orchestration` / `review-response` / `empirical-prompt-tuning` / `derive-fixture-variants` / `retrospective-codify` / `cmd-report-failure` / `cmd-triage-failure` / `cmd-extract-failure-patterns`
- エージェント名: `requirement-reviewer` / `review-audit` / `general-fast` / `general-strong` / `panellist-*`

### コマンド

- chezmoi: `chezmoi status` / `chezmoi apply` / `chezmoi apply --dry-run 適用先のファイルパス` / `chezmoi apply --no-tty --error-on-conflict 適用先のファイルパス` / `chezmoi apply --no-tty --force 適用先のファイルパス` / `chezmoi apply 配置先の具体的なファイル名` / `chezmoi diff --no-pager 適用先のファイルパス` / `chezmoi init --no-tty --error-on-conflict`
- git: `git status --porcelain` / `git diff`
- セッションログ照会: `opencode db --format json "SQLITE3 QUERY"`

### パス・ファイル名・パターン

- このリポジトリの構成資料が示すパス: `*.tmpl` / `./.chezmoi.toml.tmpl` / `./.chezmoidata/` / `./.chezmoiignore` / `./.chezmoitemplates/` / `./.claude/` / `./.codex/` / `./.copilot/` / `./.omp/` / `./.opencode/` / `./.opencode/local-failure-logs/` / `./.opencode/work/` / `./.pi/` / `./AGENTS.md` / `./docs/` / `./dot_agents/exact_skills/` / `./dot_claude/` / `./dot_codex/` / `./dot_config/` / `./dot_config/**` / `./dot_config/opencode/` / `./dot_copilot/` / `./dot_omp/` / `./dot_pi/` / `./packages/` / `./scripts/` / `./tools/skill-kb/` / `.gitignore` / `~/.config/**` / `~/AppData/Local/` / `~/AppData/Roaming/` / `readonly_` / `run_onchange_` / `run_onchange_*` / `AGENTS.md`
- プロンプト保守作業が参照するパス: `./.opencode/local-failure-logs/session-mining/` / `./.opencode/local-failure-logs/triage/` / `~/.claude/projects/` / `~/.codex/sessions/` / `~/.local/share/opencode/opencode.db` / `~/.omp/agent/sessions/` / `~/.pi/agent/sessions/` / `references/problem-analysis/fundamental-problem-map.md` / `references/quality-principles.md` / `references/obligation-vocabulary.md` / `scripts/check_vocabulary.py` / `.chezmoitemplates/` / `dot_agents/` / `dot_config/`
- 失敗記録系の保存先: `$(chezmoi source-path)/.opencode/local-failure-logs/` / `~/.local/share/chezmoi/.opencode/local-failure-logs/` / `.opencode/local-failure-logs/` / `session-mining/` / `session-mining/YYYYMMDD-HHMM-session-mining-short-slug.md` / `triage/YYYYMMDD-HHMM-triage-short-slug.md` / `YYYYMMDD-HHMM-short-slug.md` / `fixture-derivation/YYYYMMDD-HHMM-fixture-derivation-short-slug.md` / `docs/fixtures/`
- 成果物のファイル名: `context.md` / `attachments/` / `context_export_YYYYMMDD_HHMM.zip` / `.opencode/work/panel-evidence-<8英数字>.md` / `-v0`

### スキーマフィールド（英語維持）

- 失敗記録: `problem_classes` / `observed_prompt_context` / `observed_system_sha` / `current_system_sha` / `current_coverage` / `coverage_evidence` / `regression_needed` / `pattern_tags`
- 汎用サブエージェントの返答: `chosen_skills` / `why_this_choice` / `result` / `evidence` / `verification_performed` / `risks_or_unknowns` / `next_action`
- パネル調整: `source_id`

### 状態値・分類値（英語維持）

- 対応範囲: `active_gap` / `covered_but_unvalidated` / `likely_addressed` / `obsolete_context` / `unknown`
- 失敗記録の状態: `captured` / `historical_candidate` / `current_gap` / `covered_unvalidated` / `obsolete` / `triaged` / `corrective_action_defined` / `validation_needed` / `verified_closed`
- プロンプト文脈: `current` / `legacy`
- 根源課題: `P1` / `P2` / `P3` / `P4` / `P5`
- 重大度: `low` / `medium` / `high` / `critical`
- 失敗の合図の強さ: `confirmed` / `strong` / `weak`
- 介入種別: `prompt_surface_change` / `command_prompt_change` / `skill_change` / `agent_routing_change` / `artifact_schema_change` / `hook_or_plugin_change` / `harness_change` / `regression_validation_only` / `no_change` / `unclear`
- プロンプト変更種別: `reword_existing_rule` / `move_to_different_layer` / `merge_overlapping_rules` / `split_overloaded_rule` / `restore_missing_essential` / `add_minimal_new_rule`
- 実験シナリオ集合: `train` / `validation` / `hold-out`
- 汎用サブエージェントの `next_action` 値: `none` / `escalate_to_write_ok` / `needs_parent_clarification`
- パネル調整の根拠種別: `user_provided` / `repo_derivable` / `public_fact` / `None`
- 語彙検査の診断名: `unaccounted` / `file-ref`

### 固定の出力ラベル

- 文脈エクスポートの該当なし表記: `このセッションでは外部出典を参照していない。` / `生成または変更した成果物はない。` / `再現性に関するメモはない。` / `添付は含まれていない。`

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
