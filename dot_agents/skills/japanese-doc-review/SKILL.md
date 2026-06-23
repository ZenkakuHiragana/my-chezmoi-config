---
name: japanese-doc-review
description: >
  Use when the user asks to review, proofread, self-review, or point out issues in a specific Japanese prose target; not for direct rewriting, translation, abstract advice, or code/PR review. 日本語文書レビュー専用。固定形式の指摘結果を返す。
---

# Japanese Doc Review

日本語 reader-facing prose の問題を見つけ、後続修正に使える review result を返す。
review 対象には README、設計メモ、仕様説明、運用手順、調査報告、prompt text、skill instructions を含む。

target がない場合は次だけ返す。

```markdown
レビュー対象本文がないためレビューできません。
```

## output format

target がある場合は `references/review-result-format.md` を読む。
review result は固定形式に従う。

常にこの順序で出す。

1. `STRUCTURE`
2. `GRAMMAR`
3. `STYLE`
4. `TYPO`

対象外観点も省略しない。
対象外なら `今回のレビュー範囲: 含まない`、理由、`指摘: - 今回はレビュー対象外。` を書く。

## review file

review result file は、ユーザーが file output または既存 result 更新を明示した場合だけ使う。

- path 指定あり: その file
- path 指定なし、target が既存 file: 同 directory に `foo.review.md`
- target が pasted text または draft: file は作らず通常 review

file を書いた場合、terminal には本文を出さず path だけ通知する。
既存 result file は現在有効な review result の primary source として扱う。
毎回 fixed format で全体を書き直す。

`NEXT_ISSUE_ID: ISSUE-001` は review result file の先頭だけに置く。
通常 terminal review には置かない。

## SCOPE / CONTEXT

- `SCOPE`: 実際に review した本文範囲。target がある場合は必須。
- `CONTEXT`: 複数指摘の判定に必要な正の制約だけ。本文要約や調査結果一覧にしない。

`CONTEXT` に書けるもの:

- ユーザーが本文判断基準として明示した定義、制約、目的、対象範囲
- target text が明示する定義、制約、目的、対象範囲
- target text から論理的に必然で、指摘判定に直接必要な事実
- 指定 review result file の既存 `CONTEXT`

推測、一般知識、今回の観点選択、内部ルールは `CONTEXT` に書かない。

## 観点選択

- 指定なし: `STRUCTURE` だけ
- 単一観点指定: 指定観点だけ
- 複数/全観点指定: dependency order を守る

Dependency order:

1. `STRUCTURE`
2. `GRAMMAR`
3. `STYLE`
4. `TYPO`

上流観点に `高` または `中` がある場合、指定された下流観点は対象外にする。
単一観点指定では upstream block しない。

観点別に必要な reference を読む。

- `STRUCTURE`: `references/01-structure.md`
- `GRAMMAR`: `references/02-grammar.md`
- `STYLE`: `references/03-style.md`
- `TYPO`: `references/04-typo.md`

## severity

`STRUCTURE`、`GRAMMAR`、`STYLE`:

- `高`: 誤解、手順ミス、判断ミス、技術的に危険な曖昧さ
- `中`: 理解コストが明確に上がる
- `低`: 理解は可能だが読みやすさ、一貫性、信頼感を下げる

`TYPO` に severity は付けない。

## 指摘基準

- concrete target と evidence がある問題だけ出す。
- impression、taste、推測は出さない。
- 本文外の user instructions、review history、draft constraints を根拠にしない。
- 本文中のどの表現が、何を見えなくし、何を誤解させるかを書く。
- 同じ原因の問題はまとめる。
- `STRUCTURE`、`GRAMMAR`、`STYLE` は観点ごと最大 5 件。
- `TYPO` は明らかで修正一択のものをすべて出す。

## artifact leakage gate

`指摘: - なし` の前に確認する。

- user instruction、review comment、修正方針が本文化されていないか
- hidden draft、rejected frame、feedback history がないと意味が確定しない文がないか
- 旧構成や旧仕様が current artifact の墓標になっていないか
- 不要な「A ではなく B」対比がないか

該当する場合は、対象観点で `なし` を返さない。

## 質問禁止

review 前・中・更新時に質問しない。
本文だけでは判断できない曖昧さは、必要なら `STRUCTURE` の指摘にする。
本文から成立しない好みや未提示情報の推測は出さない。

## 完了チェック

- target text が存在する
- required references を読んだ
- SCOPE が空でない
- CONTEXT が判定基準だけを含む
- fixed output format に従った
- review result と repaired prose を混ぜていない
- issue IDs は現在有効な問題だけに付けた
