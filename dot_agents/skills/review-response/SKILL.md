---
name: review-response
description: Use whenever a frozen review finding set must be reproduced and classified before any review-response edit; performs one bounded pass and returns accepted/rejected/needs-investigation/out-of-scope plus a response contract for accepted findings, without editing or deciding loop termination. レビュー指摘の再現・4値分類専用。
---

# Review Response

凍結した finding 集合を現成果物と task contract へ 1 回だけ再現し、修正対象を決める。この skill では成果物を編集せず、review loop の終了を判定しない。

## 入力

- 凍結した成果物版と base
- task contract の scope、acceptance criteria、invariants、verification method
- 開始前に固定した Review finding record 集合
- 再現に使う引用、command、test、log、生成物

Review finding record の正本は、W-2 review skill へ展開される `.chezmoitemplates/opencode/review-result-format.md` とする。入力 record に次の field が全てあることを確認し、正本を再読する追加手順は要求しない。

Review finding record は次の field を持つ。

- finding ID
- 検査 ID
- 重要度
- 対象箇所
- 破綻
- 根拠
- 確認方法
- 侵害する条件

`判定不能`（検査被覆の欠損）は finding ではない。入力に混在している場合は入力不正として分離し、4 値分類へ入れてはならない。

## 1 パス処理

入力 finding 集合、成果物版、task contract、verification method を開始前に固定する。各 finding を次の順で 1 回だけ処理する。

1. finding の対象と侵害する条件を task contract へ逐語で照合する。
2. scope、acceptance criterion、invariant のいずれにも属さない場合は `out-of-scope` とする。
3. 対応する verification method を修正前の成果物へ適用する。
4. 情報、環境、権限が不足して結果を決められない場合は `needs-investigation` とする。
5. 契約条件の観測可能な失敗を再現した場合は `accepted` とする。
6. 再現を完了し、指摘された失敗が存在しない、または根拠が対象と一致しない場合は `rejected` とする。

途中で finding を追加してはならない。同じ finding を複数の分類へ入れてはならない。

## 分類条件

### accepted

verification method のどの手順が、現成果物のどの観測値で失敗したかを記録する。criterion との関連、重要度、一般論、将来危険の推測だけで `accepted` にしてはならない。

### rejected

同じ verification method を完了した結果、指摘された失敗を確認しなかった根拠、または finding の根拠が対象と一致しない箇所を記録する。親の感想だけで `rejected` にしてはならない。

### needs-investigation

試みた verification method、不足する情報・環境・権限、再開条件を記録する。`accepted` または `rejected` へ丸めてはならない。

### out-of-scope

finding の対象と、task contract の scope、acceptance criteria、invariants を逐語で照合した結果を記録する。scope 判断を新しい要求の生成に使ってはならない。

## Review Response Artifact

次の形式で返す。親が `.opencode/work/<slug>.review-response.md` へ外部化する。

```markdown
# Review Response Artifact

## 入力

- source:
- 凍結した成果物版:
- task contract:
- 固定した finding:

## 分類

| finding | 分類 | 契約条件 | verification method | 修正前の観測 | 根拠または不足 | 再開条件 |
| ------- | ---- | -------- | ------------------- | ------------ | -------------- | -------- |

## 件数

- accepted:
- rejected:
- needs-investigation:
- out-of-scope:

## Review response contract

- accepted finding:
- 修正範囲:
- 非対象範囲:
- 保つ条件:
- 修正前の失敗:
- 修正後に使う同じ確認方法:
- 失敗時の縮小または巻き戻し:
```

`accepted` が 0 件なら修正契約へ `None` と書く。`accepted` だけを修正契約へ入れる。

## 禁止事項

- 成果物を編集してはならない。
- 新しい finding を探索または生成してはならない。
- reviewer の検査被覆を再実行してはならない。
- review loop の収束または終了を判定してはならない。
- `needs-investigation` または `out-of-scope` を黙示的に解消してはならない。

## 完了チェック

- 入力 finding 集合、成果物版、task contract、verification method を凍結した。
- 入力 finding を各 1 回だけ 4 値分類した。
- `accepted` の全件で verification method の修正前失敗を再現した。
- `rejected` の全件に反証根拠がある。
- `needs-investigation` の全件に不足と再開条件がある。
- `out-of-scope` の全件に逐語照合がある。
- `accepted` だけを修正契約へ入れた。
- 成果物を編集せず、終了判定を行っていない。
