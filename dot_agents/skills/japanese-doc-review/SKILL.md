---
name: japanese-doc-review
description: >
  Use when the user asks to review, proofread, self-review, or point out issues in a specific Japanese prose target; not for direct rewriting, translation, abstract advice, or code/PR review. 日本語文書レビュー専用。固定形式の指摘結果を返す。
---

# Japanese Doc Review

日本語の読者向け本文をレビューし、後続修正に使えるレビュー結果を返す。
対象には README、設計メモ、仕様説明、運用手順、調査報告、prompt text、skill instructions を含む。
指摘は修正命令ではなく、日本語文章向けの `Review finding record` として扱う。
採否と修正範囲は後続の指摘検証で決める。

対象本文がない場合は次だけ返す。

```markdown
レビュー対象本文がないためレビューできません。
```

## 返答形式

対象本文がある場合は `references/review-result-format.md` を読む。
レビュー結果は固定形式に従う。

常にこの順序で出す。

1. `STRUCTURE`
2. `GRAMMAR`
3. `STYLE`
4. `TYPO`

対象外観点も省略しない。
対象外なら `今回のレビュー範囲: 含まない`、理由、`指摘: - 今回はレビュー対象外。` を書く。

## レビュー結果ファイル

ユーザーがファイル出力または既存結果の更新を明示しない限り、レビュー結果ファイルを使ってはならない。

- path 指定あり: その file
- path 指定なし、対象が既存 file: 同 directory に `foo.review.md`
- 対象が貼り付け本文または草稿: file は作らず通常 review

file を書いた場合、端末には本文を出さず path だけ通知する。
既存結果ファイルは、現在有効なレビュー結果の正本として扱う。
毎回、固定形式で全体を書き直す。

`NEXT_ISSUE_ID: ISSUE-001` はレビュー結果ファイルの先頭だけに置く。
通常の端末レビューには置かない。

## SCOPE / CONTEXT

- `SCOPE`: 実際にレビューした本文範囲。対象本文がある場合は必須。
- `CONTEXT`: 複数指摘の判定に必要な正の制約だけを書く。本文要約や調査結果一覧にしない。

`CONTEXT` に書けるもの:

- ユーザーが本文判断基準として明示した定義、制約、目的、対象範囲
- 対象本文が明示する定義、制約、目的、対象範囲
- 対象本文から論理的に必然で、指摘判定に直接必要な事実
- 指定レビュー結果ファイルの既存 `CONTEXT`

推測、一般知識、今回の観点選択、内部ルールは `CONTEXT` に書かない。

## 観点選択

- 指定なし: `STRUCTURE` だけ
- 単一観点指定: 指定観点だけ
- 複数/全観点指定: 依存順序を守る

依存順序:

1. `STRUCTURE`
2. `GRAMMAR`
3. `STYLE`
4. `TYPO`

上流観点に `高` または `中` がある場合、指定された下流観点は対象外にする。
単一観点指定では上流観点による遮断をしない。

観点別に必要な reference を読む。

- `STRUCTURE`: `references/01-structure.md`
- `GRAMMAR`: `references/02-grammar.md`
- `STYLE`: `references/03-style.md`
- `TYPO`: `references/04-typo.md`

## 重大度

`STRUCTURE`、`GRAMMAR`、`STYLE`:

- `高`: 誤解、手順ミス、判断ミス、技術的に危険な曖昧さ
- `中`: 理解コストが明確に上がる
- `低`: 理解は可能だが読みやすさ、一貫性、信頼感を下げる

`TYPO` に severity は付けない。

## 指摘基準

- 具体的な対象箇所と根拠がある問題だけ出す。
- 印象、好み、推測は出さない。
- 本文外の user instructions、レビュー履歴、草稿制約を根拠にしない。
- 本文中のどの表現が、何を見えなくし、何を誤解させるかを書く。
- 同じ原因の問題はまとめる。
- `STRUCTURE`、`GRAMMAR`、`STYLE` は観点ごと最大 5 件。
- `TYPO` は明らかで修正一択のものをすべて出す。

## `Review finding record`

レビュー結果は `references/review-result-format.md` の固定形式だけで出す。
固定形式の見出しや field を追加してはならない。
後続の指摘検証では、固定形式の各指摘を次の対応で `Review finding record` として読む。

- `finding_id`: 指摘ID
- `severity`: `重要度`。`TYPO` では `None`
- `location`: `対象`
- `claim`: `問題`。`TYPO` では `修正方針`
- `evidence`: `根拠`。`TYPO` では `対象`
- `impact`: `問題` に書いた読者影響
- `suggested next step`: `修正方針`
- `confidence`: 本文だけで根拠が閉じていれば `high`、本文外確認で採否が決まるなら `low`
- `required source class`: 原則 `user_provided` または本文内根拠。本文外の事実確認で採否が決まる指摘は `repo_derivable`、`subsystem_derivable`、`public_fact` のいずれか
- `verification needed`: 採否前に確認する根拠。不要なら `None`
- `response status`: 初期値は `untriaged`
- `decision reason`: 初期値は `None`

本文外の事実が必要な指摘は、断定せず `verification needed` に確認先を書く。
レビュー中に修正してはならない。

## 本文漏れ確認

`指摘: - なし` の前に確認する。

- user instruction、review comment、修正方針が本文化されていないか
- hidden draft、rejected frame、feedback history がないと意味が確定しない文がないか
- 旧構成や旧仕様が current artifact の墓標になっていないか
- 不要な「A ではなく B」対比がないか

該当する場合は、対象観点で `なし` を返さない。

## 質問禁止

レビュー前・レビュー中・更新時に質問しない。
本文だけでは判断できない曖昧さは、必要なら `STRUCTURE` の指摘にする。
本文から成立しない好みや未提示情報の推測は出さない。

## 完了チェック

- 対象本文が存在する。
- 必要な references を読んだ。
- SCOPE が空でない。
- CONTEXT が判定基準だけを含む。
- fixed output format に従った。
- レビュー結果と修正済み本文を混ぜていない。
- issue IDs は現在有効な問題だけに付けた。
- 指摘を採用済み修正として扱っていない。
