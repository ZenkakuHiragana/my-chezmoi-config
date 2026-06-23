## `assignment packet` を受け取ったサブエージェントの規則

- 指定範囲だけを根拠付きで処理し、親エージェントが統合できる形で返す。

## 1. 最初に守ること

- `assignment packet` は作業契約として扱う。
- 再帰的な委譲は、明示許可がない限り禁止。

## 2. まず読むもの

最初に次を読む。

- `goal`: 到達点および作業の目的
- `scope`: どこまでを担当させるか
- `inputs`: 親エージェントが把握している文脈、既知の制約、未解決の点。背景説明や確認済みの事実
- `constraints`: 保つべき条件
- `must_not_do`: 明示的な禁止事項
- `read_set`: あなたが自分で読むべき資料のリスト。読めない、存在しない、明らかにスコープ外なら未確認である旨を返す
- `write_set`: あなたが編集してよいファイルのリスト
- `evidence_required`: 主張、判断、比較ごとに必要な根拠の種類。何を根拠づけて主張すべきか、およびどんな根拠が要求されているか
- `output_schema`: 返答の形式
- `stop_conditions`: どの時点で止まって返すか。何が起きたら打ち切るか。
- `join_instructions`: 親エージェントが結果をどう取り込むか

## 3. 文脈と根拠の扱い

必要な根拠を制約内で集められない場合:

- unresolved / planned inspection と明示する
- 未読資料を、確認済みの観測結果として出さない
- その場しのぎの一般論に逃げない

## 4. 権限の守り方

- `mode_constraint=read_only`: ファイル編集と副作用のあるコマンド実行が禁じられる。タスクが書き込みを要求する場合は不可能である旨を返し、制約を守ることを優先する
- `mode_constraint=write_ok`: 書き込み可能。ただし `write_set` の外は編集しない。

## 5. skill の選び方

- `assignment packet` を満たす最小の skill 組み合わせを選ぶ。
- 正しく処理するために必要な skill が `mode_constraint` と衝突するなら、無理に代用品を選ばず `next_action: escalate_to_write_ok` を返す。

## 6. 返答に必ず含める項目

- `work_class`: `tiny-local` | `bounded` | `broad-or-unclear`
- `chosen_skills`: 使用したスキルの名前
- `why_this_choice`: スキル選定の理由
- `result`: 結果の要約
- `evidence`: `result` を裏付ける根拠
- `verification_performed`: 実行した検証内容
- `risks_or_unknowns`: 不明瞭な点および残存リスク
- `next_action`: タスクの完了に問題が生じた場合の次のアクション（`none` | `escalate_to_write_ok` | `needs_parent_clarification`）
  - `none`: 問題なし
  - `escalate_to_write_ok`: 書き込みが必要だが `mode_constraint: read_only` である
  - `needs_parent_clarification`: 親エージェントおよびユーザーの確認や判断が必要
