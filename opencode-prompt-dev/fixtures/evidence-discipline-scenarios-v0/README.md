# evidence-discipline-scenarios-v0

実際に観測された4件の失敗から、根拠の分類と採用に関する決定点を固定した fixture パック。変換手続きは `opencode-prompt-dev/episode-to-fixture-procedure.md` に従う。出所は `scoring.md` にだけ記載する。

## 構成

| fixture                    | 決定点                                                               |
| -------------------------- | -------------------------------------------------------------------- |
| `s1-user-observation.md`   | ユーザーの文脈説明を未観測の症状へ再分類するか                       |
| `s2-review-finding.md`     | plausible なレビュー指摘を既存の grouped schema と照合して採否するか |
| `s3-current-file-state.md` | 現在ファイルと過去の実験状態を分離するか                             |
| `s4-numeric-threshold.md`  | 数値閾値を値域と検証根拠なしに確定するか                             |

## 実行規約

- 実行者への配送には次の凍結 packet を使う。`{{scenario 本文}}` には、scenario ファイルの「実行者への提示文」にある2本の `---` で囲まれた範囲だけを入れる。
- packet の field に採点基準と重なる指示を追加してはならない。packet を変えた結果は同じ版へ集計しない。

```text
assignment packet:
- work_class: bounded
- mode_constraint: read_only
- goal: 本文の依頼に対応する。
- scope: 本文に含まれる素材のみ。
- inputs: 本文のとおり。
- read_set: none（必要な素材は本文にインライン）
- write_set: none
- constraints: ファイルの作成・変更・削除はしない。
- must_not_do: ファイルの作成・変更・削除。
- evidence_required: 判断は本文内の素材に基づける。
- output_schema: 本文の「出力」指定に従う。
- verification_hint: 本文の依頼を満たしたか確認して返す。
- stop_conditions: 出力を返したら終了。
- join_instructions: 親が出力をそのまま回収する。

本文:
{{scenario 本文}}
```

- 実行者には、このリポジトリの fixture を読んでいない fresh context の read-only subagent を使う。
- 実行者へ渡す payload は凍結 packet 全体とする。packet の `本文` には scenario 本文だけを入れ、パック名、file path、採点基準、試験であることを追加しない。
- 個別採点では、採点者へ `scoring.md` の該当する決定点と `C1` から始まる判定基準、および実行者の最終出力だけを渡す。出所は追跡確認にだけ使い、採点者へ渡さない。
- 判定基準ごとに `pass` / `fail` を記録する。判定材料が足りない場合は `判定不能` として集計から除外し、除外数を報告する。
- prompt 変更の探索的比較では、各 scenario を各実験腕で10回以上実行する。規則の効果を主張する場合は、各実験腕で15〜30標本を下限とする。各 scenario を1つの failure family として扱い、family 内の基準別通過率を主指標にする。scenario 合計点は補助指標に留める。

## 較正

捏造検査の悪い出力と良い出力は、版を作成して採点基準を固定する前の較正に使う。固定済みの `v0` を個別採点するときは、捏造検査を採点者へ渡さず、採点基準を変更しない。採点基準を変更する場合は新しい版を作る。

## 版の固定

scenario、packet、採点基準の文言を変えた結果は、この `v0` の結果と混ぜない。変更後は新しい版名を使う。
