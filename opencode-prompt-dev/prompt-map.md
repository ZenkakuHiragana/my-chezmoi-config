# Prompt 配置マップ (prompt-map.md)

目的
- どの規則や原則がどの層（1=常設 / 2=skill / 3=agent）に置かれているかを索引化し、failure-log と結びつけて自動処理やトリアージができるようにする。

フォーマット（CSV 風）
rule_key,summary,layer,path,anchor_or_section,related_failures,notes

ルール記入ルール（必須）
- rule_key: 短く一意な識別子（英数字とハイフン、例: language-policy）
- summary: 1行の概要（日本語可）
- layer: 1|2|3 （1=常設, 2=skill, 3=agent）
- path: リポジトリ内のファイルパス
- anchor_or_section: ファイル内の見出しやアンカー（可能なら行番号）
- related_failures: カンマ区切りで prompt-failure-log の failure_id を参照
- notes: 補足

初期サンプル行（コピーして使ってください）
rule_key,summary,layer,path,anchor_or_section,related_failures,notes
language-policy,出力言語ポリシー,1,dot_config/opencode/AGENTS.md,Language Policy,,グローバルな言語制約
intent-gate,応答の優先条件（意図判定）,1,dot_config/opencode/AGENTS.md,Intent and skill selection,,最小質問ルール
prompt-principles,プロンプト管理原則（3層モデル等）,1,opencode-prompt-dev/prompt-principles.md,,,運用の正本
failure-log-template,失敗記録テンプレート,1,opencode-prompt-dev/prompt-failure-log.md,,,失敗事例の記録先
refactor-checklist,リファクタチェックリスト,1,opencode-prompt-dev/prompt-refactor-checklist.md,,,作業前後の検査項目
refactor-log,リファクタ履歴,1,opencode-prompt-dev/prompt-refactor-log.md,,,変更履歴の追記先
prompt-refactor,リファクタ実行プロンプト（executor）,2,opencode-prompt-dev/prompt-refactor.md,,,実行用 prompt（skill として読み込む）
prompt-failure-triage,失敗トリアージプロンプト（triage）,2,opencode-prompt-dev/prompt-failure-triage.md,,,failure の初期分類用
prompt-map,配置マップ索引,1,opencode-prompt-dev/prompt-map.md,,,本ファイル
