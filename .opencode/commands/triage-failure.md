# /triage-failure

## 目的

- prompt-failure-log.md に記録された失敗を受けて、まず "triage" を行い、prompt-refactor を実行する前にどのような初期対応が適切かを判断する。

## 読むべき入力

- opencode-prompt-dev/prompt-failure-log.md
- opencode-prompt-dev/prompt-principles.md
- opencode-prompt-dev/prompt-map.md

## 出力

- YAML 形式の分類結果オブジェクトを返す。

---

failure_id: ""
can_be_prevented_by_existing_rule: true|false|unknown
prevention_reason: "" # 簡潔な説明
is_configuration_or_input_issue: true|false
recommended_next_step: "" # e.g., record-only / run-refactor / escalate / create-change-request
recommended_priority: "high|medium|low"
notes: ""
related_map_entries: # prompt-map.md 中の候補（あれば）

- { rule_key: "", path: "", anchor_or_section: "", match_reason: "" }
  recommended_triage_actions: # 例: map 更新 / failure-log 補足 / prompt-refactor 実行提案
- ""
  blocking_questions:
- ""

---

## 判定ルール

- 既存の map に関連ルールが見つかり、そのルールが failure の直接原因をカバーしている場合 → can_be_prevented_by_existing_rule: true
- 規則が存在するが表現が曖昧 or 配置が不適切（例: skill にあるべき規則が常設に書かれている）→ can_be_prevented_by_existing_rule: unknown（推定理由を記載）
- 入力側の誤り（仕様ミス、ユーザ入力の範囲外）→ is_configuration_or_input_issue: true

## 運用上の注意

- triage が "run-refactor" を推奨しても、prompt-refactor は独自に "blocking questions" を問う可能性がある。triage はあくまで初期判定である。
