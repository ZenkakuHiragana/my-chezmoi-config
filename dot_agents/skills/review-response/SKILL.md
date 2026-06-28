---
name: review-response
description: Use when handling review findings before editing: triage `Review finding record`, verify whether findings are valid, and produce a `Review response contract`; not for performing code or prose edits. レビュー指摘の採否分類と対応契約作成専用。
---

# Review Response

レビュー指摘を検証し、修正へ進める指摘だけを契約化する。
この skill ではコードや本文を編集しない。

## 入力

- レビュー対象の `task contract`
- `Review finding record`
- レビュー対象の差分、本文、周辺文脈
- 利用できる検証結果

レビュー結果に `Review finding record` の項目が足りない場合は、既存 field から対応付ける。
対応できない項目は `unknown` または `None` として扱い、不足自体を採否判断の根拠に含める。

## 指摘検証

各指摘を次のいずれかへ分類する。

- `accepted`: 根拠が十分で、今回の契約内で修正する。
- `rejected`: 根拠不足、誤指摘、または契約に反するため採用しない。
- `needs-investigation`: ローカル実装、外部仕様、本文外の根拠確認が必要。
- `out-of-scope`: 妥当性はあり得るが、今回の契約外である。

各指摘の分類は必ず1つだけ選ぶ。
迷う場合も主分類を1つ選び、別分類の可能性は採否理由へ補足として書く。

`needs-investigation` は `investigation` または `public-research` に戻す。
未検証の指摘を `accepted` にしてはならない。
好み、一般論、レビュー履歴だけを根拠に採用してはならない。

## `Review response contract`

`accepted` が1件以上あるときに作成する。
契約には次を含める。

- 対応する `Review finding record`
- 修正範囲
- 非対象範囲
- 保つ条件
- 確認方法
- 対応後監査の観点
- 次に使う skill: code / diff は `implementation`、日本語文章は `technical-writing`

`accepted` がない場合は、契約を作らず理由を返す。
このとき、次の対応先と対応後監査は `None` と明示し、未解決指摘の戻り先だけを書く。
`None` とする理由は、修正対応が発生しないため対応後監査の対象も存在しないことだと明示する。

## 対応後監査の指定

対応後監査には次を入れる。

- 元指摘が解消したこと
- 修正範囲外を変えていないこと
- 別観点の新規問題がないこと
- code / diff / 実装面では `code-review` を使うこと
- 再利用される日本語文章では `japanese-doc-review` を使うこと

両方に触れる場合は両方を使う。
一方を他方の代替にしてはならない。

## 返す内容

- 指摘ごとの分類
- 採否理由
- 追加調査が必要な指摘と戻り先
- `Review response contract`、または作らない理由
- 次に使う skill。`accepted` がない場合は修正用 skill と対応後監査 skill を `None` とする

## 完了チェック

- 全ての `Review finding record` を分類した。
- `accepted` の根拠が確認済みである。
- `needs-investigation` を修正対象にしていない。
- `Review response contract` が修正範囲と非対象範囲を分けている。
- 対応後監査の観点を指定した。
- この skill 内で編集していない。
