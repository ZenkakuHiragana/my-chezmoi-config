---
name: technical-writing
description: >
  Improve technical prose artifacts for reader fit, structure, scannability, artifact integrity, and bounded revision quality. 技術文書、prompt、skill instructions、日本語成果物の構造と文章品質を整える。
---

# Technical Writing

reader-facing prose artifact の形、構造、読みやすさ、artifact hygiene を扱う。
missing facts は `investigation` または `public-research` が担当する。

## 使う条件

- main deliverable が technical document
- implementation に standalone prose artifact が含まれる
- 保存、コピー、レビュー、再利用される日本語 reader-facing prose
- prompt text、skill instructions、README、guide、reference、report、CHANGELOG、migration note を書く
- failure mode が構造不備、reader mismatch、drafting context leakage

## 使わない条件

- ephemeral short reply
- tiny wording tweak
- fact finding が主目的
- prose が incidental な implementation
- pure translation without redesign

## artifact contract

draft 前に決める。

- document form
- intended audience
- reader goal/question
- purpose in one sentence
- assumed knowledge
- standalone or companion context
- confirmed facts
- caveats / exclusions
- allowed source set
- allowed change budget

facts が足りなければ書かずに解決する。

## reference routing

Substantial standalone document:

- `references/01-reader-contract.md`
- `references/02-standalone-structure.md`

Reusable or persisted Japanese prose:

- `references/04-artifact-integrity.md`
- `references/05-japanese-tech-writing.md`

Rendered/layout-sensitive artifact:

- `references/03-rendered-artifact-checks.md`

`04-artifact-integrity.md` を先に読む。
存在してはいけない文を polishing しない。

## forms

- `tutorial`
- `how-to guide`
- `reference`
- `explanation`
- investigation report
- README
- CHANGELOG
- migration / release note

1 artifact は primary form を 1 つ持つ。
混在する場合は section を分ける。

## drafting rules

- 冒頭で scope と reader value を示す。
- reader の質問、判断、作業順に並べる。
- discovery order、revision process、writer handoff を本文に入れない。
- user feedback、review comments、rejected alternatives は control input。artifact content にしない。
- normative artifact は current truth を書く。
- contrast は reader が実際に比較対象を必要とする場合だけ使う。
- heading は specific、unique、task-aligned にする。
- 1 paragraph = 1 role。
- facts、caveats、recommendation を分ける。
- unsupported certainty を避ける。

## Japanese prose path

1. artifact contract と confirmed facts を確定する。
2. `references/04-artifact-integrity.md` を読む。
3. `references/05-japanese-tech-writing.md` を読む。
4. draft/revise する。
5. sentence admission を再確認する。

## review loop

1. Draft.
2. high-impact issues を 1 から 3 個選ぶ。
3. affected sections だけ直す。
4. affected dimensions を再確認する。
5. high-impact issue がなくなったら止める。

優先順:

- structure
- accuracy / meaning
- procedure quality
- readability / scannability
- audience / translation resilience

## checks

利用可能なら実行する。

- markdownlint
- Vale / prose lint
- path、link、heading、commands、code samples の確認
- rendered artifact の compile/render

## completion evidence

- document form と audience
- checks run
- fixed high-impact issues
- remaining limitation

## 完了チェック

- primary form が明確
- opening が reader value を示す
- order が reader need に合う
- unsupported claims と filler がない
- facts と caveats が混ざっていない
- drafting context leakage がない
- Japanese prose path を必要時に通した
