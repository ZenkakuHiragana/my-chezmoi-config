## サブエージェントへ渡す `assignment packet`

- `assignment packet` は、サブエージェントへ渡す作業票。
- 全体依頼を推測させず、範囲、文脈、制約、返答形式を固定する。

## 1. 作業票に必ず書く項目

各項目は具体値で埋める。該当なしは `none`。

- `work_class`: 作業の広さと不確実さ
- `mode_constraint`: 書き込み可否（`read_only` | `write_ok`）
- `goal`: 到達点および作業の目的
- `scope`: どこまでを担当させるか
- `inputs`: 親エージェントが把握している文脈、既知の制約、未解決点。背景説明や確認済みの事実を書く
- `read_set`: サブエージェントが自分で読むべき資料のリスト
- `write_set`: サブエージェントが編集してよいファイルのリスト
- `constraints`: 保つべき条件
- `must_not_do`: 明示的な禁止事項
- `evidence_required`: 主張、判断、比較ごとに必要な根拠の種類。何を根拠づけて主張すべきか、およびどんな根拠を要求するかを書く
- `output_schema`: 返答の形式
- `verification_hint`: 実行してほしい確認事項
- `stop_conditions`: どの時点で止まって返すか。何が起きたら打ち切るか。
- `join_instructions`: 親エージェントがどう取り込む前提か

### 読者向け成果物の review を委譲する場合の追加規則

- レビュアーに渡す文脈は、成果物の消費者文脈に一致させる。
- `goal`、`inputs`、`constraints`、`verification_hint`、`join_instructions` には、次だけを書く。
  - 対象本文または対象 file
  - 対象 review skill が既定で要求する固定の review 観点、出力形式、完了確認
  - 親エージェントが追加する review 観点
- 親エージェントは、対象 review skill が既定で要求する固定の review 観点、出力形式、完了確認を削除、置換、縮小してはならない。追加観点はそれらへ足す形で書く。
- 親エージェントは、固定の review 観点、出力形式、完了確認の一部だけを指定して全体の代替にしてはならない。
- 追加観点だけを `scope`、`constraints`、`verification_hint` の唯一の review 範囲にしてはならない。
- セッション経緯、修正履歴、前回との差分、親エージェントの作業記録を review の前提として渡してはならない。
- `修正後の`、`直前の修正では`、`前回`、`再レビュー` など、読者から見えない修正履歴を前提にした表現は書いてはならない。
- 例外は、履歴自体が成果物本文であるものに限る。例: 事故報告、CHANGELOG、移行案内、レビュー結果

## 2. 子からの返答

- `work_class`: `tiny-local` | `bounded` | `broad-or-unclear`
- `chosen_skills`: 使用したスキルの名前
- `why_this_choice`: スキル選定の理由
- `result`: 結果の要約
- `evidence`: `result` を裏付ける根拠
- `verification_performed`: 実行した検証内容
- `risks_or_unknowns`: 不明瞭な点および残存リスク
- `next_action`: タスクの完了に問題が生じた場合の次のアクション
  - `none`: 問題なし
  - `escalate_to_write_ok`: `mode_constraint: write_ok` としてもらう必要がある
  - `needs_parent_clarification`: 親エージェントおよびユーザーの確認が必要
