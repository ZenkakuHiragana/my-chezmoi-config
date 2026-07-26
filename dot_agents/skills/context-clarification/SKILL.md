---
name: context-clarification
description: Use when work stage, scope, acceptance criteria, verification method, or unresolved user decisions are not yet settled enough to safely start implementation, planning, or review, and a readiness verdict plus a frozen requirement contract are needed; not for pure local fact-finding (use investigation), public fact verification (use public-research), or design-decision interviews (use grill-me). Produces a readiness record and freezes a requirement contract, and gates downstream work until the verdict is `pass` or `pass_with_assumption`. 準備完了判定と要件契約の固定専用。文脈の充足を判定し、準備完了記録と要件契約を作成する。
---

# 文脈整理

実作業の前に、文脈の充足を判定し、`準備完了記録` を作成する。要件レビューを通過した候補だけを `要件契約` として正式に固定する。
判定の理論（作業段階、文脈層、文脈状態、不足の分類）は AGENTS.md の `コンテキスト収集規則` に従う。
このスキルは、その理論を適用して判定を確定し、契約を成果物として産出する手順を担う。
ローカル根拠の確認は `investigation`、公開根拠は `public-research`、相互依存する設計判断の質問は `grill-me` に委ね、ここでは判定と固定だけを行う。

## 入力

- 今回の依頼本文と明示制約
- 作業枠と選んだ `work_class`
- 既に集めた根拠（`investigation` / `public-research` / `grill-me` の結果を含む）
- 関連する既存の作業契約資料（旧要件ファイル、作業ファイル）

## 手順

1. 現在有効な上位指示の `コンテキスト収集規則` にある `作業段階` から、現在地と進もうとする段階を確定する。
2. 4つの文脈層を、それぞれ `confirmed` / `not_needed` / `missing` / `blocked` に分類し、根拠を添える。
3. 不足を `user_decision` / `repo_derivable` / `subsystem_derivable` / `public_fact` / `contract_gap` に分類する。
4. 調査で解ける不足は、判定を出す前に `investigation` / `public-research` へ回す。`user_decision` は `grill-me` または直接質問へ回す。
5. `bounded` と `broad-or-unclear` では、一回限りの境界走査を行う。
   - 境界1 基準化: 入力された条件の役割、強さ、範囲、認可元を確認する。
   - 境界2 判断: 複数の選択肢で受け入れ結果や後続判断が変わる箇所を露出する。実装者へ選択を委ねる候補がある場合は、上位指示の `実装詳細を実装者へ委ねる条件` に従い、何を選んでよいかの具体的な範囲を特定する。その範囲内の実装案ごとに照合対象を変えないか、委ねてよいと判断した根拠は何かを確認する。
   - 境界3 実現: 何を変え、何を保ち、どの所有境界へ置くかを確認する。
   - 境界4 実行: 誰が、どの入口、ツール、環境、実経路で結果を生むかを確認する。
   - 境界5 評価: どの観測が、どの受け入れ条件を、どの利用者文脈で支持するか確認する。
     走査の結果から新しい走査を自動開始してはならない。同じ判断を複数境界で発見した場合は統合する。
6. 解決できた範囲で `要件契約候補` を作成し、レビュー対象版として凍結する。この時点では正式な `要件契約` として固定しない。
7. `bounded` と `broad-or-unclear` では、`review-orchestration` 経由で `requirement-review` を行う。レビュー対象版は `要件契約候補` とし、レビュー判定根拠版は依頼引用、後続訂正、確認済みの技術制約、安全上の不変条件、情報所有先とする。
8. `review-orchestration` の台帳に `ready_for_exit_check` が記録された候補だけを正式な `要件契約` として固定する。`blocked`、`reset_required`、`rollback_required` の場合は `fail` とし、戻り先を示す。契約候補を修正して新しいレビュー周回を自動開始してはならない。
9. 判定規則に従って `pass` / `pass_with_assumption` / `fail` を確定する。
10. `pass` / `pass_with_assumption` のときは契約と要件レビュー結果を外部化する。`fail` のときは戻り先の能力を示す。

## `準備完了記録`（出力契約）

- `work_class`: `tiny-local` / `bounded` / `broad-or-unclear`
- 作業段階: 現在地と、進もうとする段階
- 文脈層の状態: 依頼 / サブシステム / ワークスペース / 外部基盤の各層について `confirmed` / `not_needed` / `missing` / `blocked` と根拠
- 未解決の不足: 各項目に分類（`user_decision` / `repo_derivable` / `subsystem_derivable` / `public_fact` / `contract_gap`）
- 残る `user_decision`: 未解決のユーザー判断の一覧（無ければ `なし`）
- `要件契約`: 固定済みなら参照、未固定なら理由
- 要件レビュー結果: `bounded` と `broad-or-unclear` では参照、`tiny-local` では `なし`
- verdict: `pass` / `pass_with_assumption` / `fail`
- 仮定: `pass_with_assumption` のとき置いた仮定とその適用範囲（無ければ `なし`）
- 戻り先: `fail` のとき進む能力（`pass` 系なら `なし`）

### 発見境界の確認

| 境界   | 調べた差 | 露出した判断 | 結果 |
| ------ | -------- | ------------ | ---- |
| 基準化 | ...      | ...          | ...  |
| 判断   | ...      | ...          | ...  |
| 実現   | ...      | ...          | ...  |
| 実行   | ...      | ...          | ...  |
| 評価   | ...      | ...          | ...  |

`結果`は`no-decision`（今回の受け入れ可否を変える判断は露出しなかった）、`resolved`（判断を固定または範囲認可した）、`blocked`（未認可の判断が残った）のいずれか。`blocked`が1件でもあれば`pass`にはしない。

