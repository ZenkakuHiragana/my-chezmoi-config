---
name: context-clarification
description: Use when work stage, scope, acceptance criteria, verification method, or unresolved user decisions are not yet settled enough to safely start implementation, planning, or review, and a readiness verdict plus a frozen requirement contract are needed; not for pure local fact-finding (use investigation), public fact verification (use public-research), or design-decision interviews (use grill-me). Produces a `Readiness record` and freezes a `Requirement contract`, and gates downstream work until the verdict is `pass` or `pass_with_assumption`. 準備完了判定と要件契約の固定専用。文脈の充足を判定し `Readiness record` と `Requirement contract` を返す。
---

# Context Clarification

実作業の前に、文脈の充足を判定し、`Readiness record` と `Requirement contract` を固定する。
判定の理論（作業段階、文脈層、文脈状態、不足の分類）は AGENTS.md の `コンテキスト収集規則` に従う。
この skill は、その理論を適用して verdict を確定し、契約を成果物として産出する手順を担う。
ローカル根拠の確認は `investigation`、公開根拠は `public-research`、相互依存する設計判断の質問は `grill-me` に委ね、ここでは判定と固定だけを行う。

## 入力

- 今回の依頼本文と明示制約
- `task frame` と選んだ `work_class`
- 既に集めた根拠（`investigation` / `public-research` / `grill-me` の結果を含む）
- 関連する既存の作業契約資料（旧 requirements file、task file など）

## 手順

1. 作業段階（診断 / 選択肢比較 / 方針決定 / 実装 / レビュー）の現在地と、進もうとする段階を確定する。
2. 4つの文脈層を、それぞれ `confirmed` / `not_needed` / `missing` / `blocked` に分類し、根拠を添える。
3. 不足を `user_decision` / `repo_derivable` / `subsystem_derivable` / `public_fact` / `contract_gap` / `implementation_discretion` に分類する。
4. 調査で解ける不足は、判定を出す前に `investigation` / `public-research` へ回す。`user_decision` は `grill-me` または直接質問へ回す。
5. 解決できた範囲で `Requirement contract` を固定する。
6. verdict 判定の規則に従って `pass` / `pass_with_assumption` / `fail` を確定する。
7. `pass` / `pass_with_assumption` のときは契約を外部化する。`fail` のときは戻り先 capability を示す。

## `Readiness record`（出力契約）

- `work_class`: `tiny-local` / `bounded` / `broad-or-unclear`
- 作業段階: 現在地と、進もうとする段階
- 文脈層の状態: 依頼 / サブシステム / ワークスペース / 外部基盤 の各層について `confirmed` / `not_needed` / `missing` / `blocked` と根拠
- 未解決の不足: 各項目に分類（`user_decision` / `repo_derivable` / `subsystem_derivable` / `public_fact` / `contract_gap` / `implementation_discretion`）
- 残る `user_decision`: 未解決のユーザー判断の一覧（無ければ `None`）
- `Requirement contract`: 固定済みなら参照、未固定なら理由
- verdict: `pass` / `pass_with_assumption` / `fail`
- 仮定: `pass_with_assumption` のとき置いた仮定とその適用範囲（無ければ `None`）
- 戻り先: `fail` のとき進む capability（`pass` 系なら `None`）

空欄禁止。該当なしは `None`。

## `Requirement contract`（出力契約）

- 達成すべき結果
- scope: 対象に含むもの / 含まないもの
- invariants: 変更を通じて保つ条件
- acceptance criteria: 文言として検証可能な受け入れ条件
- verification method: 受け入れ条件をどう確認するか
- 影響する tests と docs
- ユーザー制約

## verdict 判定

`pass` のハード条件（すべて満たす）:

- 必要な文脈層に `missing` も `blocked` も無い。
- 残る `user_decision` がゼロ。
- `Requirement contract` の acceptance criteria と verification method が文言として埋まっている。
- scope の含む / 含まないが確定している。

`pass_with_assumption` を許す範囲:

- 未解決の不足が `implementation_discretion` だけのとき。
- 置いた仮定は `Readiness record` の仮定欄に明示する。
- `user_decision` または `contract_gap` を仮定で埋めたら `pass_with_assumption` にせず `fail` にする。言及していない前提を勝手に確定しない。

`fail` の戻り先:

- 残りが `user_decision` → `grill-me` または直接質問。
- 残りが `repo_derivable` / `subsystem_derivable` → `investigation`。
- 残りが `public_fact` → `public-research`。
- 残りが `contract_gap` だけ → 契約を固定して再判定する。

## ゲートと外部化

- verdict が `pass` / `pass_with_assumption` になるまで、実装・計画・レビューの実作業へ進ませない。
- 例外は AGENTS.md の `readiness 判定とゲート` に従う（`tiny-local` は記録のみで進行を許す）。
- `pass` / `pass_with_assumption` になったら `Requirement contract` を `.opencode/work/<slug>.md` に固定する。
- 再開時、またはコンテキスト圧縮後は、実作業の前にこの契約ファイルを読み直してから進む。見えない session state から継続だと決めつけない。

## 完了チェック

- 4つの文脈層すべてに状態と根拠がある。
- 不足をすべて分類した。
- 調査で解ける不足を質問より先に調べた。
- verdict のハード条件を実際に照合した。
- `pass_with_assumption` の仮定が `implementation_discretion` に限られている。
- `pass` 系なら `Requirement contract` を外部化した。
- `fail` なら戻り先 capability を1つ示した。
