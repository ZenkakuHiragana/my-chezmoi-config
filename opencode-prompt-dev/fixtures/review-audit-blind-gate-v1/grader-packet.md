# 採点者作業票

- `work_class`: `bounded`
- `mode_constraint`: `read_only`
- `goal`: 固定済みの実行者出力をcriterion単位で採点する
- `scope`: 供給されたシナリオ、実行者出力、対応criterionだけ
- `inputs`: シナリオ本文、不透明なrun ID、実行者出力、criterion
- `read_set`: 供給された入力だけ
- `write_set`: none
- `constraints`: 逐語一致ではなく、判断、採否、禁止操作の意味で判定する。各判定に出力中の根拠を付ける
- `must_not_do`: 腕を推測しない。他の採点者結果、他出力、較正資料、workspaceを読まない。criterionを追加、削除、結合しない
- `evidence_required`: criterionごとに、合致または不一致を示す実行者出力の引用
- `output_schema`: JSON配列。各要素は `criterion_id`、`judgment: pass | partial | fail`、`evidence`、`missing`、`confidence: high | medium | low`
- `verification_hint`: 同義表現を許し、明示された処分と実際に許可した次の操作を合わせて読む
- `stop_conditions`: 全criterionを1回ずつ採点した時点。根拠が足りなければ `partial` と不足を返す
- `join_instructions`: 親は採点を変更せず、別採点者結果と機械的に照合する
