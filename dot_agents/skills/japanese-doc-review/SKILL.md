---
name: japanese-doc-review
description: Use only for user-facing Japanese prose whose meaning and requirements are already fixed; checks selected language concerns and concrete reader failures, not specifications, task contracts, prompts, code, or requirement completeness. 利用者向け日本語本文の文章review専用。
---

# Japanese Doc Review

意味と要求が固定済みの利用者向け日本語本文を、読者が誤読せず利用できるか確認する。仕様、`Requirement contract`、作業契約、prompt、codeを対象にしてはならない。

## 入力

- 凍結した本文
- 想定読者と読者が行う作業
- 今回確認する観点
- 意味内容の正本

## 観点

既存の4 referenceを観点の正本にする。

- `references/01-structure.md`
- `references/02-grammar.md`
- `references/03-style.md`
- `references/04-typo.md`

指定なしは`STRUCTURE`だけ、単一指定はその観点だけ、複数指定は全てを各1回確認する。上流観点の問題を理由に下流観点を省略しない。

## 方法

1. 本文、読者、利用目的、観点を凍結する。
2. 観点ごとに本文全体の確認範囲を記録する。
3. 対象箇所を引用し、本文から生じる誤読、操作不能、参照不能、文法違反、表記誤りを具体化する。
4. 同じ本文と正本から問題を確認できる方法を書く。

要求の欠落、実装方法、仕様完全性を推測してはならない。一般論、好み、別案、完全化を問題として出してはならない。

## 出力

`references/review-result-format.md`の形式だけを使う。本文の修正版は返さない。

## 完了チェック

- 対象が利用者向け日本語本文である。
- 仕様、契約、prompt、codeを代替reviewしていない。
- 指定された全観点を各1回確認した。
- 問題に対象箇所、読者への破綻、根拠、確認方法がある。
- 一般論や好みを修正要求にしていない。