`判断` の行では、実装者へ選択を委ねる候補があれば、選べる具体的な範囲と、その範囲内のどの実装案でも照合対象を変えない根拠を記録する。該当しない場合は `なし` とする。根拠を示せない選択を `resolved` にしてはならない。

空欄禁止。該当なしは `なし`。

## `要件契約`（出力契約）

- 達成すべき結果
- 依頼対応表: 明示要求の逐語引用 / 対応条項、明示除外、または後続指示による覆り
- 範囲: 対象に含むもの / 含まないもの
- 不変条件: 変更を通じて保つ条件
- 受け入れ条件と確認

| 条件 | 結果を生む実経路 | 観測する結果 | 確認主体・ツール・環境 | 利用者または情報所有先 |
| ---- | ---------------- | ------------ | ---------------------- | ---------------------- |

- 判断と認可

| ID  | 判断 | 役割 | 確定状態 | 固定内容または認可範囲 | 認可元と根拠 | 適用範囲 | 戻り条件 |
| --- | ---- | ---- | -------- | ---------------------- | ------------ | -------- | -------- |

役割は制約・許可・選好。`判断と認可` 表の確定状態には、確認済みまたは仮定を記録する。仮定は `準備完了記録` と `要件契約` へ記録する。別の項目が `blocked` でも、既に仮定として暫定採用した項目を `準備完了記録` または `要件契約` から除いてはならない。暫定採用しない未確認項目は契約へ入れず、`準備完了記録` の `blocked` に残す。

- 条項根拠表: 各条項 / 根拠 / 情報の所有先 / 確認に使う資料またはコマンド
- 影響するテストと文書
- ユーザー制約
- 判定と前提とした仮定: `準備完了記録` の判定と、`pass_with_assumption` で置いた仮定（無ければ `なし`）

## 判定規則

`pass` の必須条件（すべて満たす）:

- 必要な文脈層に `missing` も `blocked` も無い。
- 残る `user_decision` がゼロ。
- 発見境界の確認に`blocked`が0件。
- 発見境界の `判断` で実装者へ委ねるとした各選択について、選べる具体的な範囲と、その範囲内のどの実装案でも照合対象を変えない根拠がある。
- `判断と認可`表の全判断に認可元がある。
- `受け入れ条件と確認`表の各行に、実経路と観測経路が対応している。
- 範囲の含む / 含まないが確定している。
- `判断と認可` 表に `仮定` がない。
- `bounded` と `broad-or-unclear` では `review-orchestration` の台帳に `ready_for_exit_check` が記録されている。

`pass_with_assumption` を許す範囲:

- `pass` の必須条件のうち、`missing` がないことと `判断と認可` 表に `仮定` がないこと以外をすべて満たす。
- 必要な文脈層に `blocked` がなく、`missing` の理由となる全項目を `仮定` として明示する。`仮定` がゼロなら `pass_with_assumption` にしない。
- 未確認事実を意識的に暫定採用した項目だけを `仮定` とし、依存する判断、反証方法、反証時の戻り先を `準備完了記録` と `要件契約` に記録する。
- 残る `user_decision`、`contract_gap`、未認可の判断がない。
- 実装者へ選択を委ねる可否は発見境界の `判断` で確定する。可否が未確認のままなら、未確認事実の `仮定` として保存して `pass_with_assumption` にしてはならない。
- 言及していない前提を勝手に確定しない。

`fail` の戻り先:

- 残りが `user_decision` → `grill-me` または直接質問。
- 残りが `repo_derivable` / `subsystem_derivable` → `investigation`。
- 残りが `public_fact` → `public-research`。
- 残りが `contract_gap` だけ → 契約候補を作成して再判定する。
- 実装者へ選択を委ねてよいと確認できない項目が残る → 選べる範囲を狭めるか一つの案へ固定し、情報の所有先に応じて再判定する。

## 進行制御と外部化

- 判定が `pass` / `pass_with_assumption` になるまで、実装・計画・レビューの実作業へ進ませない。
- 例外は AGENTS.md の `準備完了判定とゲート` に従う（`tiny-local` は記録のみで進行を許す）。
- `pass` / `pass_with_assumption` になったら `要件契約` を固定する。判定と置いた仮定も同じ契約に含める。
- `bounded` と `broad-or-unclear` では要件レビュー結果も固定する。
- 要件契約は `task-planning` が書く作業ファイルとは別にする。契約を作業ファイルで上書きしない。
- 再開時、または文脈圧縮後は、実作業の前に要件契約を読み直してから進む。見えないセッション状態から継続だと決めつけない。

## 完了チェック

- 4つの文脈層すべてに状態と根拠がある。
- 不足をすべて分類した。
- 調査で解ける不足を質問より先に調べた。
- `bounded` と `broad-or-unclear` では五境界の走査を各一回行い、発見境界の確認表を埋めた。
- 走査の結果から新しい走査を自動開始していない。
- 露出した判断を固定または範囲認可し、認可元のない判断を契約へ含めていない。
- 実装者へ選択を委ねる場合は、選べる具体的な範囲と、その範囲内のどの実装案でも照合対象を変えない根拠を確認した。
- ユーザーが反対していないこと、モデル判断、一般的な既存パターン、低リスク、局所性、可逆性だけを裁量の認可元にしていない。
- 裁量を成立させるために認可元にない受け入れ条件を追加していない。
- 判定の必須条件を実際に照合した。
- `pass_with_assumption` の仮定が未確認事実の意識的な暫定採用に限られ、依存する判断と反証時の戻り先を持つ。
- `pass` 系なら `要件契約` を外部化した。
- `bounded` と `broad-or-unclear` の `pass` 系なら要件レビュー結果を外部化した。
- `fail` なら戻り先の能力を 1 つ示した。
