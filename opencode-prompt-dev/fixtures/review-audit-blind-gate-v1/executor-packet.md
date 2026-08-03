# 実行者作業票

- `work_class`: `bounded`
- `mode_constraint`: `read_only`
- `goal`: 供給された適用規則を1つの監査シナリオへ適用し、監査の結論と処分を返す
- `scope`: 供給された規則とシナリオだけ
- `inputs`: 片腕の適用規則5件、シナリオ本文1件
- `read_set`: 作業票に列挙された5つのblobと、作業票本文に埋め込まれた1シナリオだけ
- `write_set`: none
- `constraints`: 各blobを直接読み、シナリオに書かれた事実だけを使う
- `must_not_do`: workspaceの別ファイル、スキル、採点基準、他シナリオ、他出力を読まない。新しい問題を探索しない。ファイルを編集しない
- `evidence_required`: 適用規則またはシナリオ事実のどれが結論を支えるか示す
- `output_schema`: 行う確認、手続き結果、元の対象と候補の採否、同じ手続き内で次に行える操作、曖昧な点
- `verification_hint`: 結論と採否と次の操作が互いに矛盾しないか確認する
- `stop_conditions`: 1つの回答を返した時点。入力を読めない場合は不足を返して止まる
- `join_instructions`: 親は出力を変更せず保存し、別の採点者へ渡す
