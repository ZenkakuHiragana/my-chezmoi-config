---
name: review-response
description: Use when review findings must be reproduced against a frozen artifact and contract before editing; separates reproducible fixes from non-blocking advice and creates one bounded response contract. レビュー指摘の有限な追試と修正契約作成専用。
---

# Review Response

凍結した成果物と契約に対して指摘を追試し、修正対象だけを1回で直す契約を作る。
このskillではコードや本文を編集しない。

## 入力

- レビュー対象のtask contract
- レビュー時点で凍結した成果物
- 開始前に固定した観点集合と`Review finding record`
- 利用できる引用、assertion、command結果

## 指摘検証

各指摘を次の順で追試する。

1. 指摘が侵害すると主張する契約条項を特定する。
2. 条項から観測可能な要求を逐語で抜き出す。
3. 成果物の位置と観測値を直接確認する。
4. 観測値が要求を満たさないことを、引用、assertion、command結果のいずれかで再現する。
5. 同じ入力から同じ不一致を一瞥で確認できる形にする。

5項目を全て満たす指摘だけを修正対象にする。1項目でも満たさない指摘は、不足している追試を明示して参考にする。参考は現在作業を止めず、修正へ混ぜない。

重要度、一般論、レビュー履歴、条項との関連性、将来の危険の推測を修正対象の根拠にしてはならない。

## `Review response contract`

修正対象が1件以上あるときだけ作成する。

- 修正対象のfinding ID
- 条項の要求
- 成果物の位置と観測値
- 再現手順または逐語根拠
- 修正範囲
- 非対象範囲
- 保つ条件
- 対応後監査の質問と確認方法
- 対応後監査が失敗した場合の縮小または巻き戻し方法

契約は`.opencode/work/<slug>.review.md`または同等の`Review Response Artifact`へ外部化する。

```markdown
# Review Response Artifact

## レビュー元

- source:
- 凍結対象:
- 対象契約:
- 固定した観点:

## 修正対象

| finding | 条項の要求 | 位置と観測値 | 再現手順または逐語根拠 |

## 参考

| finding | 不足している追試 |

## Review response contract

- 修正範囲:
- 非対象範囲:
- 保つ条件:
- 確認方法:
- 対応後監査の質問:
- 失敗時の縮小または巻き戻し:
```

空欄禁止。該当なしは`None`と書く。修正対象が0件なら契約を作らず、参考だけを返す。

## 対応後監査

対応後監査は契約に列挙した質問だけを`はい` / `いいえ`と根拠で照合する。

- 各修正対象について、観測値が条項の要求を満たしたか
- 差分が修正範囲内か
- 非対象範囲が不変か
- invariantsと指定testを満たしたか

新しい指摘を生成せず、`code-review`または`japanese-doc-review`を起動しない。

1件でも`いいえ`なら、契約に従って修正を縮小または巻き戻し、現在のレビュー対応を失敗として終了する。残余を別作業の入力にするには、新しい明示依頼または契約変更を要求する。

## 返す内容

- 修正対象と追試根拠
- 参考と不足している追試
- `Review response contract`、または作らない理由
- `Review Response Artifact`のpath、または作らない理由

## 完了チェック

- 凍結した成果物と有限の観点集合を確認した。
- 修正対象の全件に条項の要求、位置、観測値、追試根拠がある。
- 参考を修正対象へ混ぜていない。
- 対応後監査が閉じた質問だけを持つ。
- 失敗時の縮小または巻き戻しと終了条件がある。
- このskill内で編集していない。
