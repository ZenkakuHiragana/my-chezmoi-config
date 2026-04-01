# /refactor-prompt

## 目的

- prompt-principles.md, prompt-failure-log.md, prompt-map.md を入力に、失敗事例駆動でプロンプトの削除・統合・移設を第一候補として提案し、変更案・更新内容（map と refactor-log 用の追記）を出力するための実行用プロンプト。

## 運用上の前提

- このプロンプトは自動でコミットや push を行ってはいけません。出力は提案（patch / updated entries / refactor-log エントリ）として人間がレビューして適用します。
- 新規規則の追加は原則禁止です。追加する場合は prompt-principles.md に記載された4条件をすべて満たすことを明示的に説明してください。

## 読むべき入力ファイル

1. opencode-prompt-dev/prompt-principles.md
2. opencode-prompt-dev/prompt-failure-log.md
3. opencode-prompt-dev/prompt-map.md
4. opencode-prompt-dev/prompt-refactor-checklist.md
5. 対象となる prompt 本体（例: dot_config/opencode/AGENTS.md や dot_config/opencode/agents/\*.md, skills/\*/SKILL.md など）

## 作業手順

1. 対応する failure を prompt-failure-log.md から特定する（failure が複数ある場合は、優先度順に扱う）。
2. prompt-map.md を参照し、related_failures 欄や summary で関連する既存規則を列挙する。
3. 既存規則で防げるかを評価する（まずは「削除・統合・移設」で解決できないかを検討）。
   - 防げる場合: 変更案は "移設" または "統合" を第一候補とする。
   - 防げない場合: 新規追加が必要か、または failure がプロンプト外（入力側／仕様側）の問題かを判定する。
4. 変更案を作る際は、必ず prompt-refactor-checklist.md の観点で自己点検を行う。
5. 変更案として、以下を出力する：
   - concise summary（1-2行）
   - 提案アクション: 移設 / 統合 / 削除 / 新規追加（新規追加なら 4 条件の検証結果を添える）
   - 具体的差分（各対象ファイルについて、変更前の抜粋と変更後の抜粋）
   - prompt-map.md に追加・更新すべき行（CSV 行オブジェクト）
   - prompt-refactor-log.md に追記するエントリ（フォーマットに従う）
   - checklist の各項目の pass/fail と補足
6. 出力に patch を含める場合は unified diff ではなく、ファイル別の "置換前 -> 置換後" 形式（人がレビューしやすい短い抜粋）で出力する。
7. 重大な曖昧さや人的判断が必要な点が残る場合は、必ず質問（blocking questions）を出力して作業を止める。

## 追加禁止ポリシー

- 新規規則を追加するのは原則として禁止。追加する場合は、次の4点を満たすことを説明すること：
  1. 既存規則で包含できない
  2. 既存規則の表現を整理しても防げない
  3. 配置変更だけで解決しない
  4. 新規規則の方が既存規則群より短く明確である

## 更新必須ファイル

- 変更提案が出た場合、以下のファイル用の出力を必ず生成する（自動更新はしないが、人間が容易にコピペできる形式で出力すること）：
  - opencode-prompt-dev/prompt-map.md（追加／更新行）
  - opencode-prompt-dev/prompt-refactor-log.md（追記エントリ）
  - 変更対象の prompt ファイルの変更前/後抜粋

出力形式（必須、YAML 構造を推奨）
以下の YAML オブジェクトを出力すること。値は必ず埋め、該当しない場合は 空文字列 or [] を使う。

---

target_failure_id: "" # prompt-failure-log.md の識別子（日付+報告者等）
summary: "" # 1-2行の要約
proposed_action: "" # 移設/統合/削除/新規追加/無変更
proposed_layer: "" # 1/2/3 のどの層に置くか
rationale: # prompt-principles.md への照合結果（箇条書き）

- ""
  related_existing_rules: # prompt-map.md から参照した既存ルールの一覧
- { rule_key: "", path: "", anchor_or_section: "", notes: "", match_reason: "" }
  proposed_edits: # 変更候補（リスト）。人間がレビューしやすい短い抜粋で
- { path: "", anchor_or_section: "", change_type: "replace|insert|delete", before: "", after: "", summary: "" }
  updated_map_rows: # prompt-map.md に追加/更新すべき行（CSV 列オブジェクト）
- { rule_key: "", summary: "", layer: "", path: "", anchor_or_section: "", related_failures: "", notes: "" }
  refactor_log_entry: # prompt-refactor-log.md に追記するエントリ（文字列ブロックで）
  ""
  checklist_results: # prompt-refactor-checklist.md の観点ごとの pass/fail
- { item: "既存規則で対応可能か検討した", pass: true, note: "" }
  blocking_questions: # 人間の判断が必要な質問（あれば）
- ""
  confidence: 0.0 # 0.0-1.0
  patch_preview: "" # 人間がレビューするための短い置換前/後の抜粋（複数なら一つにまとめる）

---

## 運用上の注意

- 出力はあくまで "差分提案" であり、適用前に必ず人間のレビューを入れてください。
- 重大な安全や公開リスクがある場合は、そのリスク説明を最優先で出力してください。
